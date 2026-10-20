"""Real lifecycle tests on the proof's disposable CI runner, never a shared Docker stand."""
import importlib.util
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

from test_foundation_recovery_proof import verify_process_absence
import unittest

SPEC = importlib.util.spec_from_file_location(
    "foundation_proof", pathlib.Path(__file__).with_name("foundation-recovery-proof.py"))
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


def start(resources, image, *, detached=True, command="exec sleep 60", timeout=120):
    data, repo = resources.volume("data"), resources.volume("repository")
    envfile = resources.directory / "empty.env"
    envfile.touch(mode=0o600)
    return resources.container("lifetime", image, data, repo, envfile, command,
                               detached=detached, command_timeout=timeout)


def fixture(image, directory):
    proof.hosted_runner()
    signal.signal(signal.SIGTERM, proof.terminate)
    resources = proof.Resources(proof.admit(), directory)
    try:
        name, result = start(resources, image)
        if result.returncode:
            raise RuntimeError("lifecycle fixture failed to start")
        resources.command("exec", name, "true")
        # Interrupt a genuinely active command with its own descendant, not an idle launcher.
        proof.invoke([sys.executable, "-B",
                      str(pathlib.Path(__file__).with_name("test_foundation_recovery_proof.py")),
                      "process-fixture", str(directory / "live")], timeout=60)
    finally:
        resources.cleanup()


class DockerLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docker = proof.admit()
        cls.image = os.environ["FOUNDATION_PROOF_IMAGE"]
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", cls.image):
            raise ValueError("lifecycle image must be immutable")
        cls.root = pathlib.Path(os.environ["RUNNER_TEMP"]) / "foundation-lifetime"
        cls.root.mkdir(mode=0o700)

    def setUp(self):
        self.directory = self.root / self._testMethodName
        self.directory.mkdir(mode=0o700)
        self.addCleanup(self.clean)

    def clean(self):
        if (self.directory / "resources.json").exists():
            resources = proof.Resources(self.docker, self.directory, recover=True)
            resources.cleanup()
            self.verify_absence(resources)

    def verify_absence(self, resources):
        for item in resources.names:
            query = ["volume", "inspect"] if item["kind"] == "volume" else ["inspect"]
            result = resources.command(*query, item["name"], check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertRegex(result.stderr.lower(), r"no such (object|container|volume)")

    def resources(self):
        return proof.Resources(self.docker, self.directory)

    def test_success(self):
        resources = self.resources()
        _, result = start(resources, self.image, detached=False, command="true")
        self.assertEqual(result.returncode, 0)

    def test_command_failure(self):
        resources = self.resources()
        _, result = start(resources, self.image, detached=False, command="exit 7")
        self.assertEqual(result.returncode, 7)

    def test_command_timeout(self):
        resources = self.resources()
        with self.assertRaises(subprocess.TimeoutExpired) as failure:
            start(resources, self.image, detached=False,
                  command="echo owned-runtime-ready; exec sleep 60", timeout=10)
        self.assertIn(b"owned-runtime-ready", failure.exception.output or b"")

    def interrupted(self, signum):
        child = subprocess.Popen([sys.executable, "-B", __file__, "fixture",
                                  self.image, str(self.directory)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        active = []
        try:
            deadline = time.monotonic() + 30
            while not (self.directory / "live").exists():
                if child.poll() is not None:
                    self.fail("fixture exited before the runtime witness")
                if time.monotonic() >= deadline:
                    self.fail("fixture did not establish a live runtime witness")
                time.sleep(0.05)
            active = json.loads((self.directory / "live").read_text())
            child.send_signal(signum)
            self.assertNotEqual(child.wait(timeout=20), 0)
            if signum == signal.SIGTERM:
                # Verify the child's finally without letting fallback cleanup hide a leak.
                resources = proof.Resources(self.docker, self.directory, recover=True)
                self.verify_absence(resources)
            else:
                # SIGKILL requires the same exact-journal recovery as the always step.
                proof.stop_process_group(active[0])
                self.clean()
            verify_process_absence(self, active)
        finally:
            proof.stop_process_group(child.pid)
            child.wait(timeout=10)
            if active:
                proof.stop_process_group(active[0])

    def test_sigterm(self):
        self.interrupted(signal.SIGTERM)

    def test_sigkill_with_explicit_journal_recovery(self):
        self.interrupted(signal.SIGKILL)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "fixture":
        fixture(sys.argv[2], pathlib.Path(sys.argv[3]))
    else:
        unittest.main()
