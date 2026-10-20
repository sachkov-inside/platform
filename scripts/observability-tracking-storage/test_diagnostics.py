"""Closed storage diagnostic seams; no native process, Docker or external I/O."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-sdk-storage'))
import oracle
from test_oracle import trace_fixture, raw_traces
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-tracking-storage'))
import tracking_oracle
from test_tracking_oracle import trace_rows, TRACE, ROOT


class OracleReasons(unittest.TestCase):
    def test_actual_full_raw_oracles_distinguish_decode_from_refusal_before_pending(self):
        empty = json.dumps({'status':'success','data':{'resultType':'vector','result':[]}})
        cases = (
            ('SDK storage metric contract failed', lambda raw: oracle.metrics(raw, release='a'*40), empty),
            ('SDK storage trace contract failed', lambda raw: oracle.traces(raw, trace_id='a'*32, root_id='b'*16, release='c'*40), raw_traces(trace_fixture()[:1])),
            ('Tracking storage metric contract failed', tracking_oracle.metrics, empty),
            ('Tracking storage trace contract failed', lambda raw: tracking_oracle.traces(raw, trace_id=TRACE, root_id=ROOT), '\n'.join(json.dumps(row) for row in trace_rows()[:1])),
        )
        for message, call, partial in cases:
            with self.subTest(owner=message):
                self.assertIsNone(call(partial))
                for raw, reason in (('{"private-sentinel"', 'response_decode'),
                                    (json.dumps({'private':'sdk-storage-private'}), 'oracle_refusal')):
                    with self.subTest(reason=reason), self.assertRaisesRegex(RuntimeError, '^'+message+'$') as error:
                        call(raw)
                    self.assertEqual(getattr(error.exception, 'reason', 'unknown'), reason)




class ClosedArtifact(unittest.TestCase):
    def test_legacy_absence_canonical_projection_and_private_metadata_refusal(self):
        import tempfile
        import diagnostics
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'storage-diagnostic.json'
            unknown = {'schema':1,'scope':'sdk','phase':'unknown','outcome':'unknown','reason':'unknown',
                       'attempts':0,'attempts_saturated':False}
            self.assertEqual(diagnostics.read(path, scope='sdk'), unknown)
            failed = {**unknown,'phase':'trace_validation','outcome':'failed','reason':'oracle_refusal','attempts':3}
            diagnostics.write(path, failed, scope='sdk')
            self.assertEqual(diagnostics.read(path, scope='sdk'), failed)
            for raw in (json.dumps({**failed,'private':'private-diagnostic-sentinel'}),
                        json.dumps(failed).replace('"schema": 1','"schema":1,"sch\\u0065ma":1'),
                        json.dumps({**failed,'attempts':True}), json.dumps({**failed,'attempts':-1}),
                        json.dumps({**failed,'attempts':1025}), json.dumps({**failed,'reason':'private-diagnostic-sentinel'}),
                        json.dumps({**failed,'attempts':1.0}), json.dumps({**failed,'attempts':float('nan')}),
                        json.dumps({**failed,'scope':'tracking'}), json.dumps({**failed,'phase':'capture'}),
                        json.dumps({**failed,'attempts_saturated':True}),
                        '{"unknown":{"x":1,"x":2}}', '['*40+'0'+']'*40, ' '*2049):
                with self.subTest(raw_shape=raw[:15]):
                    path.write_text(raw)
                    with self.assertRaisesRegex(ValueError, '^closed storage diagnostic contract failed$'):
                        diagnostics.read(path, scope='sdk')


class FirstFailure(unittest.TestCase):
    def test_first_failure_survives_cleanup_unknown_and_counter_mutation(self):
        import diagnostics
        value = diagnostics.Diagnostic('tracking')
        value.start('trace_validation')
        value.attempt()
        value.fail('oracle_refusal')
        original = value.snapshot()
        value.start('module_write')
        value.attempt()
        value.fail('unknown')
        value.observed({})
        self.assertEqual(value.snapshot(), original)
        self.assertEqual(original['attempts'], 1)
        self.assertEqual(original['reason'], 'oracle_refusal')

    def test_pending_passed_unknown_and_saturating_attempts_have_no_payload(self):
        import diagnostics
        value = diagnostics.Diagnostic('sdk')
        value.start('metric_validation')
        value.observed(None)
        self.assertEqual(value.snapshot()['outcome'], 'pending')
        value.observed({})
        self.assertEqual(value.snapshot()['outcome'], 'passed')
        for _ in range(1025): value.attempt()
        self.assertEqual(value.snapshot()['attempts'], 1024)
        self.assertIs(value.snapshot()['attempts_saturated'], True)
        value.fail('unknown')
        self.assertEqual(value.snapshot()['reason'], 'unknown')


class StoredBoundaries(unittest.TestCase):
    def test_query_failure_is_not_a_previous_pending_or_oracle_refusal(self):
        import diagnostics
        import sdk_storage
        import tracking_storage
        import urllib.error
        from unittest.mock import patch
        from test_oracle import vector as sdk_vector
        from test_tracking_oracle import vector as tracking_vector
        for scope, module in (('sdk',sdk_storage), ('tracking',tracking_storage)):
            value=diagnostics.Diagnostic(scope);result={'traces_state':'pending'}
            body=sdk_vector() if scope=='sdk' else tracking_vector()
            if scope=='sdk':
                for row in body['data']['result']: row['metric']['service.version']='c'*40
            metrics_owner=module if scope=='sdk' else module.sdk_storage
            observed={'trace_id':'a'*32,'root_id':'b'*16 if scope=='sdk' else ROOT}
            with self.subTest(scope=scope), patch.object(metrics_owner,'metric_response',return_value=json.dumps(body)), \
                    patch.object(module,'trace_response',side_effect=urllib.error.URLError('private-diagnostic-query-sentinel')):
                with self.assertRaises(urllib.error.URLError):
                    kwargs={'release':'c'*40} if scope=='sdk' else {}
                    module.stored_metrics_and_traces(token='private-token',compose=[],targets=None,observed=observed,
                                                     result=result,diagnostic=value,**kwargs)
                snapshot=value.snapshot()
                self.assertEqual((snapshot['phase'],snapshot['outcome'],snapshot['reason']),('trace_query','failed','transport'))
                self.assertEqual(snapshot['attempts'],1)
                self.assertEqual(result['traces_state'],'pending')
                self.assertNotIn('private-',json.dumps(snapshot))


class ProducerBoundaries(unittest.TestCase):
    def test_witness_refusal_and_actual_module_write_failure_remain_distinct(self):
        import tempfile
        import diagnostics
        import sdk_storage
        import tracking_storage
        from unittest.mock import patch
        from test_runtime import PrivateWireWitness
        from test_producer_protocol import wire
        for scope, module in (('sdk',sdk_storage),('tracking',tracking_storage)):
            owner=module if scope=='sdk' else module.producer_protocol
            capture='emitter' if scope=='sdk' else 'capture'
            for case in ('witness','write'):
                with self.subTest(scope=scope,case=case), tempfile.TemporaryDirectory() as directory:
                    output=Path(directory);value=diagnostics.Diagnostic(scope)
                    body=PrivateWireWitness().wire() if scope=='sdk' else wire()
                    if case=='witness': body={'private':'private-diagnostic-witness-sentinel'}
                    else: (output/'runtime-modules.json').mkdir()
                    with patch.object(owner,capture,return_value=body):
                        with self.assertRaises(ValueError if case=='witness' else OSError):
                            module.producer_observation(output,environment={},diagnostic=value)
                    state=value.snapshot()
                    self.assertEqual((state['phase'],state['reason']),('witness','witness_refusal') if case=='witness' else ('module_write','write_failure'))
                    self.assertNotIn('private-',json.dumps(state))


class ObservationOutcomes(unittest.TestCase):
    def test_actual_oracle_decode_refusal_pending_deadline_success_and_unknown_are_distinct(self):
        import diagnostics
        import sdk_storage
        import tracking_storage
        from unittest.mock import patch
        from test_oracle import vector as sdk_vector
        from test_tracking_oracle import vector as tracking_vector
        for scope,module in (('sdk',sdk_storage),('tracking',tracking_storage)):
            body=sdk_vector() if scope=='sdk' else tracking_vector()
            if scope=='sdk':
                for row in body['data']['result']: row['metric']['service.version']='c'*40
            rows=trace_fixture() if scope=='sdk' else trace_rows()
            owner=module if scope=='sdk' else module.sdk_storage
            for case in ('decode','refusal','deadline','success','unknown'):
                diagnostic=diagnostics.Diagnostic(scope);result={}
                trace='\n'.join(json.dumps(row) for row in (rows[:1] if case=='deadline' else rows))
                if case=='decode': trace='{"private-diagnostic-sentinel"'
                if case=='refusal':
                    invalid={**rows[0],'flags':'1'}
                    trace=json.dumps(invalid)
                error=RuntimeError('private-diagnostic-unexpected-sentinel')
                with self.subTest(scope=scope,case=case), patch.object(owner,'metric_response',return_value=json.dumps(body)), \
                        patch.object(module,'trace_response',side_effect=error if case=='unknown' else None,return_value=trace), \
                        patch.object(module.time,'monotonic',side_effect=[0,0,0,0,60]), patch.object(module.time,'sleep'):
                    kwargs={'release':'c'*40} if scope=='sdk' else {}
                    def observe():
                        return module.stored_metrics_and_traces(token='private-token',compose=[],targets=None,
                            observed={'trace_id':'a'*32,'root_id':'b'*16 if scope=='sdk' else ROOT},
                            result=result,diagnostic=diagnostic,**kwargs)
                    if case=='success':
                        metrics,traces,attempts=observe()
                        self.assertIsNotNone(metrics);self.assertIsNotNone(traces);self.assertEqual(attempts,1)
                        self.assertEqual(diagnostic.snapshot()['outcome'],'passed')
                    else:
                        with self.assertRaises(TimeoutError if case=='deadline' else RuntimeError) as caught: observe()
                        if case=='unknown': self.assertIs(caught.exception,error)
                        expected=('visibility','deadline') if case=='deadline' else ('trace_query','unknown') if case=='unknown' else ('trace_validation','response_decode' if case=='decode' else 'oracle_refusal')
                        state=diagnostic.snapshot()
                        self.assertEqual((state['phase'],state['reason']),expected)
                        self.assertEqual(state['outcome'],'failed');self.assertEqual(state['attempts'],1)
                        if case=='deadline': self.assertEqual(result['traces_state'],'pending')
                    self.assertNotIn('private-',json.dumps(diagnostic.snapshot()))


class PublicCollection(unittest.TestCase):
    def test_invalid_present_metadata_refuses_before_destination_and_legacy_absence_is_explicit_unknown(self):
        import tempfile
        import diagnostics
        import sdk_storage
        import tracking_storage
        for scope,module in (('sdk',sdk_storage),('tracking',tracking_storage)):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);output=root/'private';metadata=root/'metadata';output.mkdir();metadata.mkdir()
                destination=root/'legacy'
                module.collect(output,metadata,destination)
                self.assertEqual(diagnostics.read(destination/diagnostics.NAME,scope=scope),diagnostics.unknown(scope))
                private='private-diagnostic-collector-sentinel'
                (output/'stderr.txt').write_text(private)
                valid={**diagnostics.unknown(scope),'phase':'trace_validation','outcome':'failed','reason':'oracle_refusal','attempts':4}
                raw=json.dumps(valid,indent=4)+'\n\n'
                (output/diagnostics.NAME).write_text(raw)
                module.collect(output,metadata,root/'canonical')
                canonical=(root/'canonical'/diagnostics.NAME).read_text()
                self.assertLess(len(canonical),len(raw));self.assertEqual(json.loads(canonical),valid)
                self.assertNotIn(private,canonical)
                poison=[json.dumps({**valid,'private':private}),json.dumps(valid).replace('"schema": 1','"schema":1,"sch\\u0065ma":1'),
                        json.dumps({**valid,'attempts':float('nan')}),' '*2049,json.dumps({**valid,'scope':'tracking' if scope=='sdk' else 'sdk'})]
                for index,body in enumerate(poison):
                    (output/diagnostics.NAME).write_text(body)
                    target=root/('refused'+str(index))
                    with self.assertRaisesRegex(ValueError,'^closed storage diagnostic contract failed$'):
                        module.collect(output,metadata,target)
                    self.assertFalse(target.exists())

    def test_symlinks_invalid_writer_and_diagnostic_write_failure_do_not_change_primary_failure(self):
        import tempfile
        import diagnostics
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/diagnostics.NAME
            value=diagnostics.unknown('sdk')
            with self.assertRaises(ValueError): diagnostics.write(path,{**value,'unexpected':'private'},scope='sdk')
            self.assertFalse(path.exists())
            path.symlink_to(root/'missing')
            with self.assertRaises(ValueError): diagnostics.read(path,scope='sdk')
            path.unlink();path.mkdir()
            diagnostic=diagnostics.Diagnostic('sdk');diagnostic.start('trace_query');diagnostic.fail('transport')
            first=RuntimeError('primary-private-sentinel')
            def active_failure():
                try: raise first
                finally: diagnostic.persist(path)
            with self.assertRaises(RuntimeError) as caught: active_failure()
            self.assertIs(caught.exception,first)
            self.assertEqual(diagnostic.snapshot()['reason'],'transport')


class TerminalFailure(unittest.TestCase):
    def test_finalization_after_completed_business_does_not_mask_failure_with_a_schema_error(self):
        import diagnostics
        for reason in ('unknown','interrupted'):
            value=diagnostics.Diagnostic('sdk');value.start('complete');value.fail(reason)
            self.assertEqual(value.snapshot()['phase'],'complete')
            self.assertEqual(value.snapshot()['reason'],reason)
            self.assertEqual(value.snapshot()['outcome'],'interrupted' if reason=='interrupted' else 'failed')


class ProjectionBudget(unittest.TestCase):
    def test_tracking_public_map_budget_refuses_before_write_with_a_closed_projection_reason(self):
        import tempfile
        import diagnostics
        import tracking_storage
        from unittest.mock import patch
        from test_producer_protocol import wire
        value=wire(4096)
        for index,row in enumerate(entry for group in value['runtime_module_groups'] for entry in group):
            if row['path'] not in tracking_storage.producer_protocol.REQUIRED:
                prefix='node_modules/'+str(index)+'-'
                row['path']=prefix+'x'*(512-len(prefix))
        # This is the public projection defense in isolation. The actual raw capture cap is not bypassed in a native run.
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);diagnostic=diagnostics.Diagnostic('tracking')
            with patch.object(tracking_storage.producer_protocol,'capture',return_value=value):
                with self.assertRaises(ValueError):
                    tracking_storage.producer_observation(output,environment={},diagnostic=diagnostic)
            self.assertFalse((output/'runtime-modules.json').exists())
            self.assertEqual((diagnostic.snapshot()['phase'],diagnostic.snapshot()['reason']),('module_projection','module_projection'))


if __name__ == '__main__': unittest.main()
