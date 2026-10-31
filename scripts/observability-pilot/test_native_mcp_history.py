"""Real owned stdio children model finite query windows; no vendor executable or network."""
import copy
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import pilot
import ci
import notification_privacy
from test_notifications_privacy import metric_rows


def native_archive(age, failure=None):
    traces={}
    for transport,trace_id in notification_privacy.TRACE_IDS.items():
        spans=[{'spanID':f'{index+1:016x}',
                'operationName':operation+' '+('inside.events.materials.v1' if index<6 else '_OTHER'),
                'references':[{'spanID':'d'*16},{'spanID':'f'*16}]}
               for index,(operation,_) in enumerate((*notification_privacy.CASES,('_OTHER','_OTHER')))]
        traces[trace_id]={'data':[{'traceID':trace_id,'spans':spans,
                                 'processes':{'p1':{'serviceName':'platform-notifications-worker'}}}]}
    settings={'age':age,'failure':failure,'notifications':{'status':'success','data':{'resultType':'vector','result':metric_rows()}},'traces':traces}
    source=Path(__file__).with_name('fixtures').joinpath('mcp_finite.py').read_text()
    script=('#!'+sys.executable+'\nSETTINGS='+repr(settings)+'\n'+source).encode()
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w:gz') as archive:
        for name in ('mcp-victoriametrics','mcp-victorialogs','mcp-victoriatraces'):
            entry=tarfile.TarInfo(name);entry.size=len(script);archive.addfile(entry,io.BytesIO(script))
    return data.getvalue()


