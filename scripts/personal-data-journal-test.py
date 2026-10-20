"""Real age encryption with an owned in-memory S3 boundary; no live provider calls."""
import importlib.util
import io
import pathlib
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("journal", pathlib.Path(__file__).with_name("personal-data-journal.py"))
journal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journal)


class Storage:
    def __init__(self):
        self.objects = {}
        self.fail = False

    def put_object(self, **values):
        if self.fail:
            raise RuntimeError("synthetic provider failure")
        if values["Key"] in self.objects:
            raise RuntimeError("immutable object")
        self.objects[values["Key"]] = values["Body"]

    def get_object(self, **values):
        if self.fail:
            raise RuntimeError("synthetic provider failure")
        return {"Body": io.BytesIO(self.objects[values["Key"]])}


@unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "real crypto proof requires age")
class JournalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.identities = [self.root / name for name in ("host", "offline", "wrong")]
        public = []
        for identity in self.identities:
            subprocess.run(["age-keygen", "-o", str(identity)], capture_output=True, check=True, timeout=10)
            public.append(subprocess.run(["age-keygen", "-y", str(identity)], capture_output=True, check=True, timeout=10).stdout)
        self.recipients = self.root / "recipients"
        self.recipients.write_bytes(b"".join(public[:2]))
        self.recipients.chmod(0o600)
        self.input = self.root / "requests.jsonl"
        self.data = b'{"operationId":"synthetic-deletion","state":"planned"}\n'
        self.input.write_bytes(self.data)
        self.input.chmod(0o600)
        self.storage = Storage()

    def backup(self):
        return journal.backup(self.storage, "synthetic", self.input, self.recipients, self.identities[0])["objectKey"]

    def test_offline_recovery_after_loss_of_host_journal(self):
        key = self.backup()
        self.input.unlink()
        self.identities[0].unlink()
        journal.restore(self.storage, "synthetic", key, self.identities[1], self.input)
        self.assertEqual(self.input.read_bytes(), self.data)
        self.assertEqual(self.input.stat().st_mode & 0o777, 0o600)

    def test_tampered_archive_never_publishes_plaintext(self):
        key = self.backup()
        self.storage.objects[key] = self.storage.objects[key][:-20] + b"corrupt"
        output = self.root / "restored"
        with self.assertRaises(subprocess.CalledProcessError):
            journal.restore(self.storage, "synthetic", key, self.identities[1], output)
        self.assertFalse(output.exists())

    def test_wrong_identity_never_publishes_plaintext(self):
        key = self.backup()
        output = self.root / "restored"
        with self.assertRaises(subprocess.CalledProcessError):
            journal.restore(self.storage, "synthetic", key, self.identities[2], output)
        self.assertFalse(output.exists())

    def test_existing_journal_is_not_overwritten(self):
        key = self.backup()
        with self.assertRaises(FileExistsError):
            journal.restore(self.storage, "synthetic", key, self.identities[1], self.input)
        self.assertEqual(self.input.read_bytes(), self.data)
        self.assertFalse(list(self.root.glob(".journal-*")))

    def test_symlink_and_fifo_sources_are_rejected(self):
        linked = self.root / "linked"
        linked.symlink_to(self.input)
        with self.assertRaises(OSError):
            journal.private_bytes(linked)
        import os
        fifo = self.root / "fifo"
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError):
            journal.private_bytes(fifo)

    def test_operator_interruption_reaps_active_crypto_process(self):
        import os
        import signal
        import time
        executable = self.root / "age"
        ready = self.root / "crypto-ready"
        executable.write_text("#!/usr/bin/env python3\nimport os,pathlib,signal\npathlib.Path(os.environ['JOURNAL_PROOF_READY']).write_text(str(os.getpid()))\nsignal.pause()\n")
        executable.chmod(0o700)
        harness = "import importlib.util,signal; s=importlib.util.spec_from_file_location('journal'," + repr(str(pathlib.Path(journal.__file__).resolve())) + "); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); signal.signal(signal.SIGTERM,m.terminate); m.age(b'synthetic')"
        parent = subprocess.Popen([__import__('sys').executable, "-c", harness], env={**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"], "JOURNAL_PROOF_READY": str(ready)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists():
                if time.monotonic() >= deadline:
                    self.fail("crypto process did not report readiness")
                time.sleep(0.01)  # Poll the owned crypto readiness file, not elapsed work.
            descendant = int(ready.read_text())
            parent.send_signal(signal.SIGTERM)
            parent.wait(timeout=5)
            with self.assertRaises(ProcessLookupError):
                os.kill(descendant, 0)
        finally:
            if parent.poll() is None:
                parent.kill()
            parent.wait(timeout=5)

    def test_provider_failure_does_not_issue_receipt(self):
        self.storage.fail = True
        with self.assertRaises(RuntimeError):
            self.backup()

    def test_verification_failure_does_not_issue_receipt(self):
        def corrupt(**values):
            return {"Body": io.BytesIO(b"invalid archive")}
        self.storage.get_object = corrupt
        with self.assertRaises(subprocess.CalledProcessError):
            self.backup()


if __name__ == "__main__":
    unittest.main()
