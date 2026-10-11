#!/usr/bin/env python3
"""Restore a staged pgBackRest repository without ports or network access."""
import argparse
import datetime
import json
import pathlib
import re
import signal
import subprocess
import sys
import time
import uuid

DATABASES = ("inside", "logto", "inside_telegram")
PREFIX = "inside-production-postgres-data-recovery-check-"
DOCKER_TIMEOUT_SECONDS = 900


def run(*args, input_text=None):
    return subprocess.run(
        ["docker", *args], input=input_text, text=True,
        capture_output=True, check=True, timeout=DOCKER_TIMEOUT_SECONDS,
    ).stdout.strip()


def terminate(_signum, _frame):
    # Default SIGTERM skips finally; translate it into a cleanup-aware interruption.
    raise KeyboardInterrupt


def restore(image, repository, cipher_env, label, execute=run):
    # Local image IDs and immutable digests only. Never resolve a moving tag.
    if not re.fullmatch(r"(?:[^\s@]+@)?sha256:[a-f0-9]{64}", image):
        raise ValueError("restore image must be digest pinned")
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}[FDI](?:_[0-9]{8}-[0-9]{6}[DI])?", label):
        raise ValueError("invalid backup label")
    if not repository.is_dir() or not cipher_env.is_file():
        raise ValueError("staged repository and protected cipher env are required")
    if cipher_env.stat().st_mode & 0o077:
        raise ValueError("cipher env must have mode 0600")
    volume = PREFIX + uuid.uuid4().hex
    container = "inside-restore-check-" + uuid.uuid4().hex
    restore_container = "inside-restore-copy-" + uuid.uuid4().hex
    created = False
    containers = []
    try:
        # A unique new volume, never the foundation's configured live volume.
        execute("volume", "create", "--label", "inside.restore-check=true", volume)
        created = True
        common = ("--network", "none", "--pull", "never",
                  "--mount", f"type=volume,src={volume},dst=/var/lib/postgresql",
                  "--env-file", str(cipher_env),
                  "--env", "PGBACKREST_REPO1_TYPE=posix",
                  "--env", "PGBACKREST_REPO1_PATH=/backup",
                  "--env", "PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc",
                  "--mount", f"type=bind,src={repository.resolve()},dst=/backup,readonly")
        containers.append(restore_container)
        execute("run", "--name", restore_container, *common,
                "--env", f"INSIDE_RESTORE_VOLUME={volume}",
                "--entrypoint", "inside-pgbackrest-restore", image,
                "--stanza=production", "--repo1-type=posix", "--repo1-path=/backup",
                "--repo1-cipher-type=aes-256-cbc", "--archive-mode=off",
                f"--set={label}", "--type=immediate", "--target-action=promote", "restore")
        containers.append(container)
        execute("run", "--detach", "--name", container, *common,
                "--entrypoint", "docker-entrypoint.sh", image, "postgres",
                "-c", "listen_addresses=", "-c", "archive_mode=off")
        # pg_isready only triggers inspection; SQL recovery completion proves readiness.
        deadline = time.monotonic() + 120
        while True:
            try:
                recovery = execute("exec", "--user", "postgres", container, "psql", "-XAt",
                                   "--dbname", "postgres", "--command", "SELECT pg_is_in_recovery();")
                if recovery == "f":
                    break
            except subprocess.CalledProcessError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("restored cluster did not finish recovery")
            time.sleep(0.5)
        checks = {
            "inside": "SELECT count(*) FROM public.platform_migrations; SELECT count(*) FROM accounts.accounts; SELECT count(*) FROM account_rights.access_grants; SELECT count(*) FROM reading_activity.material_visits;",
            "logto": "SELECT count(*) FROM public.users;",
            "inside_telegram": "SELECT count(*) FROM public.community_operations;",
        }
        for database in DATABASES:
            execute("exec", "--interactive", "--user", "postgres", container,
                    "psql", "-XAt", "--set", "ON_ERROR_STOP=1", "--dbname", database,
                    input_text="BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; " + checks[database] + " COMMIT;")
        return {
            "backupLabel": label,
            "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "exitCode": 0, "volume": volume, "networkMode": "none", "publishedPorts": 0,
            "databasesPassed": list(DATABASES),
        }
    finally:
        # Cleanup failure makes the command fail; it must never report a green receipt.
        cleanup_error = None
        try:
            for owned_container in reversed(containers):
                try:
                    execute("rm", "--force", owned_container)
                except subprocess.SubprocessError as error:
                    cleanup_error = error
        finally:
            if created:
                execute("volume", "rm", volume)
        if cleanup_error is not None:
            raise cleanup_error


def main():
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--repository", required=True, type=pathlib.Path)
    parser.add_argument("--cipher-env", required=True, type=pathlib.Path)
    parser.add_argument("--backup-label", required=True)
    args = parser.parse_args()
    try:
        receipt = restore(args.image, args.repository, args.cipher_env, args.backup_label)
        print(json.dumps(receipt, indent=2))
    except (ValueError, OSError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt):
        # Docker/pgBackRest diagnostics can contain protected configuration.
        print("isolated restore failed; check the selected backup and Docker state", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
