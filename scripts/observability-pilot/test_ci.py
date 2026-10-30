"""Local file boundary contracts for hosted evidence; no Docker or live providers."""

import copy
import hashlib
import stat
import json
from pathlib import Path
import tempfile
import unittest
import os
import signal
import shutil
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

import ci

FIXTURE_LEADER_EXIT_BUDGET_SECONDS = 2
FIXTURE_SOURCE_PROCESS_TIMEOUT_SECONDS = 10
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
            expected = {
                'infra/observability/pilot/' + name for name in (
                    'inputs.lock.json', 'config.alloy', 'privacy-policy.json',
                    'Caddyfile', 'vmauth.routes.json', 'probe.lock.json', 'owner-overview.json')
            } | {
                'scripts/observability-pilot/' + name for name in (
                    'ci.py', 'core_timing.py', 'source_status.py', 'source_status_query.py',
                    'source_status_scenario.py', 'pilot.py', 'owner_overview.py', 'native_cpu.py',
                    'privacy_config.py', 'collector_privacy.py', 'link_privacy.py',
                    'notification_privacy.py', 'dependency_privacy.py', 'email_privacy.py',
                    'telegram_http_storage.py', 'daemon.py', 'orbstack.py', 'storage_policy.py',
                    'telegram_runtime_privacy.py', 'telegram_runtime_oracle.py')
            } | {'.github/workflows/observability-pilot.yml', 'apps/backend/openapi/platform-api.json'}
            expected.update('infra/observability/horizon/'+name for name in (
                'README.md', 'metricsql-security.patch', 'metricsql-security.lock.json','go.mod','go.sum','main.go','metrics.go','metrics_test.go',
                'traces.go','traces_test.go','server.go','server_test.go','metadata.go','metadata_test.go',
                'jaeger.go','native_test.go','toolchain.lock.json'))
            expected.update({'scripts/observability-pilot/horizon_build.py','scripts/heavy-check/bounded.py'})
            self.assertEqual(set(proof['inputs']), expected)
            self.assertEqual(len(proof['inputs']), 48)
            relative = 'apps/backend/openapi/platform-api.json'
            self.assertEqual(proof['inputs'][relative], hashlib.sha256((ci.ROOT/relative).read_bytes()).hexdigest())
            workflow = (ci.ROOT/'.github/workflows/observability-pilot.yml').read_text()
            self.assertIn('      - ' + relative + '\n', workflow)
            for name in ('native_cpu.py', 'link_privacy.py','notification_privacy.py','dependency_privacy.py','email_privacy.py','telegram_http_storage.py', 'telegram_runtime_privacy.py', 'telegram_runtime_oracle.py', 'source_status.py', 'source_status_query.py', 'source_status_scenario.py'):
                relative = 'scripts/observability-pilot/'+name
                helper = ci.ROOT / relative
                self.assertEqual(proof['inputs'][relative], hashlib.sha256(helper.read_bytes()).hexdigest())

    def test_executed_telegram_modules_change_their_named_source_binding(self):
        import hashlib
        import io
        original_read = Path.read_bytes
        for name in ('telegram_runtime_privacy.py', 'telegram_runtime_oracle.py', 'owner_overview.py', 'owner-overview.json'):
            with self.subTest(module=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                metadata = root / 'metadata'
                relative = ('infra/observability/pilot/' if name == 'owner-overview.json' else 'scripts/observability-pilot/') + name
                changed = ci.ROOT / relative
                def command(args):
                    if args[-1] == 'HEAD':
                        return 'a' * 40
                    if args[-1] == '--porcelain':
                        return ''
                    if args[-1] == 'HEAD^{tree}':
                        return 'b' * 40
                    return str(root)
                def read_bytes(path):
                    return b'changed executed module' if path == changed else original_read(path)
                with patch.object(ci, 'read_command', side_effect=command), \
                        patch.dict(os.environ, {'GITHUB_SHA': 'a' * 40}), \
                        patch.object(Path, 'read_bytes', read_bytes), \
                        patch.object(ci.shutil, 'disk_usage', return_value=SimpleNamespace(total=200 * 1024**3, free=100 * 1024**3)), \
                        patch('sys.stdout', new=io.StringIO()):
                    self.assertEqual(ci.admission(metadata), 0)
                proof = json.loads((metadata / 'source.json').read_text())
                self.assertIn(relative, proof['inputs'])
                self.assertEqual(proof['inputs'][relative], hashlib.sha256(b'changed executed module').hexdigest())
                self.assertNotEqual(proof['inputs'][relative], hashlib.sha256(original_read(changed)).hexdigest())

    def test_source_binding_refuses_dirty_checkout_and_provider_mismatch_before_docker(self):
        for dirty, provider in ((True, 'a' * 40), (False, 'c' * 40)):
            with self.subTest(dirty=dirty), tempfile.TemporaryDirectory() as directory:
                def command(args):
                    if args[-1] == 'HEAD':
                        return 'a' * 40
                    if args[-1] == '--porcelain':
                        return ' M fixture.py' if dirty else ''
                    raise AssertionError('source rejection must precede Docker admission')
                with patch.object(ci, 'read_command', side_effect=command), \
                        patch.dict(os.environ, {'GITHUB_SHA': provider}), \
                        self.assertRaises(ValueError):
                    ci.admission(Path(directory) / 'metadata')

    def test_artifact_collection_excludes_keys_binaries_and_raw_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, metadata, public = root / "private", root / "metadata", root / "public"
            output.mkdir()
            metadata.mkdir()
            (metadata / "source.json").write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,'scope':ci.core_timing.METADATA_SCOPE}))
            (output / 'source-freshness.json').write_text('{"state":"failed"}')
            (output / "evidence.json").write_text('{"status":"failed"}')
            (output / "collector-logging.json").write_text('{"outcome":"passed","ownership":"passed","driver":"none"}')
            (output / "trace-store-logging.json").write_text('{"outcome":"passed","ownership":"passed","driver":"none"}')
            (output / "notification-collector.json").write_text('{"outcome":"passed","cases":[]}')
            (output / "dependency-collector.json").write_text('{"outcome":"passed","cases":[]}')
            (output / "email-collector.json").write_text('{"outcome":"passed","cases":[]}')
            (output / "telegram-runtime-collector.json").write_text('{"outcome":"passed","cases":[],"metrics":[]}')
            for forbidden in ("source-freshness-owned.json", "auth.json", "datasources.json", "collector-errors.log", "mcp-executable", "trace-store-inspect.json", "notification-otlp.bin", "notification-storage.json", "dependency-otlp.bin", "dependency-storage.json", "email-otlp.bin", "email-storage.json", "telegram-runtime-otlp.bin", "telegram-runtime-storage.json"):
                (output / forbidden).write_text("sentinel-secret")
            ci.collect(output, metadata, public)
            self.assertEqual(sorted(path.name for path in public.iterdir()), ["collector-logging.json", "core-stage-timing.json", "dependency-collector.json", "email-collector.json", "evidence.json", "notification-collector.json", "source-freshness.json", "source.json", "telegram-runtime-collector.json", "trace-store-logging.json"])
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
            (metadata/'source.json').write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,'scope':ci.core_timing.METADATA_SCOPE}))
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


