"""PG main finalizes only source-bound native completion after successful cleanup."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import postgres_source
import record

NATIVE=['PG native role/reset/restart/freshness acceptance','pinned end-to-end processing/insertion privacy completion proof']
PENDING=['resource/cost acceptance','production and seven days']
PG_CLEANUP={'outcome':'passed','containers':9,'volumes':5,'networks':2}
CORE_CLEANUP={'diagnostics':'passed','down':'passed','residue':'passed',
    'source_freshness':{'outcome':'passed','containers':8,'volumes':4,'networks':2}}


class CompletionEvidence(unittest.TestCase):
    def complete(self):
        value=record.report('a'*40);value.update(state='passed',phase='complete',duration_seconds=119.488954349)
        value['cases']=[{'phase':phase,'freshness':'fresh','continuity':continuity,'count_complete':count,'points':7,'age_seconds':2}
            for phase,continuity,count in (('baseline','same_epoch',True),('connections','same_epoch',True),
                ('locks','same_epoch',True),('deadlocks','same_epoch',True),('reset','statistics_reset',False),
                ('restart','server_restart',False),('stale','same_epoch',False),('privacy','same_epoch',True))]
        return value

    def execute(self,output,fault=None):
        evidence={'source':'a'*40,'scope':record.SCOPE,'status':'failed','worker_exit_code':0,
            'missing':[*NATIVE,*PENDING,'separate unchanged limitation'],'cleanup':copy.deepcopy(CORE_CLEANUP)}
        value=self.complete();pg_cleanup=PG_CLEANUP.copy()
        if fault=='source_failed':value.update(state='failed',phase='privacy',reason='query_timeout')
        if fault=='source_incomplete':value.update(state='incomplete',phase='privacy')
        if fault=='partial':value['cases'].pop()
        if fault=='record_source':value['source']='b'*40
        if fault=='evidence_source':evidence['source']='b'*40
        if fault=='scope':evidence['scope']='whole pilot'
        if fault=='worker_code':evidence['worker_exit_code']=1
        if fault=='worker_bool':evidence['worker_exit_code']=False
        if fault in ('diagnostics','down','residue'):evidence['cleanup'][fault]='failed'
        if fault=='freshness_cleanup':evidence['cleanup']['source_freshness']['outcome']='failed'
        if fault=='pg_cleanup':pg_cleanup['containers']=8
        if fault=='limits':evidence['missing'].remove(PENDING[0])
        if fault=='duplicate_limit':evidence['missing'].append(NATIVE[0])
        def runtime(path,**options):
            self.assertEqual(options['scope'],record.SCOPE)
            self.assertEqual(options['missing'],[*NATIVE,*PENDING])
            path.mkdir(mode=0o700)
            (path/'owner.json').write_text(json.dumps({'project':'inside-observability-pilot-'+'a'*12}))
            (path/'evidence.json').write_text(json.dumps(evidence))
            if fault!='missing_cleanup':(path/'cleanup.json').write_text(json.dumps(evidence['cleanup']))
            record.write(path,self.complete())
            (path/record.NAME).write_text(json.dumps(value))
            if fault=='worker_failure':raise RuntimeError('controlled failed worker')
            return copy.deepcopy(evidence)
        argv=['postgres_source.py','run','--output',str(output)]
        with patch.object(postgres_source.sys,'platform','linux'),patch.object(postgres_source.sys,'argv',argv), \
                patch.object(postgres_source.pilot,'run',side_effect=runtime),patch.object(postgres_source.pilot,'restore_daemon'), \
                patch.object(postgres_source.ownership,'verify_pg_absence',return_value=pg_cleanup), \
                patch.object(postgres_source.ci,'read_command',return_value='a'*40):
            return postgres_source.main()

    def test_actual_run_composition_marks_only_completed_pg_scope_after_typed_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private'
            self.assertEqual(self.execute(output),0)
            actual=json.loads((output/'evidence.json').read_text())
            self.assertEqual(actual['status'],'passed: isolated PostgreSQL source/privacy; resource/production acceptance pending')
            self.assertEqual(actual['missing'],[*PENDING,'separate unchanged limitation'])
            self.assertEqual(actual['scope'],record.SCOPE)
            self.assertEqual(actual['source'],'a'*40)
            self.assertEqual(actual['cleanup'],CORE_CLEANUP)
            self.assertEqual(json.loads((output/'postgres-source-cleanup.json').read_text()),PG_CLEANUP)

    def test_failed_incomplete_foreign_partial_or_unclean_results_cannot_promote_outer_evidence(self):
        for fault in ('source_failed','source_incomplete','partial','record_source','evidence_source','scope',
                'worker_code','worker_bool','diagnostics','down','residue','freshness_cleanup','pg_cleanup',
                'limits','duplicate_limit','missing_cleanup','worker_failure'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve()/'private'
                with self.assertRaises((ValueError,RuntimeError)):self.execute(output,fault)
                actual=json.loads((output/'evidence.json').read_text())
                self.assertEqual(actual['status'],'failed')
                self.assertIn(NATIVE[0],actual['missing']);self.assertIn(NATIVE[1],actual['missing'])
