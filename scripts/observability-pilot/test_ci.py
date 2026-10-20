"""Local file boundary contracts for hosted evidence; no Docker or live providers."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
import os
import signal
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

import ci

FIXTURE_LEADER_EXIT_BUDGET_SECONDS = 2
LINUX_IDENTITY = {'platform': 'linux', 'context': 'default', 'endpoint': 'unix:///fixture/docker.sock',
                  'daemon_id': 'owned', 'storage': '/var/lib/docker', 'socket_device': 1, 'socket_inode': 2}
MAC_IDENTITY = {'context': 'orbstack', 'endpoint': 'unix:///fixture/docker.sock',
                'daemon_id': 'owned', 'storage': '/var/lib/docker', 'socket_device': 1, 'socket_inode': 2,
                'backing': {'path': '/fixture/data.img.raw', 'device': 1, 'inode': 3}}


class HostedEvidenceTest(unittest.TestCase):
    def setUp(self):
        frozen = patch.multiple(ci.pilot, FROZEN_DOCKER_ENDPOINT=None, FROZEN_DOCKER_IDENTITY=None)
        frozen.start()
        self.addCleanup(frozen.stop)

    def test_recovery_requires_one_well_formed_daemon_identity_before_cleanup(self):
        invalid = [{}, {'daemon': None, 'orbstack': None}]
        for name in ('daemon', 'orbstack'):
            invalid.extend({name: value} for value in (None, False, '', [], {}, {'platform': 'other'}))
        invalid.extend(({'daemon': LINUX_IDENTITY, 'orbstack': MAC_IDENTITY},
                        {'daemon': MAC_IDENTITY}, {'orbstack': LINUX_IDENTITY}))
        for name, identity in (('daemon', LINUX_IDENTITY), ('orbstack', MAC_IDENTITY)):
            other = 'daemon' if name == 'orbstack' else 'orbstack'
            for value in (False, '', [], {}):
                invalid.append({name: identity, other: value})
            for key in identity:
                missing = copy.deepcopy(identity)
                del missing[key]
                invalid.append({name: missing})
                malformed = copy.deepcopy(identity)
                malformed[key] = False
                invalid.append({name: malformed})
            for key, value in (('context', ''), ('daemon_id', 'bad\nrecord'),
                               ('endpoint', 'tcp://foreign:2375'), ('storage', 'relative'),
                               ('socket_inode', 0), ('socket_device', -1)):
                invalid.append({name: {**identity, key: value}})
        for key, value in (('path', 'relative'), ('device', False), ('inode', 0)):
            invalid.append({'orbstack': {**MAC_IDENTITY, 'backing': {**MAC_IDENTITY['backing'], key: value}}})
        for records in invalid:
            with self.subTest(records=records), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                (output / 'owner.json').write_text(json.dumps({
                    'project': 'inside-observability-pilot-012345abcdef', 'cwd': str(ci.ROOT), **records,
                }))
                (output / 'worker.json').write_text(json.dumps({'pid': 12345, 'group': 12345}))
                (output / 'compose.json').write_text('{}')
                with patch('ci.os.kill', side_effect=ProcessLookupError), \
                        patch('ci.os.killpg', side_effect=ProcessLookupError), \
                        patch('ci.cleanup_project', return_value={'down': 'passed', 'residue': 'passed'}) as cleanup, \
                        patch.multiple(ci.pilot, FROZEN_DOCKER_ENDPOINT=LINUX_IDENTITY['endpoint'],
                                       FROZEN_DOCKER_IDENTITY=LINUX_IDENTITY), \
                        patch.object(ci.pilot.daemon, 'identify', side_effect=AssertionError('invalid identity reached Docker')), \
                        patch.object(ci.pilot.orbstack, 'identify', side_effect=AssertionError('invalid identity reached Docker')):
                    with self.assertRaisesRegex(ValueError, 'recorded Docker identity'):
                        ci.recover(output)
                    cleanup.assert_not_called()

    def test_recovery_requires_a_fresh_same_daemon_for_each_valid_variant(self):
        for name, identity in (('daemon', LINUX_IDENTITY), ('orbstack', MAC_IDENTITY)):
            other = 'daemon' if name == 'orbstack' else 'orbstack'
            identifier = ci.pilot.daemon if name == 'daemon' else ci.pilot.orbstack
            for unused in ({}, {other: None}):
                for changed in (False, True):
                    with self.subTest(name=name, unused=unused, changed=changed), tempfile.TemporaryDirectory() as directory:
                        output = Path(directory)
                        (output / 'owner.json').write_text(json.dumps({
                            'project': 'inside-observability-pilot-012345abcdef', 'cwd': str(ci.ROOT),
                            name: identity, **unused,
                        }))
                        (output / 'worker.json').write_text(json.dumps({'pid': 12345, 'group': 12345}))
                        (output / 'compose.json').write_text('{}')
                        fresh = {**identity, 'daemon_id': 'replacement'} if changed else identity
                        with patch('ci.os.kill', side_effect=ProcessLookupError), \
                                patch('ci.os.killpg', side_effect=ProcessLookupError), \
                                patch.object(identifier, 'identify', return_value=fresh), \
                                patch('ci.cleanup_project', return_value={'down': 'passed', 'residue': 'passed'}) as cleanup:
                            if changed:
                                with self.assertRaisesRegex(RuntimeError, 'recovery identity changed'):
                                    ci.recover(output)
                                cleanup.assert_not_called()
                            else:
                                self.assertEqual(ci.recover(output), {'down': 'passed', 'residue': 'passed'})
                                self.assertEqual(ci.pilot.FROZEN_DOCKER_IDENTITY, identity)
                                self.assertEqual(ci.pilot.FROZEN_DOCKER_ENDPOINT, identity['endpoint'])
                                cleanup.assert_called_once()

    def test_source_binding_includes_cpu_and_wire_corpus_helpers(self):
        import io
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = root / 'metadata'
            def command(args):
                if args[-1] == 'HEAD':
                    return 'a' * 40
                if args[-1] == '--porcelain':
                    return ''
                if args[-1] == 'HEAD^{tree}':
                    return 'b' * 40
                return str(root)
            with patch.object(ci, 'read_command', side_effect=command), \
                    patch.dict(os.environ, {'GITHUB_SHA': 'a' * 40}), \
                    patch.object(ci.shutil, 'disk_usage', return_value=SimpleNamespace(total=200 * 1024**3, free=100 * 1024**3)), \
                    patch('sys.stdout', new=io.StringIO()):
                self.assertEqual(ci.admission(metadata), 0)
            proof = json.loads((metadata / 'source.json').read_text())
            for name in ('native_cpu.py', 'link_privacy.py','notification_privacy.py','dependency_privacy.py','telegram_http_storage.py'):
                relative = 'scripts/observability-pilot/'+name
                helper = ci.ROOT / relative
                self.assertEqual(proof['inputs'][relative], hashlib.sha256(helper.read_bytes()).hexdigest())

    def test_artifact_collection_excludes_keys_binaries_and_raw_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, metadata, public = root / "private", root / "metadata", root / "public"
            output.mkdir()
            metadata.mkdir()
            (metadata / "source.json").write_text('{"checkout_sha":"fixture"}')
            (output / "evidence.json").write_text('{"status":"failed"}')
            (output / "trace-store-logging.json").write_text('{"outcome":"passed","ownership":"passed","driver":"none"}')
            (output / "notification-collector.json").write_text('{"outcome":"passed","cases":[]}')
            (output / "dependency-collector.json").write_text('{"outcome":"passed","cases":[]}')
            for forbidden in ("auth.json", "datasources.json", "collector-errors.log", "mcp-executable", "trace-store-inspect.json", "notification-otlp.bin", "notification-storage.json", "dependency-otlp.bin", "dependency-storage.json"):
                (output / forbidden).write_text("sentinel-secret")
            ci.collect(output, metadata, public)
            self.assertEqual(sorted(path.name for path in public.iterdir()), ["dependency-collector.json", "evidence.json", "notification-collector.json", "source.json", "trace-store-logging.json"])
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
                "project": "inside-observability-pilot-012345abcdef", "cwd": str(ci.ROOT), "daemon": LINUX_IDENTITY,
            }))
            (output / "worker.json").write_text(json.dumps({"pid": os.getpid(), "group": os.getpid()}))
            with patch.object(ci.pilot.daemon, "identify", return_value=LINUX_IDENTITY), \
                    self.assertRaisesRegex(ValueError, "registered worker still exists"):
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

    def test_recovery_refuses_live_child_after_registered_group_leader_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            fixture = Path(__file__).parent / "fixtures/process.py"
            leader = subprocess.Popen([sys.executable, str(fixture), "worker", directory, "descendant"],
                                      start_new_session=True)
            try:
                self.assertEqual(leader.wait(timeout=FIXTURE_LEADER_EXIT_BUDGET_SECONDS), 0)
                (output / "owner.json").write_text(json.dumps({
                    "project": "inside-observability-pilot-012345abcdef", "cwd": str(ci.ROOT), "daemon": LINUX_IDENTITY,
                }))
                (output / "worker.json").write_text(json.dumps({"pid": leader.pid, "group": leader.pid}))
                (output / "compose.json").write_text("{}")
                with patch.object(ci.pilot.daemon, "identify", return_value=LINUX_IDENTITY), \
                        patch("ci.subprocess.run", side_effect=AssertionError("Docker cleanup must not run")):
                    with self.assertRaisesRegex(ValueError, "registered worker process group still exists"):
                        ci.recover(output)
            finally:
                try:
                    os.killpg(leader.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                leader.wait(timeout=FIXTURE_LEADER_EXIT_BUDGET_SECONDS)


if __name__ == "__main__":
    unittest.main()
