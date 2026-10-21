"""Backup CLI and transition admission contracts with no daemon or production access."""
import os
import pathlib
import subprocess
import tempfile
import unittest
import importlib.util
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TransitionAdmission(unittest.TestCase):
    def test_mutable_image_is_refused_before_daemon_access(self):
        spec = importlib.util.spec_from_file_location(
            "transition", ROOT / "scripts/foundation-repository-transition.py")
        transition = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(transition)
        with mock.patch.object(transition.base, "admit") as admit:
            with self.assertRaisesRegex(ValueError, "immutable"):
                transition.proof("postgres:latest", pathlib.Path("unused"), pathlib.Path("unused"))
            admit.assert_not_called()


class BackupCommand(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.arguments = self.directory / "arguments"
        executable = self.directory / "docker"
        executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGUMENTS"\n')
        executable.chmod(0o700)

    def invoke(self, *arguments, repository=None):
        env = dict(os.environ, PATH=str(self.directory) + os.pathsep + os.environ["PATH"],
                   CAPTURE_ARGUMENTS=str(self.arguments))
        env.pop("INSIDE_BACKUP_REPOSITORY", None)
        if repository is not None:
            env["INSIDE_BACKUP_REPOSITORY"] = repository
        return subprocess.run(["bash", str(ROOT / "infra/production/database/database-backup"),
                               *arguments], env=env, capture_output=True, text=True, timeout=5)

    def test_default_backup_preserves_history_and_selects_old_repository_explicitly(self):
        result = self.invoke("full")
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.arguments.read_text().splitlines()
        self.assertIn("--no-expire-auto", args)
        self.assertIn("--repo=1", args)
        self.assertEqual(args[-1], "backup")

    def test_new_repository_selection_keeps_expiration_disabled_for_every_backup_type(self):
        for kind in ("full", "diff", "incr"):
            with self.subTest(kind=kind):
                result = self.invoke(kind, repository="2")
                self.assertEqual(result.returncode, 0, result.stderr)
                args = self.arguments.read_text().splitlines()
                self.assertIn("--repo=2", args)
                self.assertIn("--no-expire-auto", args)
                self.assertIn("--type=" + kind, args)

    def test_refuses_invalid_selection_before_any_docker_request(self):
        for args, repo in ((("full",), "3"), (("full",), "2 --expire-auto"),
                           (("full", "2"), "1"), (("expire",), "1")):
            with self.subTest(arguments=args, repository=repo):
                result = self.invoke(*args, repository=repo)
                self.assertEqual(result.returncode, 64)
                self.assertFalse(self.arguments.exists())


if __name__ == "__main__":
    unittest.main()
