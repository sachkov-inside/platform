"""Membership refusal proves the owning SQL guard, never a transport failure."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import native_maintenance
import runtime


class MembershipRefusal(unittest.TestCase):
    def test_unrelated_command_or_connection_failure_cannot_satisfy_membership_proof(self):
        for error in (RuntimeError('connection lost'), runtime.FixtureCommandFailed(returncode=1),
                      runtime.FixtureCommandFailed({'phase': 'membership_guard', 'error': 'other'}, returncode=3)):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)):
                with native_maintenance.expected_membership_refusal():
                    raise error

    def test_transport_exposes_only_exact_sqlstate_from_the_expected_psql_phase(self):
        args = ['exec', '-T', 'db', 'psql', '-X', '-qAt', '-U', 'pilot_bootstrap', '-d', 'postgres',
                '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']
        expected = {'phase': 'membership_guard', 'error': 'existing_role_authority'}
        for code, stderr, phase, wanted in (
                (3, 'ERROR:  P1566\n', 'membership_guard', expected),
                (1, 'ERROR:  P1566\n', 'membership_guard', None),
                (3, 'ERROR:  P0001\n', 'membership_guard', None),
                (3, 'ERROR:  P1566\nsentinel-private', 'membership_guard', None),
                (3, 'ERROR:  P1566\n', None, None)):
            with self.subTest(code=code, stderr=stderr, phase=phase), \
                    patch.object(runtime.pilot, 'assert_docker_identity'), \
                    patch.object(runtime.pilot, 'docker_args', side_effect=lambda value: value), \
                    patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=code, stderr=stderr, stdout='private-token')):
                with self.assertRaises(runtime.FixtureCommandFailed) as failed:
                    runtime.invoke(['owned-compose'], args, fixture_phase=phase)
                self.assertEqual(failed.exception.diagnostic, wanted)
                self.assertNotIn('private', str(failed.exception))
                if wanted is not None:
                    with native_maintenance.expected_membership_refusal():
                        raise failed.exception


    def test_failed_progress_write_preserves_original_sql_failure_and_traceback(self):
        from pathlib import Path
        primary=runtime.FixtureCommandFailed(returncode=3)
        def sql(*args,**kwargs):raise primary
        def progress(value):
            if value['outcome']=='failed':raise OSError('closed write failed')
        try:native_maintenance.exercise(sql,lambda:None,Path('/unused'),restore=lambda:None,progress=progress)
        except BaseException as error:
            self.assertIs(error,primary)
            frames=[];tb=error.__traceback__
            while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
            self.assertIn('sql',frames)
        else:self.fail('SQL failure became successful maintenance')
