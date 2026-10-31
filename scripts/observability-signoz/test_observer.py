"""Closed PostgreSQL protocol boundary, with no external provider or Docker."""
import unittest

import observer


class Counts(unittest.TestCase):
    def test_present_empty_is_distinct_from_missing_or_timed_out(self):
        self.assertEqual(observer.decode(b'{"applied_migrations":0,"migration_lock_rows":0}'),
                         {'available': True, 'counts': {'applied_migrations': 0, 'migration_lock_rows': 0}})
        for raw in (b'', b'null', b'{}', b'{"applied_migrations":true,"migration_lock_rows":0}',
                    b'{"applied_migrations":1,"migration_lock_rows":0,"email":"private"}',
                    b'{"applied_migrations":1,"applied_migrations":0,"migration_lock_rows":0}'):
            result = observer.decode(raw)
            self.assertFalse(result['available'])
            self.assertNotIn('counts', result)

    def test_only_owned_CID_can_select_literal_readonly_SQL(self):
        with self.assertRaises(ValueError): observer.command('foreign')
        command = observer.command('a' * 64)
        self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=1000 -c lock_timeout=1000', command)
        self.assertEqual(command[-1], "SELECT json_build_object('applied_migrations',(SELECT count(*) FROM public.migration),'migration_lock_rows',(SELECT count(*) FROM public.migration_lock))")
        self.assertNotIn('pg_stat_activity', command[-1])


if __name__ == '__main__': unittest.main()