class RejectionCollectionTests(unittest.TestCase):
    def test_explicit_selection_never_copies_unvalidated_rejection_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            output, metadata, public = root / 'private', root / 'metadata', root / 'public'
            output.mkdir(mode=0o700)
            metadata.mkdir(mode=0o700)
            (output / 'source-status-rejection.json').write_text('{"private":"private-sentinel"}')
            (output / 'source-status-rejection.json').chmod(0o600)
            with self.assertRaises(ValueError):
                ci.collect(output, metadata, public, artifacts=('source-status-rejection.json',))
            self.assertFalse((public / 'source-status-rejection.json').exists())


class FiniteRejectionCollectionTests(unittest.TestCase):
    def fixture(self, root):
        output, metadata = root / 'private', root / 'metadata'
        output.mkdir(mode=0o700); metadata.mkdir(mode=0o700)
        source = {'checkout_sha': 'a' * 40, 'checkout_tree': 'b' * 40,
                  'provider_execution_sha': 'a' * 40, 'scope': ci.core_timing.METADATA_SCOPE,
                  'inputs': {str(path.relative_to(ci.ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in ci._admission_inputs()}}
        (metadata / 'source.json').write_text(json.dumps(source))
        (output / 'evidence.json').write_text(json.dumps({'source': 'a' * 40,
            'scope': 'synthetic OTLP core compatibility smoke only'}))
        detail = {'context': 'current', 'slot': 'values', 'code': 'decode',
                  'values_bytes': 16, 'timestamps_bytes': 16, 'rows': None, 'difference': None}
        value = ci.source_status.rejection(detail, 'a' * 40)
        path = output / ci.source_status.REJECTION_NAME
        path.write_text(json.dumps(value, indent=2)); path.chmod(0o600)
        return output, metadata, source, value

    @staticmethod
    def command(args):
        if args[-1] == 'HEAD': return 'a' * 40
        if args[-1] == 'HEAD^{tree}': return 'b' * 40
        if 'status' in args: return ''
        if args[-1] == 'a' * 40 + ':scripts/observability-pilot/source_status_query.py':
            raw = (ci.ROOT / 'scripts/observability-pilot/source_status_query.py').read_bytes()
            return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        raise AssertionError('unexpected external command')

    def test_only_strict_projection_is_collected_for_default_and_explicit_selection(self):
        for selection in (None, (ci.source_status.REJECTION_NAME,)):
            with self.subTest(selection=selection), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                output, metadata, _, value = self.fixture(root)
                original = (output / ci.source_status.REJECTION_NAME).read_bytes()
                (output / 'source-freshness.json').write_text('{"state":"failed"}')
                with patch.object(ci, 'read_command', side_effect=self.command) as commands:
                    ci.collect(output, metadata, root / 'public', artifacts=selection)
                path = root / 'public' / ci.source_status.REJECTION_NAME
                self.assertEqual(json.loads(path.read_bytes()), value)
                self.assertNotEqual(path.read_bytes(), original)
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertLessEqual(path.stat().st_size, 4096)
                self.assertEqual(commands.call_count, 4)
                if selection is None:
                    self.assertEqual((root / 'public' / 'source-freshness.json').read_text(), '{"state":"failed"}')

    def test_every_changed_runtime_byte_and_map_membership_are_freshly_bound(self):
        for name in ('ci.py', 'source_status.py', 'source_status_query.py'):
            for change in ('bytes', 'omission', 'runtime_bytes'):
                with self.subTest(name=name, change=change), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve(); output, metadata, source, _ = self.fixture(root)
                    relative = 'scripts/observability-pilot/' + name
                    if change == 'bytes': source['inputs'][relative] = '0' * 64
                    elif change == 'omission': del source['inputs'][relative]
                    (metadata / 'source.json').write_text(json.dumps(source))
                    original_read = Path.read_bytes
                    def read_bytes(path):
                        if change == 'runtime_bytes' and path == ci.ROOT / relative:
                            return b'changed executed runtime bytes'
                        return original_read(path)
                    with patch.object(Path, 'read_bytes', read_bytes), \
                         patch.object(ci, 'read_command', side_effect=self.command), self.assertRaises(ValueError):
                        ci.collect(output, metadata, root / 'public')
                    self.assertFalse((root / 'public' / ci.source_status.REJECTION_NAME).exists())

    def test_stale_sha_tree_dirty_source_and_private_source_replacement_refuse(self):
        for change in ('sha', 'tree', 'dirty', 'evidence', 'diagnostic', 'directory'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve(); output, metadata, _, value = self.fixture(root)
                if change == 'evidence':
                    (output / 'evidence.json').write_text(json.dumps({'source': 'c' * 40,
                        'scope': 'synthetic OTLP core compatibility smoke only'}))
                if change == 'diagnostic':
                    (output / ci.source_status.REJECTION_NAME).write_text(json.dumps({**value, 'source': 'c' * 40}))
                replaced = []
                def command(args):
                    if change == 'directory' and not replaced:
                        replaced.append(True); output.rename(root / 'original'); output.mkdir(mode=0o700)
                        for path in (root / 'original').iterdir():
                            copied = output / path.name; copied.write_bytes(path.read_bytes()); copied.chmod(0o600)
                    if change == 'sha' and args[-1] == 'HEAD': return 'c' * 40
                    if change == 'tree' and args[-1] == 'HEAD^{tree}': return 'c' * 40
                    if change == 'dirty' and 'status' in args: return ' M source_status.py'
                    return self.command(args)
                with patch.object(ci, 'read_command', side_effect=command), self.assertRaises(ValueError):
                    ci.collect(output, metadata, root / 'public')
                self.assertFalse((root / 'public' / ci.source_status.REJECTION_NAME).exists())

    def test_private_file_and_closed_schema_attacks_are_refused_before_publication(self):
        for attack in ('extra', 'sentinel', 'bool', 'oversize', 'mode', 'symlink', 'hardlink', 'fifo', 'duplicate'):
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve(); output, metadata, _, value = self.fixture(root)
                path = output / ci.source_status.REJECTION_NAME
                if attack in ('symlink', 'hardlink', 'fifo'):
                    path.rename(output / 'target')
                    if attack == 'symlink': path.symlink_to(output / 'target')
                    elif attack == 'hardlink': os.link(output / 'target', path)
                    else: os.mkfifo(path, 0o600)
                elif attack == 'mode': path.chmod(0o644)
                elif attack == 'oversize': path.write_text(' ' * 4097)
                elif attack == 'extra': path.write_text(json.dumps({**value, 'private': 'private-sentinel'}))
                elif attack == 'sentinel': path.write_text(json.dumps({**value, 'code': 'decode private-sentinel'}))
                elif attack == 'bool': path.write_text(json.dumps({**value, 'counts': {**value['counts'], 'rows': True}}))
                else: path.write_text(json.dumps(value).replace('"schema": 1', '"schema": 1,"schema":1'))
                with patch.object(ci, 'read_command', side_effect=self.command), self.assertRaises(ValueError):
                    ci.collect(output, metadata, root / 'public', artifacts=(ci.source_status.REJECTION_NAME,))
                self.assertFalse((root / 'public' / ci.source_status.REJECTION_NAME).exists())

    def test_exact_file_cap_is_reconstructed_and_foreign_owner_or_read_race_is_refused(self):
        for attack in ('exact_cap', 'uid', 'file_race', 'directory_mode', 'metadata_link',
                       'metadata_hardlink', 'metadata_fifo', 'metadata_uid', 'metadata_race', 'metadata_directory'):
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve(); output, metadata, _, value = self.fixture(root)
                path = output / ci.source_status.REJECTION_NAME
                if attack == 'exact_cap':
                    raw = path.read_bytes(); path.write_bytes(raw + b' ' * (4096 - len(raw)))
                if attack == 'directory_mode': output.chmod(0o755)
                if attack == 'metadata_link':
                    (metadata / 'source.json').rename(metadata / 'target')
                    (metadata / 'source.json').symlink_to(metadata / 'target')
                if attack in ('metadata_hardlink', 'metadata_fifo'):
                    (metadata / 'source.json').rename(metadata / 'target')
                    if attack == 'metadata_hardlink': os.link(metadata / 'target', metadata / 'source.json')
                    else: os.mkfifo(metadata / 'source.json', 0o600)
                metadata_inode = (metadata / 'source.json').stat().st_ino
                inode = path.stat().st_ino
                native_stat = os.fstat
                reads = []
                def fstat(descriptor):
                    info = native_stat(descriptor)
                    if info.st_ino == metadata_inode:
                        if attack == 'metadata_uid':
                            fields = list(info); fields[4] = os.getuid() + 1
                            return os.stat_result(fields)
                        if attack == 'metadata_race' and not reads:
                            reads.append(True)
                            (metadata / 'source.json').rename(metadata / 'moved')
                            (metadata / 'source.json').write_bytes((metadata / 'moved').read_bytes())
                        if attack == 'metadata_directory' and not reads:
                            reads.append(True)
                            metadata.rename(root / 'original-metadata'); metadata.mkdir(mode=0o700)
                            (metadata / 'source.json').write_bytes((root / 'original-metadata/source.json').read_bytes())
                    if info.st_ino == inode:
                        if attack == 'uid':
                            fields = list(info); fields[4] = os.getuid() + 1
                            return os.stat_result(fields)
                        if attack == 'file_race' and not reads:
                            reads.append(True)
                            path.rename(output / 'moved')
                            path.write_text(json.dumps(value)); path.chmod(0o600)
                    return info
                with patch('os.fstat', side_effect=fstat), patch.object(ci, 'read_command', side_effect=self.command):
                    if attack == 'exact_cap':
                        ci.collect(output, metadata, root / 'public')
                        result = root / 'public' / ci.source_status.REJECTION_NAME
                        self.assertEqual(json.loads(result.read_bytes()), value)
                        self.assertLess(result.stat().st_size, 4096)
                    else:
                        with self.assertRaises(ValueError):
                            ci.collect(output, metadata, root / 'public')
                        self.assertFalse((root / 'public' / ci.source_status.REJECTION_NAME).exists())

    def test_basename_aliases_never_reach_generic_copy(self):
        for name in ('./source-status-rejection.json', '../private/source-status-rejection.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve(); output, metadata, _, _ = self.fixture(root)
                with self.assertRaises(ValueError):
                    ci.collect(output, metadata, root / 'public', artifacts=(name,))
                self.assertFalse((root / 'public').exists())

    def test_absent_diagnostic_stays_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); output, metadata, _, _ = self.fixture(root)
            (output / ci.source_status.REJECTION_NAME).unlink()
            ci.collect(output, metadata, root / 'public')
            self.assertFalse((root / 'public' / ci.source_status.REJECTION_NAME).exists())


class QueryHelperAdmissionTests(unittest.TestCase):
    @staticmethod
    def copy_sources(root):
        for name in ('observability-fullstack', 'observability-signoz',
                     'observability-resource', 'observability-pilot'):
            target = root / 'scripts' / name
            target.mkdir(parents=True)
            for original in (ci.ROOT / 'scripts' / name).glob('*.py'):
                shutil.copyfile(original, target / original.name)

    def test_actual_protected_worker_refuses_mac_before_loading_changed_query_helper(self):
        # Copy real runtime owners, so this catches the introduced ci import in
        # _worker -> _native_runtime, without replacing that call chain.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.copy_sources(root)
            (root / 'scripts/observability-pilot/source_status_query.py').write_text(
                "raise ValueError('QUERY_HELPER_UNVERIFIED_BYTES_EXECUTED')\n")
            code = """import importlib.util, platform, sys
from pathlib import Path
path = Path(sys.argv[1])
platform.system = lambda: 'Darwin'
platform.machine = lambda: 'arm64'
spec = importlib.util.spec_from_file_location('probe_witness', path)
witness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(witness)
try:
    witness._worker(path.parent / 'nonexistent-prepared-not-read')
except ValueError as error:
    assert str(error) == 'native_linux_amd64_required', str(error)
else:
    raise AssertionError('worker unexpectedly completed')
assert 'source_status_query' not in sys.modules
print('NATIVE_HOST_REFUSED_BEFORE_QUERY_HELPER')
"""
            result = subprocess.run([sys.executable, '-I', '-B', '-c', code,
                str(root / 'scripts/observability-fullstack/representative_witness.py')],
                capture_output=True, text=True, timeout=FIXTURE_SOURCE_PROCESS_TIMEOUT_SECONDS)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'NATIVE_HOST_REFUSED_BEFORE_QUERY_HELPER')


    def test_actual_collect_validates_before_execution_and_never_reopens_or_reuses_query_code(self):
        # Each process imports the actual copied CI and uses real Git source
        # admission. Only a filesystem race is injected, after real git status.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.copy_sources(root)
            for original in ci._admission_inputs():
                target = root / original.relative_to(ci.ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original, target)
            def git(*args):
                return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null',
                    '-c', 'user.name=Source fixture', '-c', 'user.email=fixture@invalid',
                    '-c', 'commit.gpgSign=false', '-c', 'core.fsmonitor=false', *args], cwd=root,
                    capture_output=True, text=True, check=True, timeout=FIXTURE_SOURCE_PROCESS_TIMEOUT_SECONDS).stdout.strip()
            git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixed source fixture')
            sha, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
            inputs = {str(path.relative_to(ci.ROOT)): hashlib.sha256(
                (root / path.relative_to(ci.ROOT)).read_bytes()).hexdigest() for path in ci._admission_inputs()}
            query_path = root / 'scripts/observability-pilot/source_status_query.py'
            original_query = query_path.read_bytes()
            code = """import hashlib, json, sys, types
from pathlib import Path
from unittest.mock import patch
root, attack = Path(sys.argv[1]), sys.argv[2]
query_path = root / 'scripts/observability-pilot/source_status_query.py'
original_query = query_path.read_bytes()
marker = b"raise AssertionError('QUERY_HELPER_UNVERIFIED_BYTES_EXECUTED')\\n"
if attack in ('inactive', 'absent', 'changed', 'coordinated'):
    query_path.write_bytes(marker)
sys.path.insert(0, str(query_path.parent))
import ci
assert 'source_status_query' not in sys.modules
assert ci.REJECTION_NAME == ci.source_status.REJECTION_NAME
assert ci.REJECTION_MAX_BYTES == ci.source_status.REJECTION_MAX_BYTES == 4096
output, metadata, public = root / 'private', root / 'metadata', root / 'public'
if attack == 'coordinated':
    value = json.loads((metadata / 'source.json').read_bytes())
    value['inputs']['scripts/observability-pilot/source_status_query.py'] = hashlib.sha256(marker).hexdigest()
    (metadata / 'source.json').write_text(json.dumps(value))
if attack in ('inactive', 'absent'):
    if attack == 'absent':
        (output / ci.REJECTION_NAME).unlink()
    ci.collect(output, metadata, public, artifacts=() if attack == 'inactive' else None)
    assert 'source_status_query' not in sys.modules
    print('INACTIVE_QUERY_UNLOADED')
    raise SystemExit(0)
if attack.startswith('foreign') or attack == 'cached':
    from importlib.machinery import ModuleSpec
    alias = types.ModuleType('source_status_query')
    alias.__file__ = str(query_path) if attack != 'foreign_file' else '/foreign/query.py'
    alias.__spec__ = ModuleSpec('source_status_query', None,
        origin='/foreign/query.py' if attack == 'foreign_origin' else str(query_path))
    def untrusted(*args, **kwargs):
        raise AssertionError('CACHED_QUERY_FUNCTION_EXECUTED')
    alias._read_rejection = untrusted
    sys.modules['source_status_query'] = object() if attack == 'foreign_object' else alias
command = ci.read_command
raced = []
def read_command(args):
    if attack == 'coordinated' and 'status' in args:
        query_path.write_bytes(original_query)
    value = command(args)
    if attack == 'race' and 'status' in args:
        query_path.write_bytes(marker)
        raced.append(True)
    return value
try:
    with patch.object(ci, 'read_command', side_effect=read_command):
        ci.collect(output, metadata, public, artifacts=(ci.REJECTION_NAME,))
except ValueError:
    assert attack in ('changed', 'coordinated', 'foreign_file', 'foreign_origin', 'foreign_object'), attack
    assert not public.exists()
    print('UNTRUSTED_QUERY_REFUSED_BEFORE_EXECUTION')
else:
    assert attack in ('valid', 'race', 'cached'), attack
    assert json.loads((public / ci.REJECTION_NAME).read_bytes()) == json.loads(
        (output / ci.REJECTION_NAME).read_bytes())
    if attack == 'race':
        assert raced and query_path.read_bytes() == marker
        try:
            ci.collect(output, metadata, root / 'second-public', artifacts=(ci.REJECTION_NAME,))
        except ValueError:
            pass
        else:
            raise AssertionError('fresh source was cached')
    print('VERIFIED_BYTES_ONLY')
"""
            for attack in ('inactive', 'absent', 'changed', 'coordinated', 'foreign_file', 'foreign_origin', 'foreign_object',
                           'valid', 'race', 'cached'):
                with self.subTest(attack=attack):
                    query_path.write_bytes(original_query)
                    for name in ('private', 'metadata', 'public', 'second-public'):
                        shutil.rmtree(root / name, ignore_errors=True)
                    output, metadata = root / 'private', root / 'metadata'
                    output.mkdir(mode=0o700); metadata.mkdir(mode=0o700)
                    (metadata / 'source.json').write_text(json.dumps({'checkout_sha': sha,
                        'checkout_tree': tree, 'provider_execution_sha': sha,
                        'scope': ci.core_timing.METADATA_SCOPE, 'inputs': inputs}))
                    (output / 'evidence.json').write_text(json.dumps({'source': sha,
                        'scope': ci.core_timing.EVIDENCE_SCOPE}))
                    value = ci.source_status.rejection({'context': 'current', 'slot': 'internal',
                        'code': 'internal_shape', **dict.fromkeys(ci.source_status.REJECTION_COUNTS)}, sha)
                    rejection = output / ci.source_status.REJECTION_NAME
                    rejection.write_text(json.dumps(value)); rejection.chmod(0o600)
                    result = subprocess.run([sys.executable, '-I', '-B', '-c', code, str(root), attack],
                                            capture_output=True, text=True, timeout=FIXTURE_SOURCE_PROCESS_TIMEOUT_SECONDS)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    expected = ('INACTIVE_QUERY_UNLOADED' if attack in ('inactive', 'absent') else
                        'VERIFIED_BYTES_ONLY' if attack in ('valid', 'race', 'cached') else
                        'UNTRUSTED_QUERY_REFUSED_BEFORE_EXECUTION')
                    self.assertEqual(result.stdout.strip(), expected)


if __name__ == "__main__":
    unittest.main()
