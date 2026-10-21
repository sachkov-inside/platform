#!/usr/bin/env python3
"""Read-only pgBackRest info projection. Never read repository payload or secrets."""
import argparse
import datetime
import json
import os
import re
import signal
import subprocess
import sys

BACKUP_LABEL = r"[0-9]{8}-[0-9]{6}F(?:_[0-9]{8}-[0-9]{6}[DI])?"

# The daemon's exec process is not owned by the Docker client's host process group.
# Its watchdog therefore lives INSIDE the container, with separate owned process groups.
BOUNDED_READ = r'''
seconds="$1"
shift
setsid "$@" &
worker=$!
setsid sh -c 'sleep "$1"; kill -KILL -- "-$2" 2>/dev/null' guard "$seconds" "$worker" &
guard=$!
cleanup() {
  trap - EXIT HUP INT TERM
  kill -KILL -- "-$worker" "-$guard" "$worker" "$guard" 2>/dev/null || true
  wait "$worker" 2>/dev/null || true
  wait "$guard" 2>/dev/null || true
  # A child may have entered setsid between the first group signal and its direct signal.
  kill -KILL -- "-$worker" "-$guard" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM
wait "$worker"
status=$?
exit "$status"
'''


def checked(value, pattern):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("invalid metadata")
    return value


def numbers(value, keys):
    if not isinstance(value, dict):
        raise ValueError("invalid metadata")
    result = {}
    for key in keys:
        if key in value:
            number = value[key]
            if type(number) is not int or number < 0:
                raise ValueError("invalid metadata")
            result[key] = number
    return result


def project_info(raw, repository):
    if (type(repository) is not int or repository not in (1, 2)
            or not isinstance(raw, list) or len(raw) != 1
            or not isinstance(raw[0], dict)):
        raise ValueError("invalid inventory")
    stanza = raw[0]
    if stanza.get("name") != "production" or stanza.get("status", {}).get("code") != 0:
        raise ValueError("repository unavailable")
    repos = stanza.get("repo")
    if (not isinstance(repos, list) or len(repos) != 1
            or repos[0].get("key") != repository or repos[0].get("status", {}).get("code") != 0):
        raise ValueError("repository identity mismatch")
    backups = []
    if not isinstance(stanza.get("backup"), list) or not stanza["backup"]:
        raise ValueError("no retained backups")
    for item in stanza["backup"]:
        if not isinstance(item, dict) or item.get("error") is True:
            raise ValueError("invalid backup")
        label = checked(item.get("label"), BACKUP_LABEL)
        kind = checked(item.get("type"), r"full|diff|incr")
        timestamp = numbers(item.get("timestamp"), ("start", "stop"))
        size = numbers(item.get("info"), ("size", "delta"))
        if set(timestamp) != {"start", "stop"} or timestamp["stop"] < timestamp["start"]:
            raise ValueError("incomplete timestamp")
        size["repository"] = numbers(item["info"].get("repository"), ("size", "delta"))
        prior = item.get("prior")
        if prior is not None:
            checked(prior, BACKUP_LABEL)
        reference = item.get("reference")
        if reference is not None:
            if not isinstance(reference, list):
                raise ValueError("invalid references")
            reference = [checked(value, BACKUP_LABEL) for value in reference]
        archive = item.get("archive", {})
        if not isinstance(archive, dict):
            raise ValueError("invalid archive")
        backups.append({"label": label, "type": kind, "timestamp": timestamp,
                        "info": size, "prior": prior, "reference": reference,
                        "archive": {key: checked(archive[key], r"[0-9A-F]{24}")
                                    for key in ("start", "stop") if archive.get(key) is not None}})
    labels = {item["label"] for item in backups}
    if len(labels) != len(backups):
        raise ValueError("duplicate backup label")
    for item in backups:
        dependencies = (item["reference"] or []) + ([item["prior"]] if item["prior"] else [])
        if any(value not in labels or value == item["label"] for value in dependencies):
            raise ValueError("missing backup dependency")
    return {"repository": repository, "stanza": "production", "backups": backups,
            "backupCount": len(backups), "observationOnly": True,
            "walContinuityVerified": False, "providerLifecycleVerified": False,
            "historicalKeyQualityVerified": False, "rngFailureVerified": False}


def command(arguments):
    # A fixed docker exec client only. Bound and reap its owned command group on every exit.
    child = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, encoding="utf-8", errors="replace", start_new_session=True)
    try:
        stdout, stderr = child.communicate(timeout=60)
        return subprocess.CompletedProcess(arguments, child.returncode, stdout, stderr)
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()


def collect(repository, *, execute=command):
    if type(repository) is not int or repository not in (1, 2):
        raise ValueError("invalid repository")
    result = execute(["docker", "--host", "unix:///var/run/docker.sock", "exec",
                      "--user", "postgres", "inside-production-database-postgres-1",
                      "sh", "-c", BOUNDED_READ, "bounded-info", "45",
                      "pgbackrest", "--stanza=production", f"--repo={repository}", "--output=json",
                      "--log-level-console=off", "--log-level-file=off", "info"])
    if result.returncode:
        raise ValueError("inventory read failed")
    inventory = project_info(json.loads(result.stdout), repository)
    inventory["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        print(json.dumps(collect(args.repo), indent=2))
        return 0
    except (ValueError, KeyError, TypeError, AttributeError, OSError,
            subprocess.SubprocessError, KeyboardInterrupt):
        print("inventory read failed; no raw diagnostics retained", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
