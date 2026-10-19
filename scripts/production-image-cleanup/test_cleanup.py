"""Deterministic retention and filesystem/locking boundary tests; Docker is a double."""

from contextlib import redirect_stdout
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import fcntl
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[2] / "infra/production/host/inside-image-cleanup.py"
SPEC = importlib.util.spec_from_file_location("image_cleanup", MODULE_PATH)
cleanup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cleanup
SPEC.loader.exec_module(cleanup)
NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)


def reference(repository, number):
    return f"{repository}@sha256:{number:064x}"


def image(number, repository=None, days=30, references=None, tags=()):
    return cleanup.Image(
        f"sha256:{number:064x}", NOW - timedelta(days=days),
        references if references is not None else (reference(repository or cleanup.REPOSITORIES[0], number),),
        tags, 1024,
    )


class DockerDouble:
    def __init__(self, images, containers=()):
        self.stored = list(images)
        self.containers = set(containers)
        self.commands = []

    def images(self):
        return self.stored

    def container_images(self):
        return self.containers

    def command(self, *arguments):
        self.commands.append(arguments)
        if arguments[:2] != ("image", "rm") or len(arguments) != 3:
            raise AssertionError(f"Unexpected mutation: {arguments}")
        selected = arguments[2]
        self.stored = [
            replace(item, references=tuple(ref for ref in item.references if ref != selected))
            for item in self.stored
        ]
        return ""


class PlanTests(unittest.TestCase):
    def plan(self, images, references=(), containers=()):
        return cleanup.plan_images(images, set(references), set(containers), NOW)

    def test_age_and_minimum_three_images_are_both_required(self):
        items = [image(n, days=n) for n in range(1, 10)]
        self.assertEqual([item.identity for item in self.plan(items)], [image(n).identity for n in (9, 8, 7)])
        old = [image(n, days=10 + n) for n in range(1, 6)]
        self.assertEqual([item.identity for item in self.plan(old)], [image(5).identity, image(4).identity])

    def test_each_repository_keeps_three_even_when_all_are_old(self):
        items = [image(n + offset * 100, repository=repo, days=n + 10)
                 for offset, repo in enumerate(cleanup.REPOSITORIES, start=10)
                 for n in range(1, 5)]
        self.assertEqual(len(self.plan(items)), 3)

    def test_container_including_stopped_and_deployment_alias_protect_image_id(self):
        items = [image(n, days=n + 10) for n in range(1, 7)]
        alias = reference(cleanup.REPOSITORIES[1], 80)
        items[-1] = replace(items[-1], references=items[-1].references + (alias,))
        self.assertEqual(
            [item.identity for item in self.plan(items, [alias], [items[-2].identity])],
            [items[3].identity],
        )

    def test_unknown_repository_alias_tags_and_digestless_images_are_not_owned(self):
        recent = [image(n, days=n) for n in range(1, 4)]
        excluded = [image(10, tags=("manual:keep",)), image(11, references=()),
                    image(12, references=("other/image@sha256:" + "a" * 64,)),
                    image(13, references=(reference(cleanup.REPOSITORIES[0], 13), "other/image@sha256:" + "b" * 64))]
        self.assertEqual(self.plan(recent + excluded), [])

    def test_absent_protected_image_or_invalid_managed_digest_refuses_plan(self):
        with self.assertRaisesRegex(ValueError, "absent locally"):
            self.plan([], [reference(cleanup.REPOSITORIES[0], 1)])
        recent = [image(n, days=n) for n in range(1, 4)]
        with self.assertRaisesRegex(ValueError, "Invalid immutable"):
            self.plan(recent + [image(50, references=(cleanup.REPOSITORIES[0] + "@bad",))])

    def test_containerd_digest_in_repo_tags_is_an_owned_immutable_reference(self):
        recent = [image(n, days=n) for n in range(1, 4)]
        retired = image(10, tags=(reference(cleanup.REPOSITORIES[0], 10),))
        self.assertEqual(self.plan(recent + [retired]), [retired])

    def test_future_clock_and_age_boundary(self):
        recent = [image(n, days=-n) for n in range(1, 4)]
        boundary = image(8, days=7)
        just_newer = replace(boundary, identity=image(9).identity, created=boundary.created + timedelta(microseconds=1))
        self.assertEqual(self.plan(recent + [boundary, just_newer]), [boundary])

    def test_docker_metadata_is_validated(self):
        raw = {"Id": image(1).identity, "Created": NOW.isoformat(), "RepoDigests": [], "RepoTags": [], "Size": 10}
        self.assertEqual(cleanup.Image.parse(raw).identity, image(1).identity)
        for key, value in (("Id", "bad"), ("Created", "2026-10-19"), ("RepoDigests", None), ("RepoTags", [1]), ("Size", True)):
            with self.subTest(key=key), self.assertRaises((ValueError, TypeError)):
                cleanup.Image.parse({**raw, key: value})


class HostBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="inside-image-cleanup-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.images = [image(n, days=10 + n) for n in range(1, 10)]
        self.images += [image(100 + n, repository=cleanup.REPOSITORIES[1], days=n) for n in range(1, 5)]
        self.images += [image(200 + n, repository=cleanup.REPOSITORIES[2], days=n) for n in range(1, 5)]
        self.docker = DockerDouble(self.images)
        self.paths = {}
        for directory, application, fields in cleanup.DEPLOYMENTS:
            path = self.root / "var/lib/inside" / directory
            path.mkdir(parents=True)
            (path / "operation.lock").touch()
            self.paths[application] = path
            versions = {}
            for key, number in (("current", 1), ("previous", 8), ("rolledBackFrom", 9)):
                entry = {"version": f"v{number}", "manifestSha256": "sha256:" + f"{number:064x}"}
                for field in fields:
                    repo = {"backendImage": cleanup.REPOSITORIES[0], "webImage": cleanup.REPOSITORIES[1], "image": cleanup.REPOSITORIES[2]}[field]
                    offset = {"backendImage": 0, "webImage": 100, "image": 200}[field]
                    selected_number = number if field == "backendImage" else 1
                    entry[field] = reference(repo, offset + selected_number)
                versions[key] = entry
            state = {"schemaVersion": f"inside.{application}.deployment-state.v1", "status": "succeeded", **versions}
            if application == "platform":
                state["rollback"] = {"targetVersion": "v8", "manifestSha256": versions["previous"]["manifestSha256"]}
            operation = {"schemaVersion": f"inside.{application}.deployment-operation.v1", "status": "succeeded", "phase": "complete", "version": "v1"}
            self.write(application, "state.json", state)
            self.write(application, "operation.json", operation)

    def write(self, application, filename, value):
        (self.paths[application] / filename).write_text(json.dumps(value))

    def run_cleanup(self, apply=False):
        with redirect_stdout(io.StringIO()):
            return cleanup.cleanup(self.root, self.docker, apply, NOW)

    def test_dry_run_is_read_only_and_apply_only_removes_explicit_retired_refs(self):
        before = {path: path.read_bytes() for path in self.root.rglob("*.json")}
        planned = self.run_cleanup()
        self.assertEqual([item.identity for item in planned], [image(n).identity for n in (7, 6, 5, 4)])
        self.assertEqual(self.docker.commands, [])
        self.run_cleanup(apply=True)
        self.assertEqual(self.docker.commands, [("image", "rm", item.references[0]) for item in planned])
        self.assertEqual(before, {path: path.read_bytes() for path in self.root.rglob("*.json")})
        self.docker.commands.clear()
        self.run_cleanup(apply=True)
        self.assertEqual(self.docker.commands, [])

    def test_both_gateway_locks_skip_and_are_released(self):
        for application in ("platform", "telegram"):
            with self.subTest(application=application):
                with (self.paths[application] / "operation.lock").open("r+") as locked:
                    fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self.assertEqual(self.run_cleanup(apply=True), [])
                    self.assertEqual(self.docker.commands, [])
        self.assertTrue(self.run_cleanup())

    def test_both_locks_are_held_during_removal(self):
        original = self.docker.command
        def remove(*arguments):
            for path in self.paths.values():
                with (path / "operation.lock").open("r+") as locked:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return original(*arguments)
        self.docker.command = remove
        self.run_cleanup(apply=True)

    def test_incomplete_failed_unknown_or_missing_operation_refuses_all_deletion(self):
        for application in ("platform", "telegram"):
            path = self.paths[application] / "operation.json"
            original = path.read_text()
            for status in ("running", "failed", "unknown"):
                with self.subTest(application=application, status=status):
                    value = json.loads(original)
                    value["status"] = status
                    path.write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        self.run_cleanup(apply=True)
                    self.assertEqual(self.docker.commands, [])
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                self.run_cleanup(apply=True)
            path.write_text(original)

    def test_malformed_unknown_or_unbound_recovery_state_refuses_deletion(self):
        path = self.paths["platform"] / "state.json"
        original = json.loads(path.read_text())
        cases = [{**original, "current": None}, {**original, "schemaVersion": "unknown"},
                 {**original, "rollback": {"targetVersion": "v999", "manifestSha256": "unknown"}},
                 {**original, "previous": {"version": "v8"}}]
        for value in cases:
            with self.subTest(value=value):
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    self.run_cleanup(apply=True)
                self.assertEqual(self.docker.commands, [])
        path.write_text("{")
        with self.assertRaises(ValueError):
            self.run_cleanup(apply=True)

    def test_symlink_state_and_lock_are_rejected(self):
        for filename in ("state.json", "operation.lock"):
            with self.subTest(filename=filename):
                path = self.paths["platform"] / filename
                saved = path.with_suffix(".saved")
                path.rename(saved)
                path.symlink_to(saved)
                with self.assertRaises(OSError):
                    self.run_cleanup(apply=True)
                path.unlink()
                saved.rename(path)

    def test_inspect_failure_and_new_container_refuse_mutation(self):
        with patch.object(self.docker, "images", side_effect=ValueError("inspect failed")):
            with self.assertRaises(ValueError):
                self.run_cleanup(apply=True)
        with patch.object(self.docker, "container_images", side_effect=[set()] + [{item.identity for item in self.images}] * 4):
            self.run_cleanup(apply=True)
        self.assertEqual(self.docker.commands, [])

    def test_partial_failure_stops_then_retry_is_safe(self):
        remove = self.docker.command
        def fail_second(*arguments):
            if len(self.docker.commands) == 1:
                raise subprocess.CalledProcessError(1, "docker")
            return remove(*arguments)
        with patch.object(self.docker, "command", side_effect=fail_second):
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_cleanup(apply=True)
        self.assertEqual(len(self.docker.commands), 1)
        self.run_cleanup(apply=True)
        self.assertEqual(len(self.docker.commands), 4)


class DockerAdapterTests(unittest.TestCase):
    def test_adapter_uses_fixed_binary_environment_timeout_and_no_shell(self):
        result = subprocess.CompletedProcess([], 0, stdout="[]")
        with patch.object(subprocess, "run", return_value=result) as run:
            cleanup.Docker().command("image", "inspect", "sha256:" + "a" * 64)
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], "/usr/bin/docker")
        self.assertNotIn("shell", kwargs)
        self.assertTrue(kwargs["check"])
        self.assertEqual(kwargs["timeout"], 60)
        self.assertEqual(set(kwargs["env"]), {"PATH"})

    def test_inspect_rejects_incomplete_or_malformed_results(self):
        for response in ("{}", "[]", "broken"):
            with self.subTest(response=response), patch.object(cleanup.Docker, "command", return_value=response):
                with self.assertRaises(ValueError):
                    cleanup.Docker().inspect("image", ["expected"])


if __name__ == "__main__":
    unittest.main()
