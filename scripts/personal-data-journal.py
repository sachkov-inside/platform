#!/usr/bin/env python3
"""Manually archive a private request journal, separately from PostgreSQL backups."""
import argparse
import datetime
import json
import os
import pathlib
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import uuid

LIMIT = 8 * 1024 * 1024
PREFIX = "personal-data-journal/"


def private_bytes(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
            raise ValueError("private regular file required")
        data = source.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("journal too large")
    return data


def validate(data):
    for line in data.decode("utf-8").splitlines():
        if not isinstance(json.loads(line), dict):
            raise ValueError("journal must contain JSON objects")
    return data


def age(data, *arguments):
    return subprocess.run(
        ["age", *arguments], input=data, capture_output=True, check=True,
        timeout=30,
    ).stdout


def config(directory):
    names = {
        "PGBACKREST_REPO1_S3_BUCKET", "PGBACKREST_REPO1_S3_ENDPOINT",
        "PGBACKREST_REPO1_S3_REGION", "PGBACKREST_REPO1_S3_URI_STYLE",
        "PGBACKREST_REPO1_S3_KEY", "PGBACKREST_REPO1_S3_KEY_SECRET",
    }
    result = {}
    for name in ("database.env", "pgbackrest.env"):
        for line in private_bytes(directory / name).decode("utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key in names:
                values = shlex.split(value, comments=True)
                if key in result or len(values) != 1:
                    raise ValueError("invalid configuration")
                result[key] = values[0]
    if not names.issubset(result):
        raise ValueError("missing configuration")
    return result


def storage(directory):
    # The existing production host supplies boto3. Tests inject a storage boundary.
    import boto3
    from botocore.config import Config
    values = config(directory)
    endpoint = values["PGBACKREST_REPO1_S3_ENDPOINT"]
    if "://" not in endpoint:
        endpoint = "https://" + endpoint
    if not endpoint.startswith("https://"):
        raise ValueError("HTTPS required")
    addressing_style = {"host": "virtual", "path": "path"}[values["PGBACKREST_REPO1_S3_URI_STYLE"]]
    client = boto3.client(
        "s3", endpoint_url=endpoint,
        region_name=values["PGBACKREST_REPO1_S3_REGION"],
        aws_access_key_id=values["PGBACKREST_REPO1_S3_KEY"],
        aws_secret_access_key=values["PGBACKREST_REPO1_S3_KEY_SECRET"],
        config=Config(connect_timeout=10, read_timeout=30,
                      retries={"total_max_attempts": 2},
                      s3={"addressing_style": addressing_style}),
    )
    return client, values["PGBACKREST_REPO1_S3_BUCKET"]


def download(client, bucket, key):
    if not key.startswith(PREFIX) or not key.endswith(".age"):
        raise ValueError("journal object key required")
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    try:
        data = body.read(LIMIT + 65537)
    finally:
        body.close()
    if len(data) > LIMIT + 65536:
        raise ValueError("archive too large")
    return data


def backup(client, bucket, journal, recipients, identity):
    data = validate(private_bytes(journal))
    private_bytes(recipients)
    encrypted = age(data, "--encrypt", "--recipients-file", str(recipients))
    key = PREFIX + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex + ".age"
    client.put_object(Bucket=bucket, Key=key, Body=encrypted,
                      ContentType="application/octet-stream", IfNoneMatch="*")
    checked = validate(age(download(client, bucket, key), "--decrypt", "--identity", str(identity)))
    if checked != data:
        raise ValueError("archive verification failed")
    return {"objectKey": key, "verified": True}


def restore(client, bucket, key, identity, output):
    data = validate(age(download(client, bucket, key), "--decrypt", "--identity", str(identity)))
    if output.parent.is_symlink() or output.parent.stat().st_mode & 0o077:
        raise ValueError("private output directory required")
    # An exclusive link publishes a complete 0600 file without replacing a live journal.
    descriptor, temporary = tempfile.mkstemp(prefix=".journal-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(data)
            destination.flush()
            os.fsync(destination.fileno())
        os.link(temporary, output)
    finally:
        os.unlink(temporary)
    return {"objectKey": key, "restored": True}


def terminate(_signal, _frame):
    # Unwind subprocess.run and restore's finally block before leaving the operator CLI.
    raise KeyboardInterrupt


def main():
    for signum in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-dir", type=pathlib.Path, default=pathlib.Path("/etc/inside/foundation"))
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("backup")
    export.add_argument("--journal", type=pathlib.Path, required=True)
    export.add_argument("--recipients", type=pathlib.Path, required=True)
    export.add_argument("--identity", type=pathlib.Path, required=True)
    recovery = commands.add_parser("restore")
    recovery.add_argument("--key", required=True)
    recovery.add_argument("--identity", type=pathlib.Path, required=True)
    recovery.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        private_bytes(args.identity)
        client, bucket = storage(args.config_dir)
        if args.command == "backup":
            receipt = backup(client, bucket, args.journal, args.recipients, args.identity)
        else:
            receipt = restore(client, bucket, args.key, args.identity, args.output)
        print(json.dumps(receipt))
    except (Exception, KeyboardInterrupt):
        # Provider and crypto exceptions may contain protected values.
        print("journal operation failed; no successful receipt issued", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
