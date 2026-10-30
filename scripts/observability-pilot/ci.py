"""No-secrets hosted pilot admission, exact-project recovery and curated artifacts."""

import argparse
import contextlib
import hashlib
from importlib.machinery import ModuleSpec
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import stat
import types
import sys
import pilot
import core_timing
import source_status
import orbstack

from pilot import CONFIG, ROOT, check_disk, cleanup_project, write_json

CI_COMMAND_TIMEOUT_SECONDS = 10
PUBLIC_ARTIFACT_MAX_BYTES = 1024 * 1024
PILOT_ARTIFACTS = (
    "source-freshness.json", "evidence.json", "cleanup.json", "worker-outcome.json", "native-mcp.json", "native-mcp-progress.json",
    "query-timings.json", "negative-failures.json", "recovery.json",
    "container-states.json", "readiness.json", "storage-host.json", "storage-vm.json", "monitor-failure.json", "collector-privacy.json", "collector-link-privacy.json", "trace-store-health.json", "trace-store-logging.json", "notification-collector.json", "dependency-collector.json", "email-collector.json", "telegram-runtime-collector.json", "collector-logging.json",
    "phase-idle.json", "phase-steady.json", "phase-spike.json",
    "stats-idle.jsonl", "stats-steady.jsonl", "stats-spike.jsonl",
)
METADATA_ARTIFACTS = ("source.json", "admission.json")
# Keep inactive controller imports independent of the diagnostic query helper.
REJECTION_NAME = 'source-status-rejection.json'
REJECTION_MAX_BYTES = 4096


def _directory_identity(info):
    return info.st_dev, info.st_ino, info.st_uid, info.st_mode


def _file_identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _rejection_metadata(metadata):
    # This reader must remain independent of the as-yet-unverified query code.
    if (not metadata.is_absolute() or len(metadata.parts) > 64
            or metadata != metadata.resolve(strict=True)):
        raise ValueError('closed rejection metadata contract')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    with contextlib.ExitStack() as stack:
        directory = os.open(metadata.anchor, flags)
        stack.callback(os.close, directory)
        for component in metadata.parts[1:]:
            directory = os.open(component, flags, dir_fd=directory)
            stack.callback(os.close, directory)
        owner = os.fstat(directory)
        identity = _directory_identity(owner)
        if (not stat.S_ISDIR(owner.st_mode) or owner.st_uid != os.getuid()
                or stat.S_IMODE(owner.st_mode) != 0o700):
            raise ValueError('closed rejection metadata contract')
        descriptor = os.open('source.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                             dir_fd=directory)
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                    or info.st_nlink != 1 or info.st_size > PUBLIC_ARTIFACT_MAX_BYTES):
                raise ValueError('closed rejection metadata contract')
            raw = stream.read(PUBLIC_ARTIFACT_MAX_BYTES + 1)
            linked = os.stat('source.json', dir_fd=directory, follow_symlinks=False)
            if (len(raw) > PUBLIC_ARTIFACT_MAX_BYTES
                    or _file_identity(info) != _file_identity(os.fstat(stream.fileno()))
                    or _file_identity(info) != _file_identity(linked)):
                raise ValueError('closed rejection metadata contract')
        if (metadata != metadata.resolve(strict=True)
                or _directory_identity(os.fstat(directory)) != identity
                or _directory_identity(metadata.stat(follow_symlinks=False)) != identity):
            raise ValueError('closed rejection metadata contract')
    return source_status.decode_json(raw)


