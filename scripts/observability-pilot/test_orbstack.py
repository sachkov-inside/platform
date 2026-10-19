"""OrbStack admission contracts with filesystem/process doubles; no Docker/providers."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import orbstack

GIB = 1024**3
SUPERVISED_FIXTURE_BUDGET_SECONDS = 8
SOCKET_PROBE_BUDGET_SECONDS = .1
DESCENDANT_CLOSED_BUDGET_SECONDS = 1
MONITOR_FAILURE_BUDGET_SECONDS = 1
MONITOR_FIXTURE_INTERVAL_SECONDS = .001

class OrbStackAdmissionTest(unittest.TestCase):
    def test_vm_sample_gates_actual_vm_free_space_and_rejects_identity_change(self):
        budget = orbstack.VmBudget()
        with self.assertRaisesRegex(RuntimeError, '16 GiB'):
            budget.accept('abcd 4096 10000000 1 ext2/ext3', now=0)
        budget = orbstack.VmBudget()
        budget.accept('abcd 4096 10000000 5000000 ext2/ext3', now=0)
        budget.accept('abcd 4096 10000000 4999999 ext2/ext3', now=1)
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            budget.accept('other 4096 10000000 5000000 ext2/ext3', now=2)

    def test_host_identity_requires_unique_open_backing_file_and_exact_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.img.raw'
            path.write_bytes(b'fixture')
            identity = orbstack.backing_identity('p123\ncOrbStack Helper\nn' + str(path))
            self.assertEqual(identity['path'], str(path.resolve()))
            with self.assertRaisesRegex(RuntimeError, 'unique'):
                orbstack.backing_identity('')
            other = Path(directory) / 'other/data.img.raw'
            other.parent.mkdir(); other.write_bytes(b'other')
            with self.assertRaisesRegex(RuntimeError, 'unique'):
                orbstack.backing_identity('n'+str(path)+'\nn'+str(other))
            other.replace(path)
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                orbstack.assert_backing(identity)

    def test_probe_plan_has_no_network_socket_privilege_or_writable_mount(self):
        lock = json.loads((Path(__file__).parents[2]/'infra/observability/pilot/probe.lock.json').read_text())
        plan = orbstack.probe_service(lock, '/var/lib/docker')
        self.assertEqual(plan['network_mode'], 'none')
        self.assertEqual(plan['user'], '65534:65534')
        self.assertEqual(plan['cap_drop'], ['ALL'])
        self.assertTrue(plan['read_only'])
        self.assertEqual(plan['volumes'], [{'type':'bind','source':'/var/lib/docker','target':'/probe','read_only':True,'bind':{'create_host_path':False}}])
        with self.assertRaisesRegex(RuntimeError, 'bootstrap'):
            orbstack.probe_service({**lock, 'compressed_bytes': 99*GIB}, '/var/lib/docker')
        with self.assertRaisesRegex(RuntimeError, 'absolute'):
            orbstack.probe_service(lock, '../docker')

    def test_vm_loss_malformed_counters_and_growth_fail_closed(self):
        budget = orbstack.VmBudget()
        budget.accept('abcd 4096 10000000 5000000 ext2/ext3', now=0)
        with self.assertRaisesRegex(RuntimeError, 'heartbeat'):
            budget.assert_fresh(now=4)
        with self.assertRaisesRegex(RuntimeError, 'budget'):
            budget.accept('abcd 4096 10000000 3900000 ext2/ext3', now=1)
        for line in ('error permission denied', 'abcd 0 10 5 x', 'abcd 4096 2 3 x'):
            with self.subTest(line=line), self.assertRaises(RuntimeError):
                orbstack.VmBudget().accept(line, now=0)

    def test_host_bootstrap_uses_stricter_limit_inside_existing_pilot_budget(self):
        initial = {'filesystems':{'1':{'total_bytes':100*GIB,'free_bytes':20*GIB}}, 'allocated_image_bytes':GIB}
        current = {'filesystems':{'1':{'total_bytes':100*GIB,'free_bytes':20*GIB-33*1024**2}}, 'allocated_image_bytes':GIB}
        orbstack.check_host(initial, current)
        with self.assertRaisesRegex(RuntimeError, 'bootstrap'):
            orbstack.check_host(initial, current, bootstrap=True)
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            orbstack.check_host(initial, {**initial, 'filesystems':{}})

    def test_fresh_stat_rejects_buffered_sample_from_previous_request(self):
        def stale(args, **kwargs):
            return 'old-nonce abcd 4096 10000000 5000000 ext2/ext3\n'
        with self.assertRaisesRegex(RuntimeError, 'freshness'):
            orbstack.fresh_sample(['compose'], stale)

    def test_all_runtime_docker_commands_use_frozen_socket(self):
        import pilot
        with patch.object(pilot, 'FROZEN_DOCKER_ENDPOINT', 'unix:///owned/docker.sock'), patch('pilot.subprocess.run') as run:
            run.return_value.stdout = ''
            pilot.command(['docker', 'compose', 'down'])
            self.assertEqual(run.call_args.args[0], ['docker','--host','unix:///owned/docker.sock','compose','down'])

    def test_vm_bootstrap_opens_full_workload_only_after_challenged_stat(self):
        lock = json.loads((Path(__file__).parents[2]/'infra/observability/pilot/probe.lock.json').read_text())
        for outcome in ('success', 'body-failure', 'invalid'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                calls = []
                def command(args, **kwargs):
                    calls.append(args)
                    if 'exec' in args:
                        return 'oldnonce stale' if outcome == 'invalid' else args[-1]+' abcd 4096 10000000 5000000 ext2/ext3\n'
                    return ''
                with patch('orbstack.verify_probe'):
                    try:
                        with orbstack.vm_budget(['fake-compose'], lock, command, output, docker_args=lambda args:args):
                            self.assertTrue((output/'storage-vm.json').is_file())
                            self.assertNotEqual(outcome, 'invalid')
                            if outcome == 'body-failure':
                                raise ValueError('body failure')
                    except ValueError:
                        self.assertEqual(outcome, 'body-failure')
                    except RuntimeError:
                        self.assertEqual(outcome, 'invalid')
                self.assertEqual(calls[0][-1], lock['image'])
                self.assertNotIn('--context', calls[0])
                self.assertEqual(calls[1], ['fake-compose','up','-d','--no-deps','storage-probe'])
                self.assertFalse(any('logs' in call for call in calls))

    def test_publisher_verifier_checks_gzip_expansion_digest_and_platform_before_pull(self):
        import gzip
        import hashlib
        import io
        payload = b'fixture layer'
        compressed = gzip.compress(payload, mtime=0)
        def descriptor(content, media):
            return {'size':len(content),'digest':'sha256:'+hashlib.sha256(content).hexdigest(),'mediaType':media}
        layer = descriptor(compressed, 'application/vnd.oci.image.layer.v1.tar+gzip')
        diff = 'sha256:'+hashlib.sha256(payload).hexdigest()
        config = json.dumps({'architecture':'arm64','os':'linux','rootfs':{'diff_ids':[diff]}}).encode()
        config_descriptor = descriptor(config, 'application/vnd.oci.image.config.v1+json')
        manifest = json.dumps({'layers':[layer],'config':config_descriptor}).encode()
        manifest_descriptor = descriptor(manifest, 'application/vnd.oci.image.manifest.v1+json')
        manifest_descriptor['platform'] = {'architecture':'arm64'}
        lock = {'image':'docker.io/library/busybox@'+manifest_descriptor['digest'],
                'manifest':manifest_descriptor,'config':config_descriptor,
                'layers':[{**layer,'unpacked_bytes':len(payload),'unpacked_digest':diff}],
                'compressed_bytes':len(compressed),'unpacked_bytes':len(payload)}
        def response(request, **kwargs):
            url = request.full_url
            content = b'{"token":"test-token"}' if 'auth.docker.io' in url else (
                manifest if '/manifests/' in url else config if config_descriptor['digest'] in url else compressed)
            return io.BytesIO(content)
        with patch('urllib.request.urlopen', side_effect=response):
            orbstack.verify_probe(lock)
            with self.assertRaisesRegex(RuntimeError, 'unpacked'):
                orbstack.verify_probe({**lock,'unpacked_bytes':len(payload)+1})
            with patch.object(orbstack, 'PROBE_UNPACKED_LIMIT_BYTES', len(payload)-1), self.assertRaisesRegex(RuntimeError, 'bootstrap'):
                orbstack.verify_probe(lock)

    def test_public_mac_supervisor_cleans_probe_and_core_for_worker_outcomes(self):
        import subprocess
        import sys
        import socket
        import pilot
        fixture = Path(__file__).parent/'fixtures/mac-run.py'
        for outcome, expected in (('success',0),('failure',1),('timeout',124),('sigterm',143),('sigkill',137)):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                state = Path(directory)
                (state/'foreign-resource').write_text('foreign')
                result = subprocess.run([sys.executable,str(fixture),'parent',directory,outcome],
                                        capture_output=True, text=True, timeout=SUPERVISED_FIXTURE_BUDGET_SECONDS)
                output = state/'run'
                outcome_record = json.loads((output/'worker-outcome.json').read_text())
                self.assertEqual(outcome_record['exit_code'], expected, result.stderr)
                self.assertEqual(outcome_record['cleanup']['down'],'passed')
                self.assertEqual(outcome_record['cleanup']['residue'],'passed')
                self.assertFalse((output/'owned-core').exists())
                self.assertFalse((output/'owned-probe').exists())
                self.assertTrue((state/'foreign-resource').exists())
                requests = (output/'fresh-requests').read_text().splitlines()
                self.assertGreaterEqual(len(requests),2)
                self.assertEqual(len(requests),len(set(requests)))

    def test_identity_rejects_non_object_daemon_metadata_before_bootstrap(self):
        import socket
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            endpoint = home/'.orbstack/run/docker.sock'
            endpoint.parent.mkdir(parents=True)
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(str(endpoint))
                def command(args):
                    if args[1:3] == ['context','show']:
                        return 'orbstack'
                    if 'inspect' in args:
                        return 'unix://'+str(endpoint)
                    return '[]'
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    orbstack.identify(command, home=home)

    def test_sample_loss_interrupts_foreground_and_restores_signal_and_thread(self):
        import signal
        import threading
        previous = signal.getsignal(signal.SIGUSR1)
        threads = {thread.ident for thread in threading.enumerate()}
        samples = iter([20*GIB, 9*GIB])
        with self.assertRaisesRegex(RuntimeError, 'storage monitor'):
            with orbstack.sampled_budget(lambda: next(samples),
                    lambda free: orbstack.assert_budget(20*GIB, free), interval=MONITOR_FIXTURE_INTERVAL_SECONDS):
                threading.Event().wait(MONITOR_FAILURE_BUDGET_SECONDS)
        self.assertEqual(signal.getsignal(signal.SIGUSR1), previous)
        self.assertEqual({thread.ident for thread in threading.enumerate()}, threads)

    def test_registry_token_rejects_non_string_control_and_oversized_values(self):
        for value in (None, {}, 42, '', 'a\rb', 'a\nb', 'a b', 'x'*40000):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(RuntimeError):
                orbstack.registry_token({'token':value})
        self.assertEqual(orbstack.registry_token({'token':'opaque.valid-token_123'}), 'opaque.valid-token_123')

    def test_monitor_signals_during_down_latch_failure_without_skipping_residue(self):
        import os
        import signal
        import sys
        import pilot
        fixture = Path(__file__).parent/'fixtures/process.py'
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            compose = [sys.executable,str(fixture),'compose',directory,'normal']
            docker = [sys.executable,str(fixture),'docker',directory,'normal']
            original = pilot.command
            def command(args, **kwargs):
                if 'down' in args:
                    os.kill(os.getpid(), signal.SIGUSR1)
                    os.kill(os.getpid(), signal.SIGUSR1)
                return original(args, **kwargs)
            with orbstack.sampled_budget(lambda:20*GIB,lambda free:None), \
                 orbstack.sampled_budget(lambda:20*GIB,lambda free:None), patch('pilot.command',side_effect=command):
                status = pilot.supervise_worker([sys.executable,str(fixture),'worker',directory,'success'],
                    compose,output,'inside-observability-pilot-fixture',docker=docker)
            self.assertNotEqual(status,0)
            outcome = json.loads((output/'worker-outcome.json').read_text())
            self.assertNotEqual(outcome['exit_code'],0)
            self.assertEqual(outcome['cleanup']['down'],'passed')
            self.assertEqual(outcome['cleanup']['residue'],'passed')

    def test_identity_replacement_after_diagnostics_refuses_down_on_replacement(self):
        import pilot
        identity = {'daemon_id':'owned'}
        replacement = {'daemon_id':'replacement'}
        calls = []
        checks = [0]
        def identify(*args, **kwargs):
            checks[0] += 1
            return identity if checks[0] <= 2 else replacement
        def raw(args, **kwargs):
            calls.append(args)
            return '[]'
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', identity), \
             patch('orbstack.identify',side_effect=identify), patch('pilot._raw_command',side_effect=raw):
            result = pilot.cleanup_project(['docker','compose'],Path(directory),'inside-observability-pilot-fixture')
        self.assertIn('failed',result['down'])
        self.assertIn('failed',result['residue'])
        self.assertFalse(any('down' in args for args in calls))

    def test_replacement_daemon_cleanup_preserves_owner_and_failed_worker_outcome(self):
        import pilot
        import sys
        fixture = Path(__file__).parent/'fixtures/process.py'
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output/'owner.json').write_text('{"owner":"preserve"}')
            (output/'foreign-resource').write_text('replacement daemon volume')
            compose = [sys.executable,str(fixture),'compose',directory,'normal']
            docker = [sys.executable,str(fixture),'docker',directory,'normal']
            with patch.object(pilot,'FROZEN_DOCKER_IDENTITY',{'daemon_id':'owned'}), \
                 patch('orbstack.identify',return_value={'daemon_id':'replacement'}):
                with self.assertRaisesRegex(RuntimeError,'cleanup failed'):
                    pilot.supervise_worker([sys.executable,str(fixture),'worker',directory,'success'],
                                           compose,output,'inside-observability-pilot-fixture',docker=docker)
            outcome = json.loads((output/'worker-outcome.json').read_text())
            self.assertNotEqual(outcome['exit_code'],0)
            self.assertTrue((output/'owner.json').exists())
            self.assertTrue((output/'foreign-resource').exists())
            self.assertFalse((output/'commands').exists())

    def test_stalled_real_producer_with_buffered_records_cannot_admit_vm(self):
        import subprocess
        import sys
        import os
        fixture = Path(__file__).parent/'fixtures/process.py'
        with tempfile.TemporaryDirectory() as directory:
            def command(args, **kwargs):
                return subprocess.run([sys.executable,str(fixture),'stale-probe',directory,args[-1]],
                                      capture_output=True,text=True,check=True,timeout=kwargs['timeout']).stdout
            with self.assertRaises(subprocess.TimeoutExpired):
                orbstack.fresh_sample(['compose'],command)
            pid = int((Path(directory)/'probe-pid').read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid,0)

    def test_mac_native_cpu_never_attributes_other_verification_children(self):
        import io
        import tarfile
        import pilot
        data = io.BytesIO()
        with tarfile.open(fileobj=data,mode='w:gz') as archive:
            for name in ('mcp-victoriametrics','mcp-victorialogs','mcp-victoriatraces'):
                entry = tarfile.TarInfo(name);entry.size=1
                archive.addfile(entry,io.BytesIO(b'x'))
        with tempfile.TemporaryDirectory() as directory, patch('pilot.platform.system',return_value='Darwin'), \
             patch('pilot.platform.machine',return_value='arm64'), \
             patch('pilot.downloaded_asset',return_value=data.getvalue()), \
             patch('pilot.stdio_probe',return_value={'known_fixture':'passed'}), \
             patch('pilot.resource.getrusage',side_effect=AssertionError('cumulative CPU unavailable')):
            result = pilot.native_probes('fixture',Path(directory))
        for probe in result.values():
            self.assertIsNone(probe['cpu_seconds'])
            self.assertIn('unavailable',probe['cpu_measurement'])

if __name__ == '__main__':
    unittest.main()
