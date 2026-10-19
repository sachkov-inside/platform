"""Local file boundary contracts for hosted evidence; no Docker or live providers."""

import json
from pathlib import Path
import tempfile
import unittest
import os
from types import SimpleNamespace
from unittest.mock import patch

import ci


class HostedEvidenceTest(unittest.TestCase):
    def test_artifact_collection_excludes_keys_binaries_and_raw_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, metadata, public = root / "private", root / "metadata", root / "public"
            output.mkdir()
            metadata.mkdir()
            (metadata / "source.json").write_text('{"checkout_sha":"fixture"}')
            (output / "evidence.json").write_text('{"status":"failed"}')
            for forbidden in ("auth.json", "datasources.json", "collector-errors.log", "mcp-executable"):
                (output / forbidden).write_text("sentinel-secret")
            ci.collect(output, metadata, public)
            self.assertEqual(sorted(path.name for path in public.iterdir()), ["evidence.json", "source.json"])
            self.assertNotIn("sentinel-secret", "".join(path.read_text() for path in public.iterdir()))

    def test_recovery_refuses_foreign_project_instead_of_executing_owner_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "owner.json").write_text(json.dumps({
                "project": "inside-platform", "cwd": str(ci.ROOT),
                "cleanup": ["sh", "-c", "remove foreign data"],
            }))
            with self.assertRaisesRegex(ValueError, "owned random pilot project"):
                ci.recover(output)

    def test_artifact_collection_refuses_allowed_filename_pointing_to_private_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, metadata = root / "private", root / "metadata"
            output.mkdir()
            metadata.mkdir()
            key = output / "auth.json"
            key.write_text('{"bearer_token":"sentinel-secret"}')
            (output / "evidence.json").symlink_to(key)
            with self.assertRaisesRegex(ValueError, "unsafe public artifact"):
                ci.collect(output, metadata, root / "public")

    def test_recovery_does_not_race_a_still_running_registered_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "owner.json").write_text(json.dumps({
                "project": "inside-observability-pilot-012345abcdef", "cwd": str(ci.ROOT),
            }))
            (output / "worker.json").write_text(json.dumps({"pid": os.getpid(), "group": os.getpid()}))
            with self.assertRaisesRegex(ValueError, "registered worker still exists"):
                ci.recover(output)

    def test_admission_refuses_empty_or_relative_docker_root_without_measuring_checkout(self):
        for label, docker_root in (("empty", ""), ("relative", ".")):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                metadata = Path(directory) / "metadata"

                def process_result(args, **_kwargs):
                    if args[0] == "docker":
                        return SimpleNamespace(stdout=docker_root)
                    value = "" if "status" in args else "a" * 40
                    return SimpleNamespace(stdout=value)

                with patch.dict(os.environ, {"GITHUB_SHA": "a" * 40}), \
                        patch("ci.subprocess.run", side_effect=process_result), \
                        patch("ci.shutil.disk_usage", side_effect=AssertionError("checkout must not be measured")):
                    self.assertEqual(ci.admission(metadata), 1)
                report = json.loads((metadata / "admission.json").read_text())
                self.assertEqual(report, {"ready": False, "error_type": "ValueError"})


if __name__ == "__main__":
    unittest.main()
