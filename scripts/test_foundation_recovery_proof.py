"""Safety contracts without Docker or production access."""
import importlib.util
import json
import os
import pathlib
import signal
import sys
import time
import subprocess
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "foundation_proof", pathlib.Path(__file__).with_name("foundation-recovery-proof.py"))
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


def result(stdout="", code=0, stderr=""):
    return subprocess.CompletedProcess([], code, stdout, stderr)


class RecoveryAdmission(unittest.TestCase):
    def test_refuses_remote_endpoint_before_contacting_daemon(self):
        with mock.patch.dict(os.environ, {"DOCKER_HOST": "ssh://production"}), mock.patch.object(proof, "invoke") as call:
            with self.assertRaisesRegex(ValueError, "local Unix"):
                proof.local_endpoint()
            call.assert_not_called()

    def test_refuses_runtime_on_owner_mac(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(proof, "local_endpoint") as endpoint:
            with self.assertRaisesRegex(ValueError, "disposable hosted"):
                proof.admit()
            endpoint.assert_not_called()

    def test_refuses_mutable_image_before_admission(self):
        with mock.patch.object(proof, "admit") as admit:
            with self.assertRaisesRegex(ValueError, "immutable image"):
                proof.proof("postgres:latest", pathlib.Path("unused"), pathlib.Path("unused"))
            admit.assert_not_called()

    def test_refuses_shared_runner_before_creating_resources(self):
        with mock.patch.object(proof, "hosted_runner"), mock.patch.object(proof, "local_endpoint", return_value="unix:///tmp/proof.sock"), mock.patch.object(proof, "invoke", return_value=result("foreign-container\n")) as call:
            with self.assertRaisesRegex(ValueError, "empty runner"):
                proof.admit()
            self.assertEqual(len(call.call_args_list), 1)
            self.assertIn("ps", call.call_args.args[0])


class RedactedRestoreFailure(unittest.TestCase):
    def test_reports_restore_error_without_synthetic_cipher_passphrase(self):
        with tempfile.TemporaryDirectory() as directory:
            envfile = pathlib.Path(directory) / "proof.env"
            envfile.write_text("PGBACKREST_REPO1_CIPHER_PASS=synthetic-private-value\n")
            resources = mock.Mock()
            resources.container.return_value = ("owned", result(
                code=40, stderr="ERROR: [040]: test synthetic-private-value refusal\nother output"))
            with self.assertRaisesRegex(RuntimeError, r"exit 40.*REDACTED") as failure:
                proof.restore_case(resources, "image", "repo", envfile, "test", "--type=immediate", "backup")
            self.assertNotIn("synthetic-private-value", str(failure.exception))
            self.assertNotIn("other output", str(failure.exception))


class WrongKeyRefusal(unittest.TestCase):
    def test_accepts_specific_metadata_rejection_after_wrong_key(self):
        failed = result(code=75, stderr="backup.info backup.info.copy [FormatError]")
        self.assertTrue(proof.metadata_key_refusal(failed))

    def test_rejects_unrelated_failures_and_generic_no_backup(self):
        for output in ("no backup set found to restore",
                       "backup.info backup.info.copy [FormatError] Permission denied",
                       "backup.info backup.info.copy [FileMissingError]",
                       "backup.info backup.info.copy [FormatError] No such file"):
            with self.subTest(output=output):
                self.assertFalse(proof.metadata_key_refusal(result(code=75, stderr=output)))



class OwnedResources(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.calls = []
        self.resources = None
        self.patch = mock.patch.object(proof, "invoke", side_effect=self.docker)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.resources = proof.Resources(["docker", "--host", "unix:///proof.sock"], self.directory)

    def docker(self, args, **_kwargs):
        command = args[3:]
        self.calls.append(command)
        if command[0] == "info":
            return result(json.dumps("proof-daemon"))
        if "inspect" in command:
            labels = {proof.LABEL: self.resources.owner}
            return result(json.dumps([{"Labels": labels, "Config": {"Labels": labels}}]))
        return result()

    def test_records_uncertain_create_before_daemon_call(self):
        def timeout(args, **kwargs):
            if args[3:5] == ["volume", "create"]:
                record = json.loads(self.resources.journal.read_text())
                self.assertEqual(record["resources"][-1]["name"], args[-1])
                raise subprocess.TimeoutExpired("docker", 1)
            return self.docker(args, **kwargs)
        with mock.patch.object(proof, "invoke", side_effect=timeout):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.resources.volume("uncertain")
        self.resources.cleanup()
        self.assertEqual(self.calls[-1][:2], ["volume", "rm"])

    def test_foreign_label_is_never_deleted(self):
        self.resources.volume("foreign")
        with mock.patch.object(proof, "invoke", return_value=result(json.dumps([{"Labels": {proof.LABEL: "other-owner"}}]))):
            with self.assertRaisesRegex(RuntimeError, "ownership changed"):
                self.resources.cleanup()
        self.assertFalse(any(call[:2] == ["volume", "rm"] for call in self.calls))

    def test_unavailable_daemon_is_not_resource_absence(self):
        self.resources.volume("uncertain")
        with mock.patch.object(proof, "invoke", return_value=result(code=1, stderr="Cannot connect to Docker")):
            with self.assertRaisesRegex(RuntimeError, "cannot establish"):
                self.resources.cleanup()

    def test_recovery_rejects_another_daemon(self):
        self.resources.volume("retained")
        with mock.patch.object(proof, "invoke", return_value=result(json.dumps("different-daemon"))):
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                proof.Resources(self.resources.docker, self.directory, recover=True)

    def test_recovery_rejects_foreign_resource_name(self):
        record = json.loads(self.resources.journal.read_text())
        record["resources"] = [{"kind": "volume", "name": "owner-product-data"}]
        self.resources.journal.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, "foreign resource"):
            proof.Resources(self.resources.docker, self.directory, recover=True)

    def test_recovery_retains_exact_owner_records(self):
        self.resources.volume("retained")
        recovered = proof.Resources(self.resources.docker, self.directory, recover=True)
        self.assertEqual(recovered.owner, self.resources.owner)
        self.assertEqual(recovered.names, self.resources.names)

    def test_binary_metadata_stdout_is_not_persisted_by_docker_logging(self):
        self.resources.container("private-reader", "sha256:" + "a" * 64, "data", "repo",
                                 self.directory / "fixture.env", "true", binary=True,
                                 data_readonly=True, repository_readonly=True)
        run = self.calls[-1]
        self.assertEqual(run[run.index("--log-driver") + 1], "none")

    def test_containers_have_no_network_ports_and_restore_mounts_are_readonly(self):
        self.resources.container("reader", "sha256:" + "a" * 64, "data", "repo",
                                 self.directory / "fixture.env", "true",
                                 data_readonly=True, repository_readonly=True)
        run = self.calls[-1]
        self.assertEqual(run[run.index("--network") + 1], "none")
        self.assertIn("--init", run)
        self.assertNotIn("--publish", run)
        self.assertIn("type=volume,src=data,dst=/var/lib/postgresql,readonly", run)
        self.assertIn("type=volume,src=repo,dst=/backup,readonly", run)


def active_process_fixture(witness):
    """A real owned command/descendant boundary, without network or Docker."""
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    def finish(_signum, _frame):
        try:
            child.wait(timeout=3)
        finally:
            raise SystemExit(1)
    signal.signal(signal.SIGTERM, finish)
    try:
        temporary = pathlib.Path(witness).with_suffix(".next")
        temporary.write_text(json.dumps([os.getpid(), child.pid]))
        temporary.replace(witness)
        signal.pause()
    finally:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=5)


