"""Safety contracts without Docker or production access."""
import importlib.util
import json
import os
import pathlib
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

    def test_containers_have_no_network_ports_and_restore_mounts_are_readonly(self):
        self.resources.container("reader", "sha256:" + "a" * 64, "data", "repo",
                                 self.directory / "fixture.env", "true",
                                 data_readonly=True, repository_readonly=True)
        run = self.calls[-1]
        self.assertEqual(run[run.index("--network") + 1], "none")
        self.assertNotIn("--publish", run)
        self.assertIn("type=volume,src=data,dst=/var/lib/postgresql,readonly", run)
        self.assertIn("type=volume,src=repo,dst=/backup,readonly", run)


if __name__ == "__main__":
    unittest.main()
