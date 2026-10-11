import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "restore", pathlib.Path(__file__).with_name("isolated-database-restore.py"))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreSafety(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = pathlib.Path(self.directory.name)
        self.cipher = self.repo / "cipher.env"
        self.cipher.touch(mode=0o600)
        self.calls = []

    def docker(self, *args, input_text=None):
        self.calls.append((args, input_text))
        return "f" if "SELECT pg_is_in_recovery();" in args else ""

    def test_refuses_mutable_image_before_touching_docker(self):
        with self.assertRaises(ValueError):
            restore.restore("postgres:latest", self.repo, self.cipher, "20261011-100000F", self.docker)
        self.assertEqual(self.calls, [])

    def test_recovery_has_no_ports_or_network_and_cleans_its_volume(self):
        result = restore.restore("sha256:" + "a" * 64, self.repo, self.cipher, "20261011-100000F", self.docker)
        self.assertEqual(result["databasesPassed"], ["inside", "logto", "inside_telegram"])
        self.assertEqual(result["publishedPorts"], 0)
        self.assertTrue(result["volume"].startswith(restore.PREFIX))
        for args, _ in self.calls:
            if args[0] == "run":
                self.assertEqual(args[args.index("--network") + 1], "none")
                self.assertNotIn("--publish", args)
        self.assertEqual(self.calls[-1][0], ("volume", "rm", result["volume"]))

    def test_failed_restore_cleans_new_volume_and_returns_no_receipt(self):
        def fail(*args, input_text=None):
            self.docker(*args, input_text=input_text)
            if args[0] == "run":
                raise subprocess.CalledProcessError(1, "docker")
            return ""
        with self.assertRaises(subprocess.CalledProcessError):
            restore.restore("sha256:" + "a" * 64, self.repo, self.cipher, "20261011-100000F", fail)
        self.assertEqual(self.calls[-1][0][:2], ("volume", "rm"))


if __name__ == "__main__":
    unittest.main()
