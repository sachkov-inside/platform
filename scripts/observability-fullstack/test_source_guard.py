"""A source-role negative needs the dedicated PostgreSQL guard SQLSTATE."""
import unittest
import source_guard


class Guard(unittest.TestCase):
    def test_only_owning_refusal_code_can_pass_not_success_or_unrelated_failure(self):
        bootstrap="SET statement_timeout='2s';\nBEGIN;\nDO $$ BEGIN RAISE EXCEPTION 'fixed' USING ERRCODE='P1567'; END $$;\nALTER ROLE postgres_source_reader SET default_transaction_read_only='on';\nCOMMIT;\n"
        scripts=[]
        def own(compose,script,**kwargs):scripts.append(script);return 'P1567\n'
        source_guard.refusal([],own,bootstrap)
        self.assertIn('\\echo :SQLSTATE',scripts[0]);self.assertNotIn('ALTER ROLE',scripts[0])
        for code in ('00000','42P01','25P02','connection failed',''):
            with self.subTest(code=code),self.assertRaises(ValueError):source_guard.refusal([],lambda *args,**kwargs:code,bootstrap)
        primary=RuntimeError('unrelated private transport failure')
        def broken(*args,**kwargs):raise primary
        try:source_guard.refusal([],broken,bootstrap)
        except RuntimeError as caught:self.assertIs(caught,primary)
        else:self.fail('unrelated failure swallowed')
