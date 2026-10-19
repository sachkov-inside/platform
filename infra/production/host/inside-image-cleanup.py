#!/usr/bin/env python3
"""Remove retired application image references; retain deployment recovery material."""

import argparse
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


REPOSITORIES = (
    "ghcr.io/sachkov-inside/platform-backend",
    "ghcr.io/sachkov-inside/platform-web",
    "ghcr.io/sachkov-inside/inside-telegram",
)
MINIMUM_AGE = timedelta(days=7)
MINIMUM_IMAGES_PER_REPOSITORY = 3
DEPLOYMENTS = (
    ("deployments", "platform", ("backendImage", "webImage")),
    ("telegram-deployments", "telegram", ("image",)),
)


def object_value(value):
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def strings(value):
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("Expected a string array")
    return tuple(value)


def image_reference(value):
    if not isinstance(value, str):
        raise ValueError("Missing immutable application image reference")
    repository, separator, digest = value.partition("@")
    if repository not in REPOSITORIES or not separator or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("Invalid immutable application image reference")
    return value


def read_json(path):
    # Managed paths must not redirect this root process through a symlink.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as source:
        return object_value(json.load(source))


def deployment_references(state, operation, application, fields):
    if state.get("schemaVersion") != f"inside.{application}.deployment-state.v1":
        raise ValueError(f"Unknown {application} deployment state")
    if (operation.get("schemaVersion") != f"inside.{application}.deployment-operation.v1"
            or operation.get("status") != "succeeded" or operation.get("phase") != "complete"):
        raise ValueError(f"{application} operation is not successfully complete")
    if application == "platform" and state.get("status") != "succeeded":
        raise ValueError("Platform deployment state is not successful")
    current = object_value(state.get("current"))
    if operation.get("version") != current.get("version"):
        raise ValueError("Operation and current deployment disagree")
    references = set()
    versions = {}
    for key in ("current", "previous", "rolledBackFrom"):
        entry = state.get(key)
        if entry is None:
            continue
        entry = object_value(entry)
        version = entry.get("version")
        if not isinstance(version, str) or not re.fullmatch(r"v[1-9][0-9]*", version):
            raise ValueError("Invalid deployment version")
        versions[version] = entry
        for field in fields:
            reference = image_reference(entry.get(field))
            expected = {
                "backendImage": REPOSITORIES[0],
                "webImage": REPOSITORIES[1],
                "image": REPOSITORIES[2],
            }[field]
            if reference.partition("@")[0] != expected:
                raise ValueError("Deployment image belongs to the wrong application")
            references.add(reference)
    rollback = state.get("rollback")
    if rollback is not None:
        rollback = object_value(rollback)
        target_version = rollback.get("targetVersion")
        if not isinstance(target_version, str):
            raise ValueError("Missing rollback target version")
        target = versions.get(target_version)
        if target is None or not isinstance(rollback.get("manifestSha256"), str) or target.get("manifestSha256") != rollback["manifestSha256"]:
            raise ValueError("Rollback target is not bound to protected deployment images")
    return references