def _fresh_rejection_source(metadata):
    # Re-read the current immutable execution and every admitted byte. No reduced
    # diagnostic input list can accidentally authorize a stale runtime helper.
    value = _rejection_metadata(metadata)
    if (type(value) is not dict or type(value.get('inputs')) is not dict
            or value.get('scope') != core_timing.METADATA_SCOPE
            or not core_timing.source_ok(value.get('checkout_sha'))
            or not core_timing.source_ok(value.get('checkout_tree'))
            or value.get('provider_execution_sha') != value['checkout_sha']):
        raise ValueError('closed rejection source contract')
    inputs = {str(path.relative_to(ROOT)): path.read_bytes() for path in _admission_inputs()}
    expected = {name: hashlib.sha256(raw).hexdigest() for name, raw in inputs.items()}
    if (value['inputs'] != expected
            or read_command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']) != value['checkout_sha']
            or read_command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD^{tree}']) != value['checkout_tree']
            or read_command(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no', '--', *expected])):
        raise ValueError('closed rejection source contract')
    return value['checkout_sha'], inputs['scripts/observability-pilot/source_status_query.py']


def _rejection_query(raw):
    path = ROOT / 'scripts/observability-pilot/source_status_query.py'
    existing = sys.modules.get('source_status_query')
    if existing is not None:
        if type(existing) is not types.ModuleType:
            raise ValueError('closed rejection query import contract')
        attributes = vars(existing)
        spec = attributes.get('__spec__')
        if (type(attributes.get('__file__')) is not str or attributes['__file__'] != str(path)
                or type(spec) is not ModuleSpec or type(spec.origin) is not str or spec.origin != str(path)):
            raise ValueError('closed rejection query import contract')
    # Never import/reopen the path after validation, or reuse a cached module's
    # functions. Only the fixed helper bytes from the fresh complete map execute.
    module = types.ModuleType('source_status_query')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def collect(output, metadata, destination, *, artifacts=None):
    """Copy only regular bounded JSON evidence, never a private report directory."""
    if artifacts is not None and any(type(name) is not str or Path(name).name != name for name in artifacts):
        raise ValueError('artifact selection requires basenames')
    rejection = None
    diagnostic = output / REJECTION_NAME
    if (artifacts is None or REJECTION_NAME in artifacts) and (diagnostic.exists() or diagnostic.is_symlink()):
        try:
            output_identity = _directory_identity(output.stat(follow_symlinks=False))
            source, raw = _fresh_rejection_source(metadata)
            query = _rejection_query(raw)
            rejection = query._read_rejection(output, source, output_identity)
        except OSError:
            raise ValueError('closed rejection file contract') from None
    timing=None
    if artifacts is None:
        if output.is_symlink() or metadata.is_symlink():raise ValueError('unsafe core timing source')
        timing_source=core_timing.source_from_metadata(metadata/'source.json')
        timing=core_timing.read(output/core_timing.NAME,timing_source)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    destination_identity = _directory_identity(destination.stat(follow_symlinks=False))
    for source_root, names in ((metadata, METADATA_ARTIFACTS), (output, PILOT_ARTIFACTS if artifacts is None else artifacts)):
        if source_root.is_symlink():
            raise ValueError("artifact source directory cannot be a symlink")
        for name in names:
            if name == REJECTION_NAME:
                continue  # This basename never reaches generic raw copying, including explicit selection.
            source = source_root / name
            if not source.exists():
                continue
            if source.is_symlink() or not source.is_file() or source.stat().st_size > PUBLIC_ARTIFACT_MAX_BYTES:
                raise ValueError("unsafe public artifact file")
            content = source.read_text()
            if name == "native-mcp-progress.json":
                pilot.read_native_mcp_progress(content)
            elif source.suffix == ".jsonl":
                for line in content.splitlines():
                    json.loads(line)
            else:
                json.loads(content)
            (destination / name).write_text(content)

    if timing is not None:core_timing.write(destination/core_timing.NAME,timing,timing_source)
    if rejection is not None:
        raw = (json.dumps(rejection, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
        if len(raw) > REJECTION_MAX_BYTES:
            raise ValueError('closed rejection size contract')
        with query._owned_directory(destination, destination_identity) as (directory, _):
            descriptor = os.open(REJECTION_NAME,
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                                 0o600, dir_fd=directory)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(raw)
                stream.flush()
                info = os.fstat(stream.fileno())
                linked = os.stat(REJECTION_NAME, dir_fd=directory, follow_symlinks=False)
                if (_file_identity(info) != _file_identity(linked)
                        or info.st_nlink != 1):
                    raise ValueError('closed rejection publication contract')


def recover(output, *, project_prefix="inside-observability-pilot-", services=None):
    owner_path = output / "owner.json"
    if not owner_path.exists():
        return {"state": "no registered project acquired"}
    if output.is_symlink() or owner_path.is_symlink():
        raise ValueError("recovery requires regular ownership records")
    owner = json.loads(owner_path.read_text())
    if (not isinstance(owner, dict) or not isinstance(owner.get("project"), str)
            or not re.fullmatch(re.escape(project_prefix) + r"[0-9a-f]{12}", owner["project"])
            or owner.get("cwd") != str(ROOT)):
        raise ValueError("recovery requires the owned random pilot project and checkout")
    pilot.restore_daemon(owner)
    worker_path = output / "worker.json"
    if not worker_path.is_file() or worker_path.is_symlink():
        raise ValueError("worker registration missing; disposable runner teardown required")
    worker = json.loads(worker_path.read_text())
    if (not isinstance(worker, dict) or type(worker.get("pid")) is not int
            or worker["pid"] <= 0 or worker.get("group") != worker["pid"]):
        raise ValueError("invalid worker registration")
    try:
        os.kill(worker["pid"], 0)
    except ProcessLookupError:
        pass
    else:
        raise ValueError("registered worker still exists; supervisor or disposable runner teardown required")
    try:
        os.killpg(worker["group"], 0)
    except ProcessLookupError:
        pass
    else:
        raise ValueError("registered worker process group still exists; disposable runner teardown required")
    compose_file = output / "compose.json"
    if not compose_file.is_file() or compose_file.is_symlink():
        raise ValueError("owned Compose input missing")
    # Never execute arbitrary argv copied from owner.json.
    compose = ["docker", "compose", "-p", owner["project"], "-f", str(compose_file)]
    result = cleanup_project(compose, output, owner["project"], **({"services": services} if services is not None else {}))
    write_json(output / "recovery.json", result)
    if result["down"] != "passed" or result["residue"] != "passed":
        raise RuntimeError("exact-project recovery incomplete")
    return result


def read_command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          timeout=CI_COMMAND_TIMEOUT_SECONDS).stdout.strip()


def _admission_inputs():
    inputs = (CONFIG / "inputs.lock.json", CONFIG / "config.alloy", CONFIG / "privacy-policy.json", CONFIG / "Caddyfile",
              CONFIG / "vmauth.routes.json", CONFIG / 'probe.lock.json', CONFIG / "owner-overview.json", Path(__file__),
              Path(__file__).with_name("core_timing.py"), Path(__file__).with_name("source_status.py"), Path(__file__).with_name("source_status_query.py"), Path(__file__).with_name("source_status_scenario.py"), Path(__file__).with_name("pilot.py"), Path(__file__).with_name("owner_overview.py"), Path(__file__).with_name("native_cpu.py"), Path(__file__).with_name("privacy_config.py"), Path(__file__).with_name("collector_privacy.py"), Path(__file__).with_name("link_privacy.py"), Path(__file__).with_name("notification_privacy.py"), Path(__file__).with_name("dependency_privacy.py"), Path(__file__).with_name("email_privacy.py"), Path(__file__).with_name("telegram_http_storage.py"), Path(__file__).with_name("telegram_runtime_privacy.py"), Path(__file__).with_name("telegram_runtime_oracle.py"), Path(__file__).with_name("daemon.py"), Path(__file__).with_name('orbstack.py'), Path(__file__).with_name('storage_policy.py'),
              ROOT / ".github/workflows/observability-pilot.yml", ROOT / "apps/backend/openapi/platform-api.json")
    return (*inputs, *sorted((ROOT / 'infra/observability/horizon').glob('*')),
            Path(__file__).with_name('horizon_build.py'), ROOT / 'scripts/heavy-check/bounded.py')


def admission(metadata, *, inputs=None, scope=None):
    metadata.mkdir(mode=0o700, parents=True, exist_ok=False)
    sha = read_command(["git", "-C", str(ROOT), "rev-parse", "HEAD"])
    if read_command(["git", "-C", str(ROOT), "status", "--porcelain"]):
        raise ValueError("hosted proof requires clean committed source")
    if sha != os.environ.get("GITHUB_SHA"):
        raise ValueError("checkout SHA does not match provider execution SHA")
    inputs = _admission_inputs() if not inputs else (*inputs,
              *sorted((ROOT / 'infra/observability/horizon').glob('*')),
              Path(__file__).with_name('horizon_build.py'), ROOT / 'scripts/heavy-check/bounded.py')
    write_json(metadata / "source.json", {
        "checkout_sha": sha,
        "checkout_tree": read_command(["git", "-C", str(ROOT), "rev-parse", "HEAD^{tree}"]),
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "event": os.environ.get("GITHUB_EVENT_NAME"),
        "provider_execution_sha": os.environ.get("GITHUB_SHA"),
        "provider_pr_head_sha": os.environ.get("PILOT_PR_HEAD_SHA"),
        "provider_pr_base_sha": os.environ.get("PILOT_PR_BASE_SHA"),
        "inputs": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs},
        "scope": scope or "Linux hosted functional smoke; not Timeweb capacity, Mac MCP or full resource acceptance",
    })
    try:
        storage = Path(read_command(["docker", "info", "--format", "{{.DockerRootDir}}"]))
        if not storage.is_absolute() or not storage.is_dir():
            raise ValueError("local Docker storage filesystem not identified")
        storage = storage.resolve()
        disk = shutil.disk_usage(storage)
        result = {"storage_filesystem_path": str(storage), **check_disk(total=disk.total, free=disk.free)}
        code = 0 if result["ready"] else 2
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result = {"ready": False, "error_type": type(error).__name__}
        code = 1
    write_json(metadata / "admission.json", result)
    print(json.dumps(result))
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("admission", "recover", "collect"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "admission":
        return admission(args.metadata)
    if args.action == "recover":
        print(json.dumps(recover(args.output)))
    else:
        collect(args.output, args.metadata, args.public)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"observability-pilot-ci: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
