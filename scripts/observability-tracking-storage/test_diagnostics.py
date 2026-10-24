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
                                    (json.dumps({'private':'sdk-storage-private'}), 'trace_decode' if message in ('SDK storage trace contract failed','Tracking storage trace contract failed') else 'oracle_refusal')):
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

        temporal={'row_role':'provider','parent_role':'delivery','comparison':'end','gap_band':'lt_1ms'}
        valid={**diagnostics.unknown('tracking'),'phase':'trace_validation','outcome':'failed',
            'reason':'trace_gate_17','attempts':1,'temporal':temporal}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/diagnostics.NAME
            diagnostics.write(path,valid,scope='tracking')
            self.assertEqual(diagnostics.read(path,scope='tracking'),valid)
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            projected=diagnostics.validate(valid,scope='tracking');projected['temporal']['row_role']='postgresql'
            self.assertEqual(valid['temporal']['row_role'],'provider')
            for key,values in (('row_role',('root','private-canary',None,True,[],{})),
                               ('parent_role',('private-canary',1,[])),
                               ('comparison',('unknown','private-canary',False)),
                               ('gap_band',('exact_999999',999999,None))):
                for bad in values:
                    path.write_text(json.dumps({**valid,'temporal':{**temporal,key:bad}}))
                    with self.assertRaisesRegex(ValueError,'^closed storage diagnostic contract failed$'):
                        diagnostics.read(path,scope='tracking')
            poison=[{**valid,'temporal':None},{**valid,'temporal':list(temporal)},
                    {**valid,'temporal':{**temporal,'private':'private-canary'}},
                    {**valid,'temporal':{key:value for key,value in temporal.items() if key!='comparison'}},
                    {**valid,'phase':'trace_query'},{**valid,'reason':'oracle_refusal'},
                    {**valid,'outcome':'pending','reason':'none'},{**valid,'outcome':'passed','reason':'none'},
                    {**valid,'outcome':'interrupted','reason':'interrupted'},
                    {**valid,'scope':'sdk','reason':'trace_gate_12'}]
            for value in poison:
                with self.assertRaises(ValueError):diagnostics.write(path,value,scope=value['scope'])
            raw=json.dumps(valid)
            for body in (raw.replace('"row_role": "provider"','"row_role":"provider","row_ro\\u006ce":"provider"'),
                         raw.replace('"temporal":','"temp\\u006fral":{},"temporal":')):
                path.write_text(body)
                with self.assertRaises(ValueError):diagnostics.read(path,scope='tracking')
            self.assertEqual(set(diagnostics.unknown('tracking')),set(diagnostics.FIELDS))


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

        from unittest.mock import patch
        primary=diagnostics.TraceGateRefusal('tracking','trace_gate_17')
        self.assertIs(diagnostics.temporal_refusal(primary,'provider','delivery',100,1999999,100,1000000),primary)
        error=diagnostics.trace_refusal(primary,scope='tracking')
        valid=diagnostics.Diagnostic('tracking');valid.start('trace_validation');valid.fail('trace_gate_17',trace_error=error)
        expected={'row_role':'provider','parent_role':'delivery','comparison':'end','gap_band':'lt_1ms'}
        self.assertEqual(valid.snapshot()['temporal'],expected)
        snapshot=valid.snapshot();snapshot['temporal']['row_role']='postgresql'
        self.assertEqual(valid.snapshot()['temporal'],expected)
        for owned in (primary,error):
            for name in ('_temporal','temporal'):
                with self.assertRaises(AttributeError):setattr(owned,name,('private',))
            owned.__dict__['_temporal']=('private',)
        self.assertEqual(diagnostics.oracle_reason(error,scope='tracking'),'trace_gate_17')
        later=diagnostics.Diagnostic('tracking');later.start('trace_validation');later.fail('unknown')
        with patch.object(diagnostics,'_trace_temporal',side_effect=AssertionError('terminal projection called')) as projection:
            later.fail('trace_gate_17',trace_error=error);projection.assert_not_called()
        self.assertNotIn('temporal',later.snapshot())
        for reason in ('transport','interrupted'):
            first=diagnostics.Diagnostic('tracking');first.start('trace_query');first.fail(reason)
            original=first.snapshot();first.start('trace_validation');first.fail('trace_gate_17',trace_error=error)
            self.assertEqual(first.snapshot(),original)
        for action in (lambda:valid.fail('unknown'),lambda:valid.fail('trace_gate_17',trace_error=None),
                       lambda:valid.start('complete'),lambda:valid.attempt()):
            action();self.assertEqual(valid.snapshot()['temporal'],expected)
        class Foreign:
            @property
            def _scope(self):raise AssertionError('foreign access')
        class Subclass(diagnostics.TraceOracleRefusal):pass
        invalid=diagnostics.TraceOracleRefusal('tracking','trace_gate_17')
        object.__setattr__(invalid,'_temporal',('provider','delivery','end','private-canary'))
        for rejected in (None,Foreign(),Subclass('tracking','trace_gate_17'),invalid,
                         diagnostics.TraceOracleRefusal('waitlist','trace_gate_17'),
                         diagnostics.TraceOracleRefusal('tracking','trace_gate_16')):
            state=diagnostics.Diagnostic('tracking');state.start('trace_validation')
            state.fail('trace_gate_17',trace_error=rejected)
            self.assertNotIn('temporal',state.snapshot())
            self.assertEqual(state.snapshot()['reason'],'trace_gate_17')
        copied=diagnostics.trace_refusal(invalid,scope='tracking')
        state=diagnostics.Diagnostic('tracking');state.start('trace_validation');state.fail('trace_gate_17',trace_error=copied)
        self.assertNotIn('temporal',state.snapshot());self.assertEqual(copied.reason,'trace_gate_17')
        # Fault injection is confined to the optional no-I/O projection leaves.
        for kind in (OSError,ValueError,RuntimeError,KeyboardInterrupt,SystemExit,'same'):
            gate=diagnostics.TraceGateRefusal('tracking','trace_gate_17')
            secondary=gate if kind=='same' else kind('private-secondary')
            before=gate.__traceback__
            with patch.object(diagnostics,'_interval_temporal',side_effect=secondary):
                self.assertIs(diagnostics.temporal_refusal(gate,'provider','delivery',100,200,100,150),gate)
            self.assertIs(gate.__traceback__,before)
            state=diagnostics.Diagnostic('tracking');state.start('trace_validation')
            state.fail('trace_gate_17',trace_error=diagnostics.trace_refusal(gate,scope='tracking'))
            self.assertNotIn('temporal',state.snapshot())
            source=diagnostics.TraceGateRefusal('tracking','trace_gate_17')
            source_tb=source.__traceback__;secondary=source if kind=='same' else kind('private-secondary')
            with patch.object(diagnostics,'_trace_temporal',side_effect=secondary):
                converted=diagnostics.trace_refusal(source,scope='tracking')
            self.assertIs(source.__traceback__,source_tb);self.assertEqual(converted.reason,'trace_gate_17')
            primary=diagnostics.TraceOracleRefusal('tracking','trace_gate_17')
            diagnostic=diagnostics.Diagnostic('tracking');diagnostic.start('trace_validation')
            secondary=primary if kind=='same' else kind('private-secondary')
            try:
                try:raise primary
                except RuntimeError:
                    before=primary.__traceback__
                    with patch.object(diagnostics,'_trace_temporal',side_effect=secondary):
                        diagnostic.fail('trace_gate_17',trace_error=primary)
                    self.assertIs(primary.__traceback__,before)
                    raise
            except RuntimeError as caught:
                self.assertIs(caught,primary);self.assertIs(caught.__traceback__,before)
                self.assertEqual(caught.reason,'trace_gate_17')
            self.assertNotIn('temporal',diagnostic.snapshot())
            self.assertNotIn('private',json.dumps(diagnostic.snapshot()))

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
    def test_actual_urllib_http_wrapper_timeout_is_deadline_for_both_query_owners(self):
        import diagnostics
        import http.client
        import sdk_storage
        import tracking_storage
        import urllib.error
        from unittest.mock import patch
        for scope,module in (('sdk',sdk_storage),('tracking',tracking_storage)):
            for cause,expected in ((TimeoutError('private-timeout-sentinel'),'deadline'),
                                   (ConnectionRefusedError('private-refused-sentinel'),'transport'),
                                   (OSError('timed out private-text-sentinel'),'transport')):
                with self.subTest(scope=scope,cause=type(cause).__name__):
                    value=diagnostics.Diagnostic(scope)
                    kwargs={'release':'c'*40} if scope=='sdk' else {}
                    # Actual public stdlib connection seam; real urllib do_open owns wrapping.
                    with patch.object(http.client.HTTPConnection,'connect',side_effect=cause) as connect:
                        with self.assertRaises(urllib.error.URLError) as caught:
                            module.stored_metrics_and_traces(token='private-token',compose=[],targets=None,
                                observed={'trace_id':'a'*32,'root_id':'b'*16},result={},diagnostic=value,**kwargs)
                    connect.assert_called_once_with()
                    self.assertIs(caught.exception.reason,cause)
                    self.assertIsInstance(caught.exception,OSError)
                    snapshot=value.snapshot()
                    self.assertEqual((snapshot['phase'],snapshot['outcome'],snapshot['reason']),('metric_query','failed',expected))
                    self.assertEqual(snapshot['attempts'],1)
                    value.fail('unknown');value.start('complete')
                    self.assertEqual(value.snapshot(),snapshot)
                    self.assertNotIn('private',json.dumps(snapshot))
        for error,expected in ((TimeoutError('private'),'deadline'),
                               (urllib.error.URLError('timed out'),'transport'),
                               (urllib.error.URLError(OSError('timed out')),'transport'),
                               (urllib.error.URLError(urllib.error.URLError(TimeoutError())),'transport')):
            with self.subTest(error=type(error).__name__,expected=expected):
                self.assertEqual(diagnostics.query_reason(error),expected)

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
                    output=Path(directory).resolve();value=diagnostics.Diagnostic(scope)
                    body=PrivateWireWitness().wire() if scope=='sdk' else wire()
                    if case=='witness': body={'private':'private-diagnostic-witness-sentinel'}
                    else: (output/'runtime-modules.json').mkdir()
                    with patch.object(owner,capture,return_value=body):
                        with self.assertRaises(ValueError if case=='witness' else OSError):
                            module.producer_observation(output,environment={},diagnostic=value)
                    state=value.snapshot()
                    self.assertEqual((state['phase'],state['reason']),('witness','witness_refusal' if scope=='sdk' else 'witness_header') if case=='witness' else ('module_write','write_failure'))
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
                        expected=('visibility','deadline') if case=='deadline' else ('trace_query','unknown') if case=='unknown' else ('trace_validation','response_decode' if case=='decode' else 'trace_gate_05' if scope=='sdk' else 'trace_gate_06_expected_value')
                        state=diagnostic.snapshot()
                        self.assertEqual((state['phase'],state['reason']),expected)
                        self.assertEqual(state['outcome'],'failed');self.assertEqual(state['attempts'],1)
                        if case=='deadline': self.assertEqual(result['traces_state'],'pending')
                    self.assertNotIn('private-',json.dumps(diagnostic.snapshot()))

        # Worked diagnostic feature: an already-refused provider edge, not native cause.
        rows=trace_rows()
        rows[3]['end_time_unix_nano']='1800000000001999999'
        rows[3]['duration']='1999999'
        diagnostic=diagnostics.Diagnostic('tracking');result={}
        with patch.object(tracking_storage.sdk_storage,'metric_response',return_value=json.dumps(tracking_vector())) as metric_read, \
                patch.object(tracking_storage,'trace_response',return_value='\n'.join(json.dumps(row) for row in rows)) as trace_read:
            try:
                tracking_storage.stored_metrics_and_traces(token='synthetic',compose=[],targets=None,
                    observed={'trace_id':TRACE,'root_id':ROOT},result=result,diagnostic=diagnostic)
            except RuntimeError as caught:
                self.assertIs(type(caught),diagnostics.TraceOracleRefusal)
                self.assertEqual(str(caught),'Tracking storage trace contract failed')
                self.assertEqual((caught.scope,caught.reason),('tracking','trace_gate_17'))
                self.assertIs(type(caught.__context__),diagnostics.TraceGateRefusal)
                self.assertEqual((caught.__context__.scope,caught.__context__.reason),('tracking','trace_gate_17'))
                names=[];tb=caught.__traceback__
                while tb:names.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                self.assertIn('stored_metrics_and_traces',names);self.assertIn('traces',names)
            else:self.fail('original gate17 refusal swallowed')
            metric_read.assert_called_once();trace_read.assert_called_once()
        snapshot=diagnostic.snapshot()
        self.assertEqual((snapshot['phase'],snapshot['outcome'],snapshot['reason'],snapshot['attempts']),
            ('trace_validation','failed','trace_gate_17',1))
        self.assertEqual(result['metrics_state'],'passed')
        self.assertEqual(snapshot.get('temporal'),
            {'row_role':'provider','parent_role':'delivery','comparison':'end','gap_band':'lt_1ms'})

        # Worked ns boundaries exercise the real parser; expected bands are literals.
        for index,role,parent_role in ((3,'provider','delivery'),(4,'postgresql','root'),(5,'postgresql','delivery')):
            for start,end,duration,instant,comparison,band in (
                    ('1800000000000000000','1800000000001999999','1999999','2027-01-15T08:00:00.000000000Z','end','lt_1ms'),
                    ('1800000000000000000','1800000000002000000','2000000','2027-01-15T08:00:00.000000000Z','end','ge_1ms'),
                    ('1799999999999000001','1800000000001000000','1999999','2027-01-15T07:59:59.999000001Z','start','lt_1ms'),
                    ('1799999999999000000','1800000000001999999','2999999','2027-01-15T07:59:59.999000000Z','both','ge_1ms')):
                with self.subTest(role=role,comparison=comparison,band=band):
                    rows=trace_rows();row=rows[index]
                    row.update(start_time_unix_nano=start,end_time_unix_nano=end,duration=duration,_time=instant)
                    value=diagnostics.Diagnostic('tracking')
                    with patch.object(tracking_storage.sdk_storage,'metric_response',return_value=json.dumps(tracking_vector())), patch.object(tracking_storage,'trace_response',return_value='\n'.join(json.dumps(row) for row in rows)):
                        with self.assertRaisesRegex(diagnostics.TraceOracleRefusal,'^Tracking storage trace contract failed$') as caught:
                            tracking_storage.stored_metrics_and_traces(token='synthetic',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result={},diagnostic=value)
                    self.assertEqual(caught.exception.reason,'trace_gate_17')
                    self.assertEqual(value.snapshot()['temporal'],
                        {'row_role':role,'parent_role':parent_role,'comparison':comparison,'gap_band':band})
        for parent_index,parent_role in ((2,'provider'),(4,'postgresql')):
            rows=trace_rows();rows[3]['parent_span_id']=rows[parent_index]['span_id']
            rows[3].update(end_time_unix_nano='1800000000001999999',duration='1999999');rows.pop(1)
            value=diagnostics.Diagnostic('tracking')
            with patch.object(tracking_storage.sdk_storage,'metric_response',return_value=json.dumps(tracking_vector())), patch.object(tracking_storage,'trace_response',return_value='\n'.join(json.dumps(row) for row in rows)):
                with self.assertRaises(diagnostics.TraceOracleRefusal) as caught:
                    tracking_storage.stored_metrics_and_traces(token='synthetic',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result={},diagnostic=value)
            self.assertEqual(caught.exception.reason,'trace_gate_17')
            self.assertEqual(value.snapshot()['temporal'],
                {'row_role':'provider','parent_role':parent_role,'comparison':'end','gap_band':'lt_1ms'})
        rows=trace_rows();rows[3]['private-key-canary']='private-value-canary'
        value=diagnostics.Diagnostic('tracking')
        with patch.object(tracking_storage.sdk_storage,'metric_response',return_value=json.dumps(tracking_vector())), patch.object(tracking_storage,'trace_response',return_value='\n'.join(json.dumps(row) for row in rows)):
            with self.assertRaises(RuntimeError) as caught:
                tracking_storage.stored_metrics_and_traces(token='synthetic',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result={},diagnostic=value)
        self.assertNotEqual(getattr(caught.exception,'reason',None),'trace_gate_17')
        self.assertNotIn('temporal',value.snapshot())
        self.assertNotIn('private',json.dumps(value.snapshot()))


