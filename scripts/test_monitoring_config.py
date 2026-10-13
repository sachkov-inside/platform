"""Public configuration process contract, with synthetic secret-bearing files."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "infra/production/monitoring/render-scrape.py"


class ScrapeConfigTest(unittest.TestCase):
    def run_renderer(self, port, watchdog=""):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "etc/inside/telegram").mkdir(parents=True)
            (root / "etc/inside/watchdog").mkdir(parents=True)
            (root / "etc/inside/telegram/compose.env").write_text(f"TELEGRAM_LOOPBACK_PORT={port}\nDB_PASSWORD=never-print-me\n")
            (root / "etc/inside/watchdog/watchdog.env").write_text(watchdog)
            return subprocess.run(["python3", str(SCRIPT), "--root", directory], text=True, capture_output=True, timeout=5)

    def test_compose_connectivity_is_used_without_exposing_secrets(self):
        result = self.run_renderer("3399")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("127.0.0.1:3399", result.stdout)
        self.assertNotIn("never-print-me", result.stdout + result.stderr)
        self.assertIn("scrape_interval: 60s", result.stdout)

    def test_explicit_watchdog_url_wins(self):
        result = self.run_renderer("3399", "WATCHDOG_TELEGRAM_APP_URL=http://127.0.0.1:3317\n")
        self.assertEqual(result.returncode, 0)
        self.assertIn("127.0.0.1:3317", result.stdout)
        self.assertNotIn("127.0.0.1:3399", result.stdout)

    def test_rejects_non_loopback_and_shell_substitution(self):
        for setting in ["https://user:secret@example.test:3303", "http://127.0.0.1:3303/path", "http://127.0.0.1:3303?secret=x"]:
            with self.subTest(setting=setting):
                result = self.run_renderer("3399", "WATCHDOG_TELEGRAM_APP_URL=" + setting + "\n")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("secret", result.stderr)
        self.assertNotEqual(self.run_renderer("$(touch /tmp/forbidden)").returncode, 0)


if __name__ == "__main__":
    unittest.main()
