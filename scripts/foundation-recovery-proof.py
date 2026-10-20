#!/usr/bin/env python3
"""Ordinary synthetic recovery proof on an empty GitHub-hosted Docker runner."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import secrets
import signal
import stat
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = "/var/lib/postgresql/18/docker"
DATABASES = ("inside", "logto")
LABEL = "inside.foundation-proof"


def terminate(_signum, _frame):
    raise KeyboardInterrupt


def stop_process_group(group, leader=None):
    """Bounded shutdown of the exact process group owned by this invocation."""
    try:
        os.killpg(group, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if leader is not None:
            leader.poll()  # Reap our direct child before testing group disappearance.
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            return
        time.sleep(0.02)
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass


def invoke(arguments, *, text=None, timeout=120, check=True):
    environment = dict(os.environ)
    if "--host" in arguments:
        for key in ("DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
            environment.pop(key, None)
    child = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, env=environment,
                             start_new_session=True)
    try:
        stdout, stderr = child.communicate(input=text, timeout=timeout)
        result = subprocess.CompletedProcess(arguments, child.returncode, stdout, stderr)
    finally:
        try:
            stop_process_group(child.pid, child)
        finally:
            child.wait(timeout=5)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream is not None:
                    stream.close()
    if check and result.returncode:
        # Provider/tool output and environment values do not enter public receipts.
        raise RuntimeError("proof command failed")
    return result


def local_endpoint():
    endpoint = os.environ.get("DOCKER_HOST")
    if not endpoint:
        context = invoke(["docker", "context", "show"]).stdout.strip()
        endpoint = json.loads(invoke([
            "docker", "context", "inspect", context, "--format",
            "{{json .Endpoints.docker.Host}}",
        ]).stdout)
    if not isinstance(endpoint, str) or not endpoint.startswith("unix:///"):
        raise ValueError("proof requires a local Unix Docker endpoint")
    if not stat.S_ISSOCK(os.stat(endpoint[7:]).st_mode):
        raise ValueError("Docker endpoint is not a local socket")
    return endpoint


def hosted_runner():
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or platform.system() != "Linux"):
        raise ValueError("runtime proof is restricted to its disposable hosted CI runner")


def admit():
    hosted_runner()
    endpoint = local_endpoint()  # Validate locality before any daemon request.
    prefix = ["docker", "--host", endpoint]
    for query in [("ps", "--all", "--quiet"), ("volume", "ls", "--quiet")]:
        if invoke([*prefix, *query]).stdout.strip():
            raise ValueError("proof requires an empty runner, not a shared stand")
    return prefix


class Resources:
    def __init__(self, docker, directory, *, recover=False):
        self.docker = docker
        self.directory = directory
        self.journal = directory / "resources.json"
        self.daemon = json.loads(self.command("info", "--format", "{{json .ID}}").stdout)
        if not isinstance(self.daemon, str) or not self.daemon:
            raise ValueError("missing Docker daemon identity")
        if recover:
            if self.journal.is_symlink():
                raise ValueError("resource journal must not be a symlink")
            record = json.loads(self.journal.read_text())
            self.owner, self.names = record["owner"], record["resources"]
            if (not isinstance(self.owner, str) or not re.fullmatch(r"[a-f0-9]{32}", self.owner)
                    or record["daemon"] != self.daemon
                    or record["endpoint"] != self.docker[-1]
                    or not isinstance(self.names, list)):
                raise ValueError("resource journal identity mismatch")
            for item in self.names:
                if (not isinstance(item, dict) or item.get("kind") not in ("container", "volume")
                        or not isinstance(item.get("name"), str)
                        or not re.fullmatch("inside-foundation-proof-" + self.owner + r"-[a-z0-9-]+", item["name"])):
                    raise ValueError("resource journal contains a foreign resource")
            return
        if self.journal.exists():
            raise ValueError("existing proof state must be cleaned explicitly")
        self.owner = uuid.uuid4().hex
        self.names = []
        self.save()

    def save(self):
        temporary = self.directory / "resources.next.json"
        temporary.write_text(json.dumps({"owner": self.owner, "resources": self.names,
                                         "daemon": self.daemon, "endpoint": self.docker[-1]}))
        temporary.replace(self.journal)

    def register(self, kind, suffix):
        name = "inside-foundation-proof-" + self.owner + "-" + suffix
        self.names.append({"kind": kind, "name": name})
        self.save()  # A failed/aborted create still has an exact cleanup record.
        return name

    def command(self, *args, **kwargs):
        return invoke([*self.docker, *args], **kwargs)

    def volume(self, suffix):
        name = self.register("volume", suffix)
        self.command("volume", "create", "--label", LABEL + "=" + self.owner, name)
        return name

    def container(self, suffix, image, data, repository, envfile, *command, detached=False,
                  data_readonly=False, repository_readonly=False, command_timeout=120):
        name = self.register("container", suffix)
        args = ["run", "--name", name, "--label", LABEL + "=" + self.owner,
                "--network", "none", "--pull", "never", "--read-only",
                "--memory", "512m", "--cpus", "2", "--pids-limit", "128",
                "--tmpfs", "/tmp:rw,size=32m", "--tmpfs", "/var/run/postgresql:rw,size=8m",
                "--tmpfs", "/var/log/pgbackrest:rw,size=8m",
                "--tmpfs", "/var/spool/pgbackrest:rw,size=8m",
                "--mount", "type=volume,src=" + data + ",dst=/var/lib/postgresql" + (",readonly" if data_readonly else ""),
                "--mount", "type=volume,src=" + repository + ",dst=/backup" + (",readonly" if repository_readonly else ""),
                "--env-file", str(envfile), "--entrypoint", "sh"]
        if detached:
            args.append("--detach")
        result = self.command(*args, image, "-ec", *command, check=False, timeout=command_timeout)
        return name, result

    def cleanup(self):
        errors = []
        for item in reversed(self.names):
            kind, name = item["kind"], item["name"]
            query = ["volume", "inspect"] if kind == "volume" else ["inspect"]
            found = self.command(*query, name, check=False)
            if found.returncode:
                if not re.search(r"no such (?:object|container|volume)", found.stderr, re.I):
                    errors.append("cannot establish resource absence")
                continue
            values = json.loads(found.stdout)
            metadata = values[0]
            labels = (metadata.get("Labels") if kind == "volume"
                      else metadata.get("Config", {}).get("Labels")) or {}
            if labels.get(LABEL) != self.owner:
                errors.append("ownership changed")
                continue
            args = ["volume", "rm", name] if kind == "volume" else ["rm", "--force", name]
            if self.command(*args, check=False).returncode:
                errors.append("owned resource cleanup failed")
        if errors:
            raise RuntimeError("; ".join(errors))


def wait_sql(resources, container, database="postgres", seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = resources.command("exec", "--user", "postgres", container,
                                   "psql", "-XAt", "--dbname", database,
                                   "--command", "SELECT pg_is_in_recovery();", check=False)
        if result.returncode == 0 and result.stdout.strip() == "f":
            return
        time.sleep(0.25)  # Bounded polling of a committed recovery fact.
    raise TimeoutError("cluster did not complete the requested recovery")


def sql(resources, container, database, query):
    return resources.command("exec", "--user", "postgres", container,
                             "psql", "-XAt", "--set", "ON_ERROR_STOP=1",
                             "--dbname", database, "--command", query).stdout.strip()


def backrest(resources, container, *args, check=True):
    return resources.command("exec", "--user", "postgres", container,
                             "pgbackrest", "--config=/dev/null", "--stanza=proof",
                             *args, timeout=180, check=check)


def source_manifest(resources, image, source, repository, envfile, suffix):
    _, result = resources.container(
        suffix, image, source, repository, envfile,
        "test $(du -sm " + DATA + " | cut -f1) -le 512; "
        "test $(du -sm /backup | cut -f1) -le 512; "
        "set -o pipefail; find " + DATA + " /backup -type f -print0 | "
        "LC_ALL=C sort -z | xargs -0 sha256sum",
        data_readonly=True, repository_readonly=True)
    if result.returncode:
        raise RuntimeError("source manifest failed")
    return hashlib.sha256(result.stdout.encode()).hexdigest()


def runtime_identity(resources, container, directory):
    library_paths = []
    crypto_paths = []
    for binary in ("/usr/bin/pgbackrest", "/usr/libexec/inside/libpq-version"):
        output = resources.command("exec", container, "ldd", binary).stdout
        match = re.search(r"libpq\.so\.5\s+=>\s+(/usr/local/lib/\S+)", output)
        if not match:
            raise ValueError("runtime binary does not resolve the pinned base libpq")
        library_paths.append(match.group(1))
        crypto = re.search(r"libcrypto\.so\.3\s+=>\s+(/\S+)", output)
        if not crypto:
            raise ValueError("runtime binary does not resolve OpenSSL libcrypto")
        crypto_paths.append(crypto.group(1))
    if library_paths[0] != library_paths[1] or crypto_paths[0] != crypto_paths[1]:
        raise ValueError("runtime probe and pgBackRest resolve different libraries")
    digest = resources.command("exec", container, "sha256sum", library_paths[0]).stdout.split()[0]
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("invalid runtime library digest")
    crypto_digest = resources.command("exec", container, "sha256sum", crypto_paths[0]).stdout.split()[0]
    if not re.fullmatch(r"[a-f0-9]{64}", crypto_digest):
        raise ValueError("invalid crypto library digest")
    binary = directory / "pgbackrest"
    resources.command("cp", container + ":/usr/bin/pgbackrest", str(binary))
    if binary.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("unexpected runtime binary size")
    header = invoke(["readelf", "-hW", str(binary)]).stdout
    program = invoke(["readelf", "-lW", str(binary)]).stdout
    dynamic = invoke(["readelf", "-dW", str(binary)]).stdout
    symbols = invoke(["readelf", "-Ws", str(binary)]).stdout
    stack = next((line for line in program.splitlines() if "GNU_STACK" in line), "")
    if (not re.search(r"Type:\s+DYN", header) or "GNU_RELRO" not in program
            or not re.search(r"BIND_NOW|FLAGS[^\n]*\bNOW\b", dynamic)
            or not re.search(r"\bRW\s", stack) or "RWE" in stack
            or "__stack_chk_fail" not in symbols):
        raise ValueError("runtime binary hardening evidence is incomplete")
    return {"libpqPath": library_paths[0], "libpqSha256": digest,
            "libcryptoPath": crypto_paths[0], "libcryptoSha256": crypto_digest,
            "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
            "openssl": resources.command("exec", container,
                                         "/usr/libexec/inside/libpq-version", "openssl").stdout.strip(),
            "pie": True, "relro": True, "bindNow": True, "nonExecutableStack": True,
            "stackProtectorSymbol": True}


def restore_case(resources, image, repository, envfile, suffix, target, expected_rows):
    data = resources.volume(suffix + "-data")
    _, result = resources.container(
        suffix + "-restore", image, data, repository, envfile,
        "install -d -o postgres -g postgres -m 700 " + DATA + "; "
        "exec gosu postgres pgbackrest --config=/dev/null --stanza=proof "
        "--archive-mode=off --target-action=promote " + target + " restore",
        repository_readonly=True)
    if result.returncode:
        error = next((line for line in (result.stdout + result.stderr).splitlines()
                      if re.search(r"ERROR:\s+\[\d+\]", line)), "no structured error")
        for line in envfile.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.endswith("_PASS") and value:
                error = error.replace(value, "<REDACTED>")
        raise RuntimeError("ordinary restore failed (exit " + str(result.returncode)
                           + "): " + error[:400])
    container, result = resources.container(
        suffix + "-postgres", image, data, repository, envfile,
        "install -d -o postgres -g postgres /var/run/postgresql; "
        "exec gosu postgres postgres -D " + DATA
        + " -c listen_addresses= -c archive_mode=off", detached=True,
        repository_readonly=True)
    if result.returncode:
        raise RuntimeError("restored cluster failed to start")
    if expected_rows is None:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            state = json.loads(resources.command("inspect", "--format",
                                                "{{json .State}}", container).stdout)
            if state.get("Running") is False:
                logs = resources.command("logs", container)
                output = logs.stdout + logs.stderr
                if (state.get("ExitCode", 0) != 0
                        and "recovery ended before configured recovery target was reached" in output):
                    return
                raise RuntimeError("missing WAL failed for a different reason")
            time.sleep(0.25)
        raise TimeoutError("missing WAL did not produce the expected recovery refusal")
    wait_sql(resources, container)
    for database in DATABASES:
        rows = sql(resources, container, database,
                   "SELECT string_agg(phase, ',' ORDER BY id) FROM proof_marker;")
        if rows != expected_rows:
            raise RuntimeError("restored transaction boundary mismatch")


def proof(image, receipt, directory, legacy_source=None):
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise ValueError("proof image must be a local immutable image ID")
    if legacy_source is not None and not re.fullmatch(r"sha256:[a-f0-9]{64}", legacy_source):
        raise ValueError("legacy source must be a local immutable image ID")
    writer = legacy_source or image
    resources = Resources(admit(), directory)
    verdict = {"passed": False, "source": os.environ.get("GITHUB_SHA"),
               "image": image, "backupWriterImage": writer, "network": "none", "publishedPorts": 0}
    try:
        expected = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
        if expected is None:
            raise ValueError("unsupported native runner architecture")
        for selected in {image, writer}:
            values = json.loads(resources.command("image", "inspect", selected).stdout)
            if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
                raise ValueError("invalid image metadata")
            metadata = values[0]
            if (metadata.get("Id") != selected or metadata.get("Architecture") != expected
                    or metadata.get("Os") != "linux"):
                raise ValueError("image architecture must match native runner architecture")
            config = metadata.get("Config")
            if not isinstance(config, dict) or config.get("Volumes") != {"/var/lib/postgresql": {}}:
                raise ValueError("unexpected implicit image volume")
        verdict["nativeArchitecture"] = expected
        envfile = directory / "proof.env"
        common = ("PGBACKREST_PG1_PATH=" + DATA + "\n"
                  "PGBACKREST_PG1_SOCKET_PATH=/var/run/postgresql\n"
                  "PGBACKREST_REPO1_TYPE=posix\nPGBACKREST_REPO1_PATH=/backup\n"
                  "PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc\n"
                  "PGBACKREST_ARCHIVE_ASYNC=n\nPGBACKREST_LOG_LEVEL_CONSOLE=warn\n"
                  "PGBACKREST_LOG_LEVEL_FILE=off\n")
        envfile.write_text(common + "PGBACKREST_REPO1_CIPHER_PASS=" + secrets.token_hex(32) + "\n")
        envfile.chmod(0o600)
        source, repository = resources.volume("source"), resources.volume("repository")
        container, result = resources.container(
            "source-postgres", writer, source, repository, envfile,
            "install -d -o postgres -g postgres -m 700 " + DATA + " /backup; "
            "install -d -o postgres -g postgres /var/run/postgresql; "
            "gosu postgres initdb -D " + DATA + " -A trust --no-locale >/dev/null; "
            "exec gosu postgres postgres -D " + DATA + " -c listen_addresses= "
            "-c archive_mode=on -c archive_timeout=60 "
            "-c 'archive_command=pgbackrest --config=/dev/null --stanza=proof archive-push %p'",
            detached=True)
        if result.returncode:
            raise RuntimeError("synthetic source initialization failed")
        wait_sql(resources, container)
        if sql(resources, container, "postgres", "SHOW server_version_num;") != "180004":
            raise ValueError("proof requires PostgreSQL 18.4")
        writer_version = resources.command("exec", container, "pgbackrest", "--version").stdout.strip()
        expected_version = json.loads((ROOT / "infra/production/database/versions.json").read_text())["pgBackRest"]
        if writer_version != "pgBackRest " + ("2.57.0" if legacy_source else expected_version):
            raise ValueError("backup writer version does not match the selected proof case")
        verdict["backupWriterVersion"] = writer_version
        identity_container, identity_started = resources.container(
            "runtime-identity", image, source, repository, envfile, "exec sleep 600",
            detached=True, data_readonly=True, repository_readonly=True)
        if identity_started.returncode:
            raise RuntimeError("candidate identity fixture did not start")
        version = resources.command("exec", identity_container, "pgbackrest", "--version").stdout.strip()
        if version != "pgBackRest " + expected_version:
            raise ValueError("candidate pgBackRest version does not match source")
        verdict["pgBackRestVersion"] = version
        libpq = resources.command("exec", identity_container,
                                 "/usr/libexec/inside/libpq-version").stdout.strip()
        if libpq != "180004":
            raise ValueError("runtime libpq must remain PostgreSQL 18.4")
        verdict["libpqVersion"] = int(libpq)
        provenance = json.loads(resources.command(
            "exec", identity_container, "cat", "/usr/share/inside/pgbackrest-build.json").stdout)
        if provenance.get("libpqVersion") != "18.4" or provenance.get("libpqPcDirectory") != "/usr/local/lib/pkgconfig":
            raise ValueError("unexpected selected build-time libpq metadata")
        versions = json.loads((ROOT / "infra/production/database/versions.json").read_text())
        if (provenance.get("pgBackRestSource") != versions["sourceSha"]
                or provenance.get("distributionSha256") != versions["distributionSha256"]):
            raise ValueError("image distribution provenance differs from source")
        verdict["buildProvenance"] = provenance
        verdict["runtimeIdentity"] = runtime_identity(resources, identity_container, directory)
        for database in DATABASES:
            sql(resources, container, "postgres", "CREATE DATABASE " + database + ";")
            sql(resources, container, database,
                "CREATE TABLE proof_marker(id integer PRIMARY KEY, phase text NOT NULL);"
                "INSERT INTO proof_marker VALUES(1,'backup');")
        backrest(resources, container, "stanza-create")
        backrest(resources, container, "check")
        backrest(resources, container, "--type=full", "--start-fast", "backup")
        sql(resources, container, "postgres", "SELECT pg_switch_wal();")
        for database in DATABASES:
            sql(resources, container, database, "INSERT INTO proof_marker VALUES(2,'before');")
        target = sql(resources, container, "postgres", "SELECT pg_create_restore_point('proof_target');")
        if not re.fullmatch(r"[A-F0-9]+/[A-F0-9]+", target):
            raise ValueError("unexpected synthetic restore LSN")
        wal = sql(resources, container, "postgres", "SELECT pg_walfile_name('" + target + "'::pg_lsn);")
        if not re.fullmatch(r"[A-F0-9]{24}", wal):
            raise ValueError("unexpected synthetic WAL name")
        for database in DATABASES:
            sql(resources, container, database, "INSERT INTO proof_marker VALUES(3,'after');")
        sql(resources, container, "postgres", "SELECT pg_switch_wal();")
        backrest(resources, container, "check")
        resources.command("stop", "--time", "30", container)
        before = source_manifest(resources, image, source, repository, envfile, "source-before")
        restore_case(resources, image, repository, envfile, "immediate", "--type=immediate", "backup")
        restore_case(resources, image, repository, envfile, "pitr",
                     "--type=name --target=proof_target", "backup,before")
        wrong = directory / "wrong.env"
        wrong.write_text(common + "PGBACKREST_REPO1_CIPHER_PASS=wrong-synthetic-passphrase\n")
        wrong.chmod(0o600)
        data = resources.volume("wrong-cipher-data")
        _, result = resources.container(
            "wrong-cipher", image, data, repository, wrong,
            "install -d -o postgres -g postgres -m 700 " + DATA + "; "
            "exec gosu postgres pgbackrest --config=/dev/null --stanza=proof --type=immediate restore",
            repository_readonly=True)
        if result.returncode == 0 or not re.search(
                r"unable to decrypt|invalid passphrase|bad decrypt|cipher header invalid",
                result.stdout + result.stderr, re.I):
            raise RuntimeError("wrong cipher did not refuse decryption")
        missing = resources.volume("missing-wal-repository")
        # Copy only our repository, then remove exactly the selected synthetic WAL from the copy.
        name = resources.register("container", "copy-repository")
        resources.command("run", "--name", name, "--label", LABEL + "=" + resources.owner,
                          "--network", "none", "--pull", "never", "--read-only",
                          "--memory", "512m", "--cpus", "2", "--pids-limit", "128",
                          "--mount", "type=volume,src=" + repository + ",dst=/source,readonly",
                          "--mount", "type=volume,src=" + missing + ",dst=/destination",
                          "--tmpfs", "/var/lib/postgresql:rw,size=1m",
                          "--entrypoint", "sh", image, "-ec",
                          "cp -a /source/. /destination/; "
                          "test $(find /destination/archive -name '" + wal + "-*' | wc -l) -gt 0; "
                          "find /destination/archive -name '" + wal + "-*' -delete")
        restore_case(resources, image, missing, envfile, "missing-wal",
                     "--type=name --target=proof_target", None)
        after = source_manifest(resources, image, source, repository, envfile, "source-after")
        if before != after:
            raise RuntimeError("recovery proof changed the stopped source volume")
        verdict.update(passed=True, databases=list(DATABASES), encryptedFullRestore=True,
                       namedTargetPitr=True, wrongCipherRefused=True, missingWalRefused=True,
                       sourcePreserved=True, repositoryPreserved=True,
                       legacyBackupRead=bool(legacy_source), rngFailureVerified=False)
    finally:
        resources.cleanup()
        verdict["ownedResourcesRemoved"] = True
        receipt.write_text(json.dumps(verdict, indent=2) + "\n")


def main():
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--legacy-source-image")
    parser.add_argument("--receipt", type=pathlib.Path)
    parser.add_argument("--state-directory", required=True, type=pathlib.Path)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    hosted_runner()
    directory = args.state_directory
    runner_temp = os.environ.get("RUNNER_TEMP")
    if (not runner_temp or directory.is_symlink()
            or not directory.resolve().is_relative_to(pathlib.Path(runner_temp).resolve())):
        raise ValueError("proof state must belong to the disposable runner temp directory")
    if args.cleanup_only:
        if (directory / "resources.json").exists():
            Resources(["docker", "--host", local_endpoint()], directory, recover=True).cleanup()
        for name in ("proof.env", "wrong.env"):
            (directory / name).unlink(missing_ok=True)
        return
    if not args.image or not args.receipt:
        parser.error("--image and --receipt are required for the proof")
    directory.mkdir(mode=0o700)
    try:
        proof(args.image, args.receipt, directory, args.legacy_source_image)
    finally:
        for name in ("proof.env", "wrong.env"):
            (directory / name).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
