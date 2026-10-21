"""Read-only inventory projection rejects payload, diagnostics and malformed metadata."""
import importlib.util
import pathlib
import unittest
import json
import subprocess

SPEC = importlib.util.spec_from_file_location(
    "inventory", pathlib.Path(__file__).with_name("backup-repository-inventory.py"))
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


class InventoryProjection(unittest.TestCase):
    def sample(self):
        return [{"name": "production", "status": {"code": 0, "message": "PRIVATE"},
                 "cipher": "aes-256-cbc", "repo": [{"key": 1, "status": {"code": 0}}],
                 "archive": [{"id": "18-1", "min": "000000010000000000000001",
                              "max": "000000010000000000000002"}],
                 "backup": [{"label": "20261021-051241F", "type": "full",
                             "timestamp": {"start": 1792560000, "stop": 1792560100},
                             "info": {"size": 300, "repository": {"size": 100}},
                             "reference": None, "prior": None,
                             "archive": {"start": "000000010000000000000001",
                                         "stop": "000000010000000000000002"},
                             "cipher-pass": "PRIVATE", "unknown": {"user": "PRIVATE"}}]}]

    def test_projects_every_backup_without_secrets_or_provider_diagnostics(self):
        result = inventory.project_info(self.sample(), 1)
        self.assertEqual(result["backups"][0]["label"], "20261021-051241F")
        self.assertEqual(result["backups"][0]["info"]["repository"]["size"], 100)
        self.assertNotIn("PRIVATE", str(result))
        self.assertFalse(result["walContinuityVerified"])

    def test_refuses_unavailable_repository_without_diagnostics(self):
        sample = self.sample()
        sample[0]["status"] = {"code": 99, "message": "PRIVATE"}
        with self.assertRaises(ValueError) as failure:
            inventory.project_info(sample, 1)
        self.assertNotIn("PRIVATE", str(failure.exception))

    def test_refuses_missing_dependencies_and_malformed_values(self):
        for path, value in (("reference", ["20261010-000000F"]),
                            ("reference", ["PRIVATE"]), ("label", "PRIVATE"),
                            ("type", "PRIVATE"), ("error", True)):
            with self.subTest(path=path, value=value):
                sample = self.sample()
                sample[0]["backup"][0][path] = value
                with self.assertRaises(ValueError):
                    inventory.project_info(sample, 1)

    def test_collect_calls_only_read_only_info_and_projects_before_returning(self):
        calls = []
        def execute(arguments):
            calls.append(arguments)
            return subprocess.CompletedProcess(arguments, 0, json.dumps(self.sample()), "PRIVATE")
        result = inventory.collect(1, execute=execute)
        self.assertEqual(result["backupCount"], 1)
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertEqual(calls, [["docker", "--host", "unix:///var/run/docker.sock", "exec",
                                "--user", "postgres", "inside-production-database-postgres-1",
                                "pgbackrest", "--stanza=production", "--repo=1", "--output=json",
                                "--log-level-console=off", "--log-level-file=off", "info"]])

    def test_failed_command_never_returns_partial_metadata(self):
        def execute(arguments):
            return subprocess.CompletedProcess(arguments, 7, "PRIVATE", "PRIVATE")
        with self.assertRaisesRegex(ValueError, "inventory read failed"):
            inventory.collect(1, execute=execute)


if __name__ == "__main__":
    unittest.main()