class NativeHistory(unittest.TestCase):
    def assert_children_reaped(self,directory):
        states=list(Path(directory).glob('fixture-*.json'))
        self.assertTrue(states)
        for state in states:
            pid=json.loads(state.read_text())['pid']
            with self.assertRaises(ProcessLookupError):os.kill(pid,0)

    def test_actual_native_plan_keeps_finite_history_through_the_existing_worker_window(self):
        calls=[];stdio=pilot.stdio_probe
        def call(executable,environment,tool,arguments,marker,**kwargs):
            calls.append((tool,arguments,kwargs.get('additional',())))
            return stdio(executable,environment,tool,arguments,marker,**kwargs)
        with tempfile.TemporaryDirectory() as directory,patch('pilot.downloaded_asset',return_value=native_archive(499)),patch('pilot.stdio_probe',side_effect=call):
            try:
                proof=pilot.native_probes('PRIVATE_FIXTURE_TOKEN',Path(directory))
                self.assertEqual(set(proof),{'mcp-victoriametrics','mcp-victorialogs','mcp-victoriatraces'})
                self.assertEqual(calls[0][1],{'query':'last_over_time(pilot_requests[10m])','nocache':True})
                self.assertIs(type(calls[0][1]['nocache']),bool)
                self.assertEqual(calls[0][2][0][1],{'query':'last_over_time({__name__=~"inside[.]notification[.].+"}[10m])','nocache':True})
                self.assertEqual(calls[1][1],{'query':'_time:10m','start':'0','limit':10})
                self.assertEqual(calls[2][1],{'trace_id':'00000000000000000000000000000001'})
                self.assertTrue(all(record['known_fixture']=='passed' for record in proof.values()))
                progress=pilot.read_native_mcp_progress((Path(directory)/'native-mcp-progress.json').read_text())
                self.assertEqual(progress,{'outcome':'passed','probes':[
                    {'route':route,'phase':'complete','outcome':'passed'} for route in ('metrics','logs','traces')]})
                metadata=Path(directory)/'metadata';metadata.mkdir()
                (metadata/'source.json').write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,'scope':ci.core_timing.METADATA_SCOPE}))
                ci.collect(Path(directory),metadata,Path(directory)/'public')
                self.assertEqual(json.loads((Path(directory)/'public/native-mcp-progress.json').read_text()),progress)
            finally:self.assert_children_reaped(directory)


    def test_missing_history_is_failed_with_closed_per_tool_progress_and_reaped_child(self):
        with tempfile.TemporaryDirectory() as directory,patch('pilot.downloaded_asset',return_value=native_archive(600)):
            try:
                with self.assertRaisesRegex(RuntimeError,'native MCP failed to return known fixture'):
                    pilot.native_probes('PRIVATE_FIXTURE_TOKEN',Path(directory))
                progress=json.loads((Path(directory)/'native-mcp-progress.json').read_text())
                self.assertEqual(progress,{'outcome':'failed','probes':[
                    {'route':'metrics','phase':'primary','outcome':'fixture_absent'}]})
                self.assertNotIn('PRIVATE',json.dumps(progress))
            finally:self.assert_children_reaped(directory)


    def test_collection_rejects_progress_with_unknown_or_private_fields(self):
        invalid={'outcome':'incomplete','probes':[{'route':'metrics','phase':'primary',
                                                 'outcome':'running','url':'PRIVATE_VALUE'}]}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'output';output.mkdir()
            metadata=Path(directory)/'metadata';metadata.mkdir()
            (metadata/'source.json').write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,'scope':ci.core_timing.METADATA_SCOPE}))
            (output/'native-mcp-progress.json').write_text(json.dumps(invalid))
            with self.assertRaises(RuntimeError):ci.collect(output,metadata,Path(directory)/'public')


    def test_native_tool_result_failures_are_distinct_and_private_payloads_are_not_projected(self):
        for kind in ('tool_error','invalid_result'):
            failure={'route':'metrics','phase':'primary','kind':kind}
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory,patch('pilot.downloaded_asset',return_value=native_archive(499,failure)):
                try:
                    with self.assertRaisesRegex(RuntimeError,'native MCP failed to return known fixture'):
                        pilot.native_probes('PRIVATE_FIXTURE_TOKEN',Path(directory))
                    raw=(Path(directory)/'native-mcp-progress.json').read_text()
                    progress=pilot.read_native_mcp_progress(raw)
                    self.assertEqual(progress['outcome'],'failed')
                    self.assertEqual(progress['probes'],[{'route':'metrics','phase':'primary','outcome':kind}])
                    self.assertNotIn('PRIVATE',raw)
                finally:self.assert_children_reaped(directory)

    def test_later_validation_failure_retains_prior_successes_without_passing_or_leaking_payload(self):
        failure={'route':'traces','phase':'additional_2','kind':'validation'}
        with tempfile.TemporaryDirectory() as directory,patch('pilot.downloaded_asset',return_value=native_archive(499,failure)):
            try:
                with self.assertRaisesRegex(RuntimeError,'notification native MCP trace proof failed'):
                    pilot.native_probes('PRIVATE_FIXTURE_TOKEN',Path(directory))
                raw=(Path(directory)/'native-mcp-progress.json').read_text()
                progress=pilot.read_native_mcp_progress(raw)
                self.assertEqual(progress,{'outcome':'failed','probes':[
                    {'route':'metrics','phase':'complete','outcome':'passed'},
                    {'route':'logs','phase':'complete','outcome':'passed'},
                    {'route':'traces','phase':'additional_2','outcome':'failed'}]})
                self.assertNotIn('PRIVATE',raw)
            finally:self.assert_children_reaped(directory)

    def test_download_failure_and_interruption_preserve_identity_and_closed_progress(self):
        for error in (OSError('PRIVATE_VALUE'),KeyboardInterrupt(),SystemExit(7)):
            with self.subTest(error_type=type(error).__name__),tempfile.TemporaryDirectory() as directory,patch('pilot.downloaded_asset',side_effect=error):
                with self.assertRaises(type(error)) as caught:pilot.native_probes('PRIVATE_FIXTURE_TOKEN',Path(directory))
                self.assertIs(caught.exception,error)
                raw=(Path(directory)/'native-mcp-progress.json').read_text()
                self.assertEqual(pilot.read_native_mcp_progress(raw),{'outcome':'failed','probes':[
                    {'route':'metrics','phase':'download','outcome':'failed'}]})
                self.assertNotIn('PRIVATE',raw)

    def test_projection_denies_unknown_keys_values_duplicates_and_false_completion(self):
        base={'outcome':'incomplete','probes':[{'route':'metrics','phase':'primary','outcome':'running'}]}
        values=[]
        for key,value in (('route','PRIVATE_VALUE'),('phase','unknown'),('outcome','unknown'),
                          ('url','PRIVATE_VALUE'),('tool','query'),('phase',True)):
            body=copy.deepcopy(base);body['probes'][0][key]=value;values.append(json.dumps(body))
        for changed in ({**base,'private':'PRIVATE_VALUE'},{**base,'outcome':'passed'},
                        {**base,'probes':base['probes']*4},{'outcome':'passed','probes':[]}):values.append(json.dumps(changed))
        values.extend(['{"outcome":"PRIVATE_VALUE",'+json.dumps(base)[1:],
                       json.dumps(base).replace('"route": "metrics"','"route":"PRIVATE_VALUE","route":"metrics"'),
                       'x'*4097,'{"private":'+'['*1200+'0'+']'*1200+'}'])
        for raw in values:
            with self.subTest(length=len(raw)),self.assertRaisesRegex(RuntimeError,'^native MCP progress contract failed; raw values withheld$'):
                pilot.read_native_mcp_progress(raw)
        self.assertEqual(pilot.native_mcp_progress([]),{'outcome':'incomplete','probes':[]})
        self.assertEqual(pilot.native_mcp_progress(base['probes']),base)


if __name__=='__main__':unittest.main()
