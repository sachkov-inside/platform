"""Private Docker SQL transport never accepts an ambiguous or foreign database owner."""
import json
import subprocess
import unittest
from unittest.mock import patch
import sql_transport


class Transport(unittest.TestCase):
    def test_verified_postgres_identity_receives_fixed_role_database_and_stdin_only(self):
        calls=[]
        def run(args,**kwargs):
            calls.append((args,kwargs))
            output='a'*64 if args[3]=='ps' else json.dumps({'id':'a'*64,'project':'inside-production-database','service':'postgres','running':True}) if args[3]=='inspect' else 'result'
            return subprocess.CompletedProcess(args,0,stdout=output,stderr='')
        with patch.dict(sql_transport.os.environ,{'INSIDE_UMAMI_SQL_TRANSPORT':'docker','INSIDE_UMAMI_DATABASE_PROJECT':'inside-production-database'},clear=True):
            self.assertEqual(sql_transport.query('SELECT 1',timeout=5,run=run),'result')
        self.assertEqual(calls[-1][1]['input'],'SELECT 1')
        self.assertEqual(calls[-1][0][-6:],['-U','umami','-d','umami','-v','ON_ERROR_STOP=1'])
        self.assertIn('umami',calls[-1][0]);self.assertNotIn('SELECT 1',calls[-1][0])

    def test_foreign_stopped_multiple_or_missing_database_refuses_before_exec(self):
        for case in ('foreign','stopped','multiple','missing'):
            calls=[]
            def run(args,**kwargs):
                calls.append(args)
                if args[3]=='ps':output='' if case=='missing' else ('a'*64+'\n'+'b'*64 if case=='multiple' else 'a'*64)
                else:output=json.dumps({'id':'a'*64,'project':'foreign' if case=='foreign' else 'inside-production-database','service':'postgres','running':case!='stopped'})
                return subprocess.CompletedProcess(args,0,stdout=output,stderr='')
            with patch.dict(sql_transport.os.environ,{'INSIDE_UMAMI_SQL_TRANSPORT':'docker','INSIDE_UMAMI_DATABASE_PROJECT':'inside-production-database'},clear=True):
                with self.assertRaises(ValueError):sql_transport.query('SELECT 1',timeout=5,run=run)
            self.assertFalse(any('exec' in args for args in calls))
