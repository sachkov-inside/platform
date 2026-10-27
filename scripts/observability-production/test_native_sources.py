"""Host transport is finite and cannot bypass source owner/SQL/loopback admission."""
import json
import os
import socket
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch
import unittest
import native_sources
import source_cache


class NativeSources(unittest.TestCase):
    def test_only_one_verified_database_owner_can_receive_the_fixed_ordinary_role_read(self):
        seen = []; identity = 'a' * 64
        def execute(args, **options):
            seen.append((args, options))
            if 'ps' in args: return (identity + '\n').encode()
            if 'inspect' in args: return json.dumps({'id': identity, 'project': 'owned', 'service': 'postgres', 'running': True}).encode()
            return b'closed-native-packet\n'
        value = native_sources.postgres_read('owned', source_cache.postgres_sql(), execute=execute)
        self.assertEqual(value, b'closed-native-packet\n')
        commands = [args for args, _ in seen]
        actual = next(args for args in commands if 'exec' in args)
        self.assertEqual(actual[actual.index('psql'):], ['psql', '-X', '-qAt', '-w', '-U', 'postgres_source_reader', '-d', 'inside', '-v', 'ON_ERROR_STOP=1'])
        self.assertTrue(all(args[:3] == ['docker', '--host', 'unix:///var/run/docker.sock'] for args in commands))
        self.assertEqual(sum('inspect' in args for args in commands), 2)
        self.assertTrue(all(0 < options['timeout'] <= 3 for _, options in seen))

    def test_foreign_or_duplicate_owner_and_arbitrary_sql_are_refused_before_exec(self):
        for fault in ('project', 'duplicate', 'foreign', 'stopped', 'sql'):
            with self.subTest(fault=fault):
                seen = []; identity = 'a' * 64
                def execute(args, **options):
                    seen.append(args)
                    if 'ps' in args: return ((identity + '\n') * (2 if fault == 'duplicate' else 1)).encode()
                    return json.dumps({'id': identity, 'project': 'other' if fault == 'foreign' else 'owned', 'service': 'postgres', 'running': fault != 'stopped'}).encode()
                with self.assertRaises(ValueError):
                    native_sources.postgres_read('../private' if fault == 'project' else 'owned',
                        'SELECT private' if fault == 'sql' else source_cache.postgres_sql(), execute=execute)
                self.assertFalse(any('exec' in args for args in seen))

    def test_command_stream_limits_kill_owned_children_before_returning(self):
        for stream in ('stdout', 'stderr', 'timeout'):
            with self.subTest(stream=stream), tempfile.TemporaryDirectory() as directory:
                pidfile = Path(directory) / 'pid'
                code = ("import os,sys,time; from pathlib import Path; "
                        "Path(sys.argv[1]).write_text(str(os.getpid())); "
                        "os.write(2 if sys.argv[2]=='stderr' else 1,b'x'*65536) "
                        "if sys.argv[2]!='timeout' else None; time.sleep(10)")
                started = time.monotonic()
                with self.assertRaises(TimeoutError if stream == 'timeout' else ValueError) as failure:
                    native_sources._execute([sys.executable, '-c', code, str(pidfile), stream], timeout=.5)
                self.assertNotIn('xxxx', str(failure.exception))
                self.assertLess(time.monotonic() - started, 2)
                identity = int(pidfile.read_text())
                with self.assertRaises(ProcessLookupError): os.kill(identity, 0)

    def test_command_deadline_cleans_descendant_and_success_preserves_bounded_response(self):
        with tempfile.TemporaryDirectory() as directory:
            endpoint = str(Path(directory) / 'owned.sock')
            code = """import os,socket,sys,time
if os.fork() == 0:
    server=socket.socket(socket.AF_UNIX); server.bind(sys.argv[1]); server.listen()
    os.write(1,b'ready'); time.sleep(10)
else:
    time.sleep(10)
"""
            with self.assertRaises(TimeoutError):
                native_sources._execute([sys.executable, '-c', code, endpoint], timeout=.5)
            self.assertTrue(Path(endpoint).exists())
            with socket.socket(socket.AF_UNIX) as probe:
                with self.assertRaises(ConnectionRefusedError): probe.connect(endpoint)
        response = native_sources._execute([sys.executable, '-c',
            "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())"], timeout=1, payload=b'fixed-response')
        self.assertEqual(response, b'fixed-response')

    def test_owned_failure_observer_sees_capped_merged_pipes_only_after_child_cleanup(self):
        observed = []
        code = "import os,sys; os.write(2,b'permission denied private-sentinel'); sys.exit(1)"
        with self.assertRaises(RuntimeError):
            native_sources._execute([sys.executable, '-c', code], timeout=1,
                observe_failure=lambda raw, status: observed.append((raw, status)))
        self.assertEqual(observed, [(b'permission denied private-sentinel', 1)])
        def broken(raw, status): raise ValueError('private callback failure')
        with self.assertRaisesRegex(RuntimeError, '^native_source_command_exit$'):
            native_sources._execute([sys.executable, '-c', code], timeout=1, observe_failure=broken)
        for mode in ('oversize', 'hang'):
            observed=[]
            code="import os,time; os.write(2,b'x'*65536) if '"+mode+"'=='oversize' else None; time.sleep(10)"
            with self.assertRaises(ValueError if mode=='oversize' else TimeoutError):
                native_sources._execute([sys.executable,'-c',code],timeout=.5,
                    observe_failure=lambda raw,status:observed.append((len(raw),status)))
            self.assertEqual(observed,[(4096 if mode=='oversize' else 0,-9)])

    def test_caddy_only_has_two_read_paths_and_no_user_supplied_url_or_admin_write(self):
        for path in ('http://private.invalid', '/config', '/stop', '/load', '/metrics?person=private'):
            with self.subTest(path=path), self.assertRaises(ValueError): native_sources.caddy_get(path)
        with patch.object(native_sources.sys, 'argv', ['native_sources.py', 'sample']), \
             patch.object(native_sources.sys, 'platform', 'linux'), patch.object(native_sources.os, 'geteuid', return_value=0), \
             patch.dict(native_sources.os.environ, {'INSIDE_PRODUCTION_SOURCES_ENABLED': 'false'}), \
             patch.object(native_sources, 'sample') as read:
            with self.assertRaises(ValueError): native_sources.main()
            read.assert_not_called()


if __name__ == '__main__': unittest.main()
