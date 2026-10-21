#!/usr/bin/env python3
"""Ordinary synthetic repository transition on an empty hosted runner. No production access."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import platform
import re
import secrets
import signal
import sys

SPEC = importlib.util.spec_from_file_location(
    "foundation_proof", pathlib.Path(__file__).with_name("foundation-recovery-proof.py"))
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
DATABASES = ("inside", "logto", "inside_telegram")
ENVFILES = ("old.env", "new.env", "multi.env")


class CommandRefused(RuntimeError):
    def __init__(self, resources, result):
        self.detail = base.refusal_detail(result, *(resources.directory / name for name in ENVFILES))
        super().__init__("synthetic command refused")


def backrest(resources, container, *args):
    result = base.backrest(resources, container, *args, check=False)
    if result.returncode:
        raise CommandRefused(resources, result)
    return result


def start(resources, image, data, repository, envfile, suffix, *, initialize=False):
    command = ("install -d -o postgres -g postgres -m 700 " + base.DATA + " /backup/old /backup/new; "
               "install -d -o postgres -g postgres /var/run/postgresql; ")
    if initialize:
        command += "gosu postgres initdb -D " + base.DATA + " -A trust --no-locale >/dev/null; "
    command += ("exec gosu postgres postgres -D " + base.DATA + " -c listen_addresses= "
                "-c archive_mode=on -c archive_timeout=60 "
                "-c 'archive_command=pgbackrest --config=/dev/null --stanza=proof archive-push %p'")
    name, result = resources.container(suffix, image, data, repository, envfile, command, detached=True)
    if result.returncode:
        raise RuntimeError("transition source failed to start")
    base.wait_sql(resources, name)
    return name


def labels(resources, container, repo):
    raw = json.loads(backrest(resources, container, "--repo=" + str(repo), "--output=json", "info").stdout)
    backups = raw[0]["backup"]
    if not backups or raw[0]["status"]["code"] != 0:
        raise RuntimeError("transition repository not healthy")
    result = [item["label"] for item in backups]
    if any(not re.fullmatch(r"[0-9]{8}-[0-9]{6}F", value) for value in result):
        raise RuntimeError("unexpected synthetic full labels")
    return result


def old_manifest(resources, image, data, repository, envfile, suffix):
    _, result = resources.container(
        suffix, image, data, repository, envfile,
        "set -o pipefail; find /backup/old -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum",
        data_readonly=True, repository_readonly=True)
    if result.returncode:
        raise RuntimeError("old namespace manifest unavailable")
    return hashlib.sha256(result.stdout.encode()).hexdigest()


def restored(resources, image, repository, envfile, suffix, target, expected):
    name = base.restore_case(resources, image, repository, envfile, suffix, target, expected,
                             databases=DATABASES)
    resources.command("stop", "--time", "30", name)


def proof(image, receipt, directory):
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise ValueError("transition requires an immutable local image")
    resources = base.Resources(base.admit(), directory)
    verdict = {"passed": False, "source": os.environ.get("GITHUB_SHA"), "image": image,
               "rngFailureVerified": False, "syntheticOnly": True}
    try:
        expected = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
        meta = json.loads(resources.command("image", "inspect", image).stdout)[0]
        if (expected is None or meta.get("Id") != image or meta.get("Architecture") != expected
                or meta.get("Os") != "linux" or meta.get("Config", {}).get("Volumes") != {"/var/lib/postgresql": {}}):
            raise ValueError("transition image must match native runner and declared volume")
        verdict["nativeArchitecture"] = expected
        common = ("PGBACKREST_PG1_PATH=" + base.DATA + "\n"
                  "PGBACKREST_PG1_SOCKET_PATH=/var/run/postgresql\n"
                  "PGBACKREST_REPO1_TYPE=posix\nPGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc\n"
                  "PGBACKREST_REPO1_RETENTION_FULL=1\nPGBACKREST_EXPIRE_AUTO=n\n"
                  "PGBACKREST_ARCHIVE_ASYNC=y\nPGBACKREST_START_FAST=y\n"
                  "PGBACKREST_LOG_LEVEL_CONSOLE=warn\nPGBACKREST_LOG_LEVEL_FILE=off\n")
        old, new, multi = (directory / name for name in ENVFILES)
        old_pass, new_pass = secrets.token_hex(32), secrets.token_hex(32)
        old.write_text(common + "PGBACKREST_REPO1_PATH=/backup/old\n"
                       "PGBACKREST_REPO1_CIPHER_PASS=" + old_pass + "\n")
        new.write_text(common + "PGBACKREST_REPO1_PATH=/backup/new\n"
                       "PGBACKREST_REPO1_CIPHER_PASS=" + new_pass + "\n")
        multi.write_text(old.read_text() + "PGBACKREST_REPO2_TYPE=posix\n"
                         "PGBACKREST_REPO2_PATH=/backup/new\nPGBACKREST_REPO2_CIPHER_TYPE=aes-256-cbc\n"
                         "PGBACKREST_REPO2_RETENTION_FULL=1\nPGBACKREST_REPO2_CIPHER_PASS=" + new_pass + "\n")
        for path in (old, new, multi):
            path.chmod(0o600)
        data, repository = resources.volume("transition-data"), resources.volume("transition-repository")
        verdict["stage"] = "old-source"
        source = start(resources, image, data, repository, old, "old-source", initialize=True)
        if resources.command("exec", source, "pgbackrest", "--version").stdout.strip() != "pgBackRest 2.59.3":
            raise ValueError("transition must use the fixed production pgBackRest version")
        for database in DATABASES:
            base.sql(resources, source, "postgres", "CREATE DATABASE " + database + ";")
            base.sql(resources, source, database,
                     "CREATE TABLE proof_marker(id integer PRIMARY KEY, phase text NOT NULL);"
                     "INSERT INTO proof_marker VALUES(1,'backup');")
        verdict["stage"] = "old-full"
        backrest(resources, source, "stanza-create")
        backrest(resources, source, "--repo=1", "--type=full", "--no-expire-auto", "backup")
        old_labels = labels(resources, source, 1)
        resources.command("stop", "--time", "30", source)
        before_new = old_manifest(resources, image, data, repository, old, "old-before-new")
        # Only the new namespace is configured. No old metadata or subkeys are copied/read.
        verdict["stage"] = "new-only-create"
        _, initialized = resources.container(
            "initialize-new-only", image, data, repository, new,
            "exec gosu postgres pgbackrest --config=/dev/null --stanza=proof --no-online stanza-create",
            data_readonly=True)
        if initialized.returncode:
            raise CommandRefused(resources, initialized)
        after_new = old_manifest(resources, image, data, repository, old, "old-after-new")
        if before_new != after_new:
            raise RuntimeError("creating the new stanza changed old namespace")
        verdict["stage"] = "multi-source"
        source = start(resources, image, data, repository, multi, "multi-source")
        backrest(resources, source, "check")
        for _ in range(2):
            backrest(resources, source, "--repo=2", "--type=full", "--no-expire-auto", "backup")
        if labels(resources, source, 1) != old_labels or len(labels(resources, source, 2)) != 2:
            raise RuntimeError("backup selector or history preservation failed")
        for database in DATABASES:
            base.sql(resources, source, database, "INSERT INTO proof_marker VALUES(2,'before');")
        base.sql(resources, source, "postgres", "SELECT pg_create_restore_point('transition_target');")
        for database in DATABASES:
            base.sql(resources, source, database, "INSERT INTO proof_marker VALUES(3,'after');")
        base.sql(resources, source, "postgres", "SELECT pg_switch_wal();")
        backrest(resources, source, "check")
        resources.command("stop", "--time", "30", source)
        before_restore = base.source_manifest(resources, image, data, repository, multi, "before-restores")
        verdict["stage"] = "restores"
        restored(resources, image, repository, old, "old-immediate", "--type=immediate", "backup")
        restored(resources, image, repository, new, "new-immediate", "--type=immediate", "backup")
        for name, env in (("old-pitr", old), ("new-pitr", new)):
            restored(resources, image, repository, env, name,
                     "--type=name --target=transition_target", "backup,before")
        after_restore = base.source_manifest(resources, image, data, repository, multi, "after-restores")
        if before_restore != after_restore:
            raise RuntimeError("restore changed source data or repositories")
        verdict["stage"] = "rollback"
        source = start(resources, image, data, repository, old, "rollback-source")
        for database in DATABASES:
            base.sql(resources, source, database, "INSERT INTO proof_marker VALUES(4,'rollback');")
        base.sql(resources, source, "postgres", "SELECT pg_switch_wal();")
        backrest(resources, source, "check")
        backrest(resources, source, "--repo=1", "--type=full", "--no-expire-auto", "backup")
        if not set(old_labels).issubset(labels(resources, source, 1)) or len(labels(resources, source, 1)) != 2:
            raise RuntimeError("rollback expired old history")
        resources.command("stop", "--time", "30", source)
        restored(resources, image, repository, old, "rollback-restore", "--type=immediate",
                 "backup,before,after,rollback")
        verdict.update(passed=True, databases=list(DATABASES), oldMetadataPreserved=True,
                       independentNewStanza=True, explicitRepositorySelection=True,
                       historyPreservedBeyondRetentionCount=True, oldAndNewWalPitr=True,
                       oldAndNewFullRestore=True, rollbackPreservedNewWrites=True,
                       restoreSourcesUnchanged=True, oldNamespaceSha256=before_new)
        verdict["stage"] = "complete"
    except Exception as error:
        verdict["failureClass"] = type(error).__name__
        if isinstance(error, CommandRefused):
            verdict["refusal"] = error.detail
        raise
    finally:
        try:
            resources.cleanup()
            verdict["ownedResourcesRemoved"] = True
        finally:
            for name in ENVFILES:
                (directory / name).unlink(missing_ok=True)
            receipt.write_text(json.dumps(verdict, indent=2) + "\n")


def main():
    signal.signal(signal.SIGTERM, base.terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--state-directory", required=True, type=pathlib.Path)
    parser.add_argument("--receipt", type=pathlib.Path)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    base.hosted_runner()
    directory = args.state_directory
    runner_temp = os.environ.get("RUNNER_TEMP")
    if (not runner_temp or directory.is_symlink()
            or not directory.resolve().is_relative_to(pathlib.Path(runner_temp).resolve())):
        raise ValueError("transition state must belong to runner temp")
    if args.cleanup_only:
        if (directory / "resources.json").exists():
            base.Resources(["docker", "--host", base.local_endpoint()], directory, recover=True).cleanup()
        for name in ENVFILES:
            (directory / name).unlink(missing_ok=True)
        return
    if not args.image or not args.receipt:
        parser.error("--image and --receipt are required")
    directory.mkdir(mode=0o700)
    proof(args.image, args.receipt, directory)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, TypeError, KeyboardInterrupt):
        print("repository transition proof failed; inspect its redacted receipt", file=sys.stderr)
        sys.exit(1)