def verify_process_absence(test, processes):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        remaining = []
        for pid in processes:
            try:
                os.kill(pid, 0)
                remaining.append(pid)
            except ProcessLookupError:
                pass
        if not remaining:
            return
        time.sleep(0.02)
    test.fail("owned command or descendant remained after cleanup")


class RealProcessBoundary(unittest.TestCase):
    def test_binary_metadata_reads_preserve_bytes_without_text_decoding(self):
        binary = proof.invoke([sys.executable, "-c",
                               "import sys; sys.stdout.buffer.write(bytes([160]))"],
                              binary=True, timeout=5)
        self.assertEqual(binary.stdout, bytes([160]))

    def test_non_utf8_refusal_output_keeps_the_command_failure(self):
        refused = proof.invoke([sys.executable, "-c",
                                "import sys; sys.stderr.buffer.write(bytes([160])); sys.exit(7)"],
                               check=False, timeout=5)
        self.assertEqual(refused.returncode, 7)
        self.assertEqual(refused.stderr, "\ufffd")

    def test_timeout_cleans_active_command_and_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            witness = pathlib.Path(directory) / "live"
            with self.assertRaises(subprocess.TimeoutExpired):
                proof.invoke([sys.executable, "-B", __file__, "process-fixture", str(witness)],
                             timeout=2)
            self.assertTrue(witness.exists(), "active descendant witness was not established")
            verify_process_absence(self, json.loads(witness.read_text()))

    def interrupted(self, signum):
        with tempfile.TemporaryDirectory() as directory:
            witness = pathlib.Path(directory) / "live"
            launcher = subprocess.Popen([sys.executable, "-B", __file__,
                                         "invocation-fixture", str(witness)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        start_new_session=True)
            active = []
            try:
                deadline = time.monotonic() + 5
                while not witness.exists():
                    if launcher.poll() is not None or time.monotonic() >= deadline:
                        self.fail("active process witness was not established")
                    time.sleep(0.02)
                active = json.loads(witness.read_text())
                launcher.send_signal(signum)
                self.assertNotEqual(launcher.wait(timeout=10), 0)
                if signum == signal.SIGKILL:
                    proof.stop_process_group(active[0])
                verify_process_absence(self, active)
            finally:
                proof.stop_process_group(launcher.pid)
                launcher.wait(timeout=5)
                if active:
                    proof.stop_process_group(active[0])

    def test_sigterm_cleans_active_command_and_descendant(self):
        self.interrupted(signal.SIGTERM)

    def test_sigkill_supervisor_cleans_active_command_and_descendant(self):
        self.interrupted(signal.SIGKILL)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "process-fixture":
        active_process_fixture(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == "invocation-fixture":
        signal.signal(signal.SIGTERM, proof.terminate)
        proof.invoke([sys.executable, "-B", __file__, "process-fixture", sys.argv[2]], timeout=60)
    else:
        unittest.main()