@dataclass(frozen=True)
class Image:
    identity: str
    created: datetime
    references: tuple[str, ...]
    tags: tuple[str, ...]
    size: int

    @classmethod
    def parse(cls, raw):
        raw = object_value(raw)
        identity = raw.get("Id")
        if not isinstance(identity, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", identity):
            raise ValueError("Invalid Docker image identity")
        created = raw.get("Created")
        if not isinstance(created, str):
            raise ValueError("Missing Docker image creation time")
        created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created.tzinfo is None:
            raise ValueError("Docker image creation time needs a timezone")
        size = raw.get("Size")
        if type(size) is not int or size < 0:
            raise ValueError("Invalid Docker image size")
        return cls(identity, created, strings(raw.get("RepoDigests")), strings(raw.get("RepoTags")), size)


class Docker:
    def command(self, *arguments):
        # No shell, inherited credentials or caller-controlled executable search path.
        return subprocess.run(
            ["/usr/bin/docker", *arguments], check=True, capture_output=True,
            text=True, timeout=60, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
        ).stdout

    def inspect(self, kind, identities):
        result = []
        for offset in range(0, len(identities), 50):
            batch = identities[offset:offset + 50]
            parsed = json.loads(self.command(kind, "inspect", *batch))
            if not isinstance(parsed, list) or len(parsed) != len(batch):
                raise ValueError("Incomplete Docker inspect response")
            if sorted(object_value(item).get("Id", "") for item in parsed) != sorted(batch):
                raise ValueError("Docker inspect identities do not match the requested objects")
            result.extend(parsed)
        return result

    def images(self):
        identities = sorted(set(self.command("image", "ls", "--quiet", "--no-trunc").split()))
        return [Image.parse(raw) for raw in self.inspect("image", identities)]

    def container_images(self):
        identities = self.command("container", "ls", "--all", "--quiet", "--no-trunc").split()
        images = set()
        for raw in self.inspect("container", identities):
            identity = object_value(raw).get("Image")
            if not isinstance(identity, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", identity):
                raise ValueError("Invalid container image identity")
            images.add(identity)
        return images


def plan_images(images, references, container_images, now):
    by_reference = {reference: image for image in images for reference in image.references}
    missing = references - by_reference.keys()
    if missing:
        raise ValueError("A protected deployment image is absent locally; cleanup refused")
    protected = container_images | {by_reference[reference].identity for reference in references}
    for repository in REPOSITORIES:
        recent = sorted(
            (image for image in images if any(ref.startswith(repository + "@") for ref in image.references)),
            key=lambda image: (image.created, image.identity), reverse=True,
        )
        protected.update(image.identity for image in recent[:MINIMUM_IMAGES_PER_REPOSITORY])
    candidates = []
    for image in images:
        if image.identity in protected or image.created > now - MINIMUM_AGE or not image.references:
            continue
        # The containerd image store may repeat immutable RepoDigests in RepoTags.
        # A mutable/manual tag or a reference outside these repositories is never ours.
        if any(tag not in image.references for tag in image.tags):
            continue
        if any(reference.partition("@")[0] not in REPOSITORIES for reference in image.references):
            continue
        for reference in image.references:
            image_reference(reference)
        candidates.append(image)
    return sorted(candidates, key=lambda image: (image.created, image.identity))


def cleanup(root, docker, apply, now):
    with ExitStack() as locks:
        references = set()
        # Use the gateways' exact flock in a fixed order, from state read through deletion.
        for directory, _, _ in DEPLOYMENTS:
            descriptor = os.open(root / "var/lib/inside" / directory / "operation.lock", os.O_RDWR | os.O_NOFOLLOW)
            lock = locks.enter_context(os.fdopen(descriptor, "r+"))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("Skipped: a deployment or another cleanup holds the operation lock")
                return []
        for directory, application, fields in DEPLOYMENTS:
            path = root / "var/lib/inside" / directory
            references.update(deployment_references(
                read_json(path / "state.json"), read_json(path / "operation.json"), application, fields,
            ))
        candidates = plan_images(docker.images(), references, docker.container_images(), now)
        before = shutil.disk_usage(root).free
        print(json.dumps({"mode": "apply" if apply else "dry-run", "candidateImages": len(candidates),
                          "candidateLogicalBytes": sum(image.size for image in candidates),
                          "protectedDeploymentReferences": sorted(references), "freeBytesBefore": before}))
        for image in candidates:
            print(json.dumps({"image": image.identity, "references": image.references, "created": image.created.isoformat()}), flush=True)
            if apply:
                # Recheck every container, including stopped ones, before each removal.
                if image.identity in docker.container_images():
                    print("Skipped image newly referenced by a container", flush=True)
                    continue
                for reference in image.references:
                    # No --force, global prune, container removal or volume removal.
                    docker.command("image", "rm", reference)
        print(json.dumps({"freeBytesAfter": shutil.disk_usage(root).free}), flush=True)
        return candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Remove eligible image references (default: report only)")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root to read and lock production deployment state")
    try:
        cleanup(Path("/"), Docker(), args.apply, datetime.now(timezone.utc))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        # Docker stderr may contain runtime details; print the boundary failure only.
        print(f"Image cleanup refused or stopped: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