class PublicCollection(unittest.TestCase):
    def test_invalid_present_metadata_refuses_before_destination_and_legacy_absence_is_explicit_unknown(self):
        import tempfile
        import diagnostics
        import sdk_storage
        import tracking_storage
        for scope,module in (('sdk',sdk_storage),('tracking',tracking_storage)):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output=root/'private';metadata=root/'metadata';output.mkdir(mode=0o700);metadata.mkdir(mode=0o700)
                source=module.ci.read_command(['git','-C',str(module.pilot.ROOT),'rev-parse','HEAD'])
                tree=module.ci.read_command(['git','-C',str(module.pilot.ROOT),'rev-parse','HEAD^{tree}'])
                (metadata/'source.json').write_text(json.dumps(dict(checkout_sha=source,checkout_tree=tree,
                    repository=None,run_id=None,run_attempt=None,event=None,provider_execution_sha=source,
                    provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={},scope='source-fixture')))
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

        # Actual collector: one canonical finite record; invalid-present stops before copy.
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';metadata=root/'metadata'
            output.mkdir(mode=0o700);metadata.mkdir(mode=0o700)
            source=tracking_storage.ci.read_command(['git','-C',str(tracking_storage.pilot.ROOT),'rev-parse','HEAD'])
            tree=tracking_storage.ci.read_command(['git','-C',str(tracking_storage.pilot.ROOT),'rev-parse','HEAD^{tree}'])
            (metadata/'source.json').write_text(json.dumps(dict(checkout_sha=source,checkout_tree=tree,
                repository=None,run_id=None,run_attempt=None,event=None,provider_execution_sha=source,
                provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={},scope='source-fixture')))
            temporal={'row_role':'provider','parent_role':'delivery','comparison':'end','gap_band':'lt_1ms'}
            valid={**diagnostics.unknown('tracking'),'phase':'trace_validation','outcome':'failed',
                'reason':'trace_gate_17','attempts':1,'temporal':temporal}
            (output/'stderr.txt').write_text('private-raw-trace-canary')
            (output/diagnostics.NAME).write_text(json.dumps(valid,indent=4)+'\n\n')
            tracking_storage.collect(output,metadata,root/'canonical-temporal')
            canonical=(root/'canonical-temporal'/diagnostics.NAME).read_text()
            self.assertEqual(json.loads(canonical),valid)
            self.assertEqual(diagnostics.read(root/'canonical-temporal'/diagnostics.NAME,scope='tracking'),valid)
            self.assertNotIn('private',canonical)
            self.assertLess(len(canonical),len(json.dumps(valid,indent=4)))
            self.assertEqual((root/'canonical-temporal'/diagnostics.NAME).stat().st_mode&0o777,0o600)
            for index,bad in enumerate((None,{**temporal,'private':'private-canary'},
                                        {**temporal,'comparison':'private-canary'},
                                        {**temporal,'gap_band':1000000},{})):
                (output/diagnostics.NAME).write_text(json.dumps({**valid,'temporal':bad}))
                target=root/('refused-temporal-'+str(index))
                with self.assertRaisesRegex(ValueError,'^closed storage diagnostic contract failed$'):
                    tracking_storage.collect(output,metadata,target)
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
            output=Path(directory).resolve();diagnostic=diagnostics.Diagnostic('tracking')
            with patch.object(tracking_storage.producer_protocol,'capture',return_value=value):
                with self.assertRaises(ValueError):
                    tracking_storage.producer_observation(output,environment={},diagnostic=diagnostic)
            self.assertFalse((output/'runtime-modules.json').exists())
            self.assertEqual((diagnostic.snapshot()['phase'],diagnostic.snapshot()['reason']),('module_projection','module_projection'))


if __name__ == '__main__': unittest.main()
