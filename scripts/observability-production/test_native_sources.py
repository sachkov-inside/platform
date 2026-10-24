"""Host transport is finite and cannot bypass source owner/SQL/loopback admission."""
import json
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
