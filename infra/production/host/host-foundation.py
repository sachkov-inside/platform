#!/usr/bin/env python3
"""Versioned, fail-closed host and release-filesystem foundation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request


SOURCE_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = SOURCE_DIR / "foundation.json"
VERSION_PATTERN = re.compile(r"^v[1-9][0-9]*$")


class FoundationError(RuntimeError):
    pass


def load_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def rooted(root: Path, absolute: str) -> Path:
    if not absolute.startswith("/"):
        raise FoundationError(f"Foundation path must be absolute: {absolute}")
    resolved_root = root.resolve()
    candidate = (resolved_root / absolute.removeprefix("/")).resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise FoundationError(f"Foundation path escapes selected root: {absolute}")
    return candidate


def has_symlink_component(root: Path, absolute: str) -> bool:
    if not absolute.startswith("/"):
        raise FoundationError(f"Foundation path must be absolute: {absolute}")
    current = root.resolve()
    for component in Path(absolute).parts[1:]:
        if component in ("", ".", ".."):
            raise FoundationError(f"Foundation path is unsafe: {absolute}")
        current /= component
        if current.is_symlink():
            return True
    return False


def read_host_facts(root: Path, facts_path: Path | None) -> dict[str, object]:
    if facts_path is not None:
        facts = json.loads(facts_path.read_text(encoding="utf-8"))
        if not isinstance(facts, dict):
            raise FoundationError("Host facts must be a JSON object")
        return facts
    if root.resolve() != Path("/"):
        raise FoundationError("A fixture root requires explicit --facts")

    os_release = parse_key_values(Path("/etc/os-release").read_text(encoding="utf-8"))
    memory = parse_key_values(Path("/proc/meminfo").read_text(encoding="utf-8"))
    disk = shutil.disk_usage("/")
    return {
        "architecture": platform.machine(),
        "availableDiskBytes": disk.free,
        "cpuCount": os.cpu_count() or 0,
        "effectiveUserId": os.geteuid(),
        "memoryBytes": int(memory.get("MemTotal", "0 kB").split()[0]) * 1024,
        "osId": os_release.get("ID", ""),
        "osVersion": os_release.get("VERSION_ID", "").strip('"'),
    }


def parse_key_values(content: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in content.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip('"')
        elif ":" in line:
            key, value = line.split(":", 1)
            values[key] = value.strip()
    return values


def preflight(root: Path, facts_path: Path | None, manifest: dict[str, object]) -> None:
    facts = read_host_facts(root, facts_path)
    expected_host = manifest["host"]
    capacity = manifest["capacity"]
    assert isinstance(expected_host, dict)
    assert isinstance(capacity, dict)

    checks = {
        "architecture": (facts.get("architecture"), expected_host["architecture"]),
        "osId": (facts.get("osId"), expected_host["osId"]),
        "osVersion": (facts.get("osVersion"), expected_host["osVersion"]),
    }
    failures = [
        key
        for key, (actual, expected) in checks.items()
        if actual != expected
    ]
    for fact_key, minimum_key in (
        ("cpuCount", "minimumCpuCount"),
        ("availableDiskBytes", "minimumDiskBytes"),
        ("memoryBytes", "minimumMemoryBytes"),
    ):
        value = facts.get(fact_key)
        minimum = capacity[minimum_key]
        if not isinstance(value, int) or value < minimum:
            failures.append(fact_key)

    if facts.get("effectiveUserId") != 0:
        failures.append("effectiveUserId")

    paths = manifest["paths"]
    assert isinstance(paths, dict)
    managed_roots = {
        "unmanagedAgeIdentityPath": str(paths["ageIdentity"]),
        "unmanagedFoundationPath": str(paths["foundation"]),
        "unmanagedReleasePath": str(paths["releases"]),
        "unmanagedRuntimePath": str(paths["runtime"]),
        "unmanagedSecretPath": str(paths["secrets"]),
        "unmanagedStatePath": str(paths["state"]),
    }
    for failure, absolute in managed_roots.items():
        if has_symlink_component(root, absolute):
            failures.append(failure)
    state_root = rooted(root, str(paths["state"]))
    marker = state_root / ".inside-foundation"
    if not marker.is_file():
        for failure, absolute in managed_roots.items():
            candidate = rooted(root, absolute)
            if candidate.exists() and (
                not candidate.is_dir() or any(candidate.iterdir())
            ):
                failures.append(failure)

    if failures:
        raise FoundationError(
            "Host preflight failed: " + ", ".join(sorted(set(failures)))
        )


def atomic_write(path: Path, content: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.is_file() and path.read_bytes() == content:
        os.chmod(path, mode)
        return
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def run(command: list[str], *, input_text: str | None = None) -> None:
    subprocess.run(command, check=True, input=input_text, text=True)


def install_packages(manifest: dict[str, object]) -> None:
    runtime = manifest["runtime"]
    assert isinstance(runtime, dict)
    run(["apt-get", "update"])
    ubuntu_packages = runtime["ubuntuPackages"]
    assert isinstance(ubuntu_packages, list)
    run(["apt-get", "install", "-y", *map(str, ubuntu_packages)])
    Path("/etc/apt/keyrings").mkdir(mode=0o755, exist_ok=True)
    download(
        "https://download.docker.com/linux/ubuntu/gpg",
        Path("/etc/apt/keyrings/docker.asc"),
        str(runtime["dockerAptKeySha256"]),
        0o644,
    )
    atomic_write(
        Path("/etc/apt/sources.list.d/docker.list"),
        (
            "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] "
            "https://download.docker.com/linux/ubuntu noble stable\n"
        ).encode(),
        0o644,
    )
    run(["apt-get", "update"])
    run([
        "apt-get", "install", "-y",
        str(runtime["dockerEnginePackage"]),
        str(runtime["dockerEngineCliPackage"]),
        str(runtime["containerdPackage"]),
        str(runtime["dockerBuildxPackage"]),
        str(runtime["dockerComposePackage"]),
    ])

    install_release_binaries(runtime)
    run(["systemctl", "enable", "--now", "docker", "ssh"])


def download(url: str, destination: Path, sha256: str, mode: int) -> None:
    with urllib.request.urlopen(url) as response:
        payload = response.read()
    if hashlib.sha256(payload).hexdigest() != sha256:
        raise FoundationError(f"Checksum mismatch for {destination.name}")
    atomic_write(destination, payload, mode)


def install_release_binaries(runtime: dict[str, object]) -> None:
    caddy = runtime["caddy"]
    node = runtime["node"]
    assert isinstance(caddy, dict) and isinstance(node, dict)
    install_secret_tools(runtime, Path("/usr/local/bin"))

    with tempfile.TemporaryDirectory(prefix="inside-node.") as temporary:
        archive = Path(temporary) / "node.tar.xz"
        download(
            f"https://nodejs.org/dist/v{node['version']}/node-v{node['version']}-linux-x64.tar.xz",
            archive,
            str(node["sha256"]),
            0o600,
        )
        run(["tar", "-xJf", str(archive), "-C", temporary])
        binary = (
            Path(temporary)
            / f"node-v{node['version']}-linux-x64"
            / "bin/node"
        )
        atomic_write(Path("/usr/local/bin/node"), binary.read_bytes(), 0o755)

    with tempfile.TemporaryDirectory(prefix="inside-caddy.") as temporary:
        package = Path(temporary) / "caddy.deb"
        download(
            f"https://github.com/caddyserver/caddy/releases/download/v{caddy['version']}/caddy_{caddy['version']}_linux_amd64.deb",
            package,
            str(caddy["sha256"]),
            0o600,
        )
        run(["dpkg", "--install", str(package)])


def install_secret_tools(runtime: dict[str, object], destination: Path) -> None:
    sops = runtime["sops"]
    age = runtime["age"]
    assert isinstance(sops, dict) and isinstance(age, dict)
    destination.mkdir(parents=True, exist_ok=True)
    download(
        f"https://github.com/getsops/sops/releases/download/v{sops['version']}/sops-v{sops['version']}.linux.amd64",
        destination / "sops",
        str(sops["sha256"]),
        0o755,
    )

    with tempfile.TemporaryDirectory(prefix="inside-age.") as temporary:
        archive = Path(temporary) / "age.tar.gz"
        download(
            f"https://github.com/FiloSottile/age/releases/download/v{age['version']}/age-v{age['version']}-linux-amd64.tar.gz",
            archive,
            str(age["sha256"]),
            0o600,
        )
        run(["tar", "-xzf", str(archive), "-C", temporary])
        for binary in ("age", "age-keygen"):
            source = Path(temporary) / f"age/age{('-keygen' if binary == 'age-keygen' else '')}"
            atomic_write(destination / binary, source.read_bytes(), 0o755)


def ensure_identity(manifest: dict[str, object]) -> None:
    identity = manifest["identity"]
    assert isinstance(identity, dict)
    group = str(identity["deployGroup"])
    user = str(identity["deployUser"])
    if subprocess.run(["getent", "group", group], check=False).returncode != 0:
        run(["groupadd", "--system", group])
    if subprocess.run(["id", user], check=False).returncode != 0:
        run([
            "useradd", "--system", "--gid", group, "--home-dir", "/srv/inside",
            "--shell", "/bin/sh", user,
        ])


def command_output(command: list[str]) -> str:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def verify_runtime_versions(manifest: dict[str, object]) -> None:
    runtime = manifest["runtime"]
    assert isinstance(runtime, dict)
    age = runtime["age"]
    caddy = runtime["caddy"]
    node = runtime["node"]
    sops = runtime["sops"]
    assert all(isinstance(value, dict) for value in (age, caddy, node, sops))
    checks = (
        (
            ["docker", "version", "--format", "{{.Server.Version}}"],
            str(runtime["dockerEngineVersion"]),
        ),
        (
            ["docker", "compose", "version", "--short"],
            str(runtime["dockerComposeVersion"]),
        ),
        (["docker", "buildx", "version"], f"v{runtime['dockerBuildxVersion']}"),
        (["caddy", "version"], f"v{caddy['version']}"),
        (["node", "--version"], f"v{node['version']}"),
        (["sops", "--version"], str(sops["version"])),
        (["age", "--version"], str(age["version"])),
    )
    failures = []
    for command, expected in checks:
        actual = command_output(command)
        if expected not in actual:
            failures.append(
                command[0] if len(command) == 2 else " ".join(command[:2])
            )
    if failures:
        raise FoundationError(
            "Runtime version verification failed: " + ", ".join(failures)
        )


def bootstrap(root: Path, facts_path: Path | None, skip_packages: bool) -> None:
    manifest = load_manifest()
    preflight(root, facts_path, manifest)
    real_host = root.resolve() == Path("/")
    if real_host and not skip_packages:
        install_packages(manifest)
        ensure_identity(manifest)
    elif real_host:
        ensure_identity(manifest)

    paths = manifest["paths"]
    assert isinstance(paths, dict)
    directory_modes = {
        str(paths["ageIdentity"]): 0o700,
        str(paths["state"]): 0o750,
        str(paths["evidence"]): 0o750,
        str(paths["foundation"]): 0o755,
        str(paths["releases"]): 0o750,
        str(paths["runtime"]): 0o755,
        f"{paths['runtime']}/caddy": 0o755,
        str(paths["secrets"]): 0o700,
    }
    for absolute, mode in directory_modes.items():
        path = rooted(root, absolute)
        path.mkdir(parents=True, exist_ok=True)
        os.chmod(path, mode)

    install_files(root)
    marker = rooted(root, str(paths["state"])) / ".inside-foundation"
    atomic_write(marker, b"schemaVersion=1\n", 0o640)

    if real_host:
        configure_host_services(manifest)


def install_files(root: Path) -> None:
    database_dir = SOURCE_DIR.parent / "database"
    files = {
        "/etc/caddy/Caddyfile": (SOURCE_DIR / "Caddyfile", 0o644),
        "/etc/ssh/sshd_config.d/inside-deploy.conf": (
            SOURCE_DIR / "inside-deploy.sshd.conf", 0o644,
        ),
        "/etc/sudoers.d/inside-deploy": (SOURCE_DIR / "inside-deploy.sudoers", 0o440),
        "/usr/local/libexec/inside/foundation.json": (MANIFEST_PATH, 0o644),
        "/usr/local/libexec/inside/host-foundation.py": (Path(__file__), 0o755),
        "/usr/local/libexec/inside/inside-deploy-command": (
            SOURCE_DIR / "inside-deploy-command", 0o755,
        ),
        "/usr/local/libexec/inside/database-backup": (
            database_dir / "database-backup", 0o755,
        ),
        "/etc/systemd/system/inside-pgbackrest-backup@.service": (
            database_dir / "inside-pgbackrest-backup@.service", 0o644,
        ),
        "/etc/systemd/system/inside-pgbackrest-diff.timer": (
            database_dir / "inside-pgbackrest-diff.timer", 0o644,
        ),
        "/etc/systemd/system/inside-pgbackrest-full.timer": (
            database_dir / "inside-pgbackrest-full.timer", 0o644,
        ),
        "/etc/systemd/system/inside-pgbackrest-incr.timer": (
            database_dir / "inside-pgbackrest-incr.timer", 0o644,
        ),
    }
    for destination, (source, mode) in files.items():
        atomic_write(rooted(root, destination), source.read_bytes(), mode)

    foundation = rooted(root, "/opt/inside/foundation/v1")
    production_root = SOURCE_DIR.parent
    for component in ("config", "database", "logto", "secrets"):
        component_root = production_root / component
        for source in component_root.rglob("*"):
            if not source.is_file() or "__pycache__" in source.parts:
                continue
            relative = source.relative_to(production_root)
            source_mode = stat.S_IMODE(source.stat().st_mode)
            mode = 0o755 if source_mode & 0o111 else 0o644
            atomic_write(
                foundation / "infra/production" / relative,
                source.read_bytes(),
                mode,
            )
    identity_root = SOURCE_DIR.parents[1] / "identity/logto"
    for source in identity_root.rglob("*"):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        relative = source.relative_to(identity_root)
        source_mode = stat.S_IMODE(source.stat().st_mode)
        mode = 0o755 if source_mode & 0o111 else 0o644
        atomic_write(
            foundation / "infra/identity/logto" / relative,
            source.read_bytes(),
            mode,
        )
    atomic_write(
        foundation / "infra/production/secrets/production-secrets.mjs",
        (SOURCE_DIR.parents[2] / "scripts/production-secrets.mjs").read_bytes(),
        0o644,
    )
    atomic_symlink(rooted(root, "/opt/inside/foundation") / "current", "v1")


def configure_host_services(manifest: dict[str, object]) -> None:
    run(["sshd", "-t"])
    run(["visudo", "--check", "--file", "/etc/sudoers.d/inside-deploy"])
    run(["caddy", "validate", "--config", "/etc/caddy/Caddyfile"])
    run(["systemctl", "daemon-reload"])
    for command in (
        ["ufw", "default", "deny", "incoming"],
        ["ufw", "default", "allow", "outgoing"],
        ["ufw", "allow", "22/tcp"],
        ["ufw", "allow", "80/tcp"],
        ["ufw", "allow", "443/tcp"],
        ["ufw", "--force", "enable"],
        ["systemctl", "enable", "--now", "caddy"],
        ["systemctl", "reload", "ssh"],
    ):
        run(command)
    verify_runtime_versions(manifest)


def validate_version(value: str) -> str:
    if not VERSION_PATTERN.fullmatch(value):
        raise FoundationError("Release version must match vN")
    return value


def symlink_target(path: Path) -> str | None:
    if not path.is_symlink():
        if path.exists():
            raise FoundationError(f"Unsafe release pointer: {path.name}")
        return None
    target = os.readlink(path)
    if "/" in target or not VERSION_PATTERN.fullmatch(target):
        raise FoundationError(f"Unsafe release pointer: {path.name}")
    return target


def atomic_symlink(path: Path, target: str) -> None:
    temporary = path.parent / f".{path.name}.{os.getpid()}"
    try:
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def deploy(root: Path, original_command: str) -> None:
    manifest = load_manifest()
    arguments = shlex.split(original_command)
    paths = manifest["paths"]
    identity = manifest["identity"]
    assert isinstance(paths, dict) and isinstance(identity, dict)
    releases = rooted(root, str(paths["releases"]))
    releases.mkdir(parents=True, exist_ok=True)

    if arguments == ["foundation", "preflight"]:
        verify_foundation(root)
        print("foundation ready")
        return
    if arguments == ["release", "status"]:
        print(json.dumps({
            "current": symlink_target(releases / "current"),
            "previous": symlink_target(releases / "previous"),
        }, sort_keys=True))
        return
    if arguments == ["release", "prune"]:
        protected = {
            target
            for target in (
                symlink_target(releases / "current"),
                symlink_target(releases / "previous"),
            )
            if target is not None
        }
        candidates = sorted(
            (
                path for path in releases.iterdir()
                if path.is_dir()
                and not path.is_symlink()
                and VERSION_PATTERN.fullmatch(path.name)
            ),
            key=lambda path: int(path.name[1:]),
        )
        reserve_target = max(0, int(identity["releaseRetention"]) - 1)
        removed = []
        for candidate in candidates:
            if len(candidates) - len(removed) <= reserve_target:
                break
            if candidate.name in protected:
                continue
            shutil.rmtree(candidate)
            removed.append(candidate.name)
        if len(candidates) - len(removed) > reserve_target:
            raise FoundationError("Protected releases exceed retention reserve")
        print(json.dumps({"removed": removed}, sort_keys=True))
        return
    if len(arguments) == 3 and arguments[:2] == ["release", "prepare"]:
        version = validate_version(arguments[2])
        existing = sorted(
            path for path in releases.iterdir()
            if path.is_dir() and VERSION_PATTERN.fullmatch(path.name)
        )
        if not (releases / version).exists() and len(existing) >= int(identity["releaseRetention"]):
            raise FoundationError("Release retention limit reached")
        release = releases / version
        release.mkdir(mode=0o750, exist_ok=True)
        os.chmod(release, 0o750)
        print(version)
        return
    if len(arguments) == 3 and arguments[:2] == ["release", "activate"]:
        version = validate_version(arguments[2])
        release = releases / version
        manifest_path = release / "manifest.json"
        if not release.is_dir() or release.is_symlink() or not manifest_path.is_file():
            raise FoundationError("Prepared release manifest is missing")
        if manifest_path.is_symlink():
            raise FoundationError("Prepared release manifest must not be a symlink")
        manifest_mode = stat.S_IMODE(manifest_path.stat().st_mode)
        if manifest_mode & 0o022:
            raise FoundationError("Prepared release manifest permissions are unsafe")
        current = symlink_target(releases / "current")
        if current == version:
            print(version)
            return
        if current is not None:
            atomic_symlink(releases / "previous", current)
        atomic_symlink(releases / "current", version)
        print(version)
        return
    raise FoundationError("Deploy command is not allowlisted")


def verify_foundation(root: Path) -> None:
    manifest = load_manifest()
    paths = manifest["paths"]
    assert isinstance(paths, dict)
    required = {
        str(paths["state"]): 0o750,
        str(paths["releases"]): 0o750,
        str(paths["secrets"]): 0o700,
        "/etc/sudoers.d/inside-deploy": 0o440,
        "/usr/local/libexec/inside/inside-deploy-command": 0o755,
    }
    failures = []
    for absolute, expected_mode in required.items():
        path = rooted(root, absolute)
        if not path.exists() or stat.S_IMODE(path.stat().st_mode) != expected_mode:
            failures.append(absolute)
    if failures:
        raise FoundationError("Foundation verification failed: " + ", ".join(failures))


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("preflight", "bootstrap"):
        command = subparsers.add_parser(name)
        command.add_argument("--root", type=Path, default=Path("/"))
        command.add_argument("--facts", type=Path)
        if name == "bootstrap":
            command.add_argument("--skip-packages", action="store_true")
    deploy_parser = subparsers.add_parser("deploy")
    deploy_parser.add_argument("--original-command", required=True)
    fixture_deploy_parser = subparsers.add_parser("deploy-fixture")
    fixture_deploy_parser.add_argument("--root", required=True, type=Path)
    fixture_deploy_parser.add_argument("--original-command", required=True)
    tool_parser = subparsers.add_parser("install-secret-tools")
    tool_parser.add_argument("--destination", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        if arguments.command == "preflight":
            preflight(arguments.root, arguments.facts, load_manifest())
            print("host preflight passed")
        elif arguments.command == "bootstrap":
            bootstrap(arguments.root, arguments.facts, arguments.skip_packages)
            print("host bootstrap converged")
        elif arguments.command == "install-secret-tools":
            install_secret_tools(load_manifest()["runtime"], arguments.destination)
            print("pinned secret tools installed")
        elif arguments.command == "deploy":
            deploy(Path("/"), arguments.original_command)
        else:
            deploy(arguments.root, arguments.original_command)
        return 0
    except (FoundationError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
