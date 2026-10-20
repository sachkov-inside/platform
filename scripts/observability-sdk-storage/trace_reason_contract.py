"""Shared owning trace-gate contracts. Synthetic controls are not a native reproduction."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import diagnostics


class TraceReasons(unittest.TestCase):
    def parse(self,rows):
        return self.oracle.traces('\n'.join(json.dumps(row) for row in rows),**self.arguments)

    def test_observed_rows_have_closed_predicate_gates(self):
        self.assertIsNotNone(self.parse(self.fixture()))
        self.assertIsNone(self.parse([]))
        for case,gate in (('type',3),('name',3 if self.scope=='sdk' else 5),
                          ('number',6 if self.scope=='sdk' else 7),
                          ('time',7 if self.scope=='sdk' else 8),('contract',5 if self.scope=='sdk' else 6)):
            with self.subTest(case=case):
                rows=copy.deepcopy(self.fixture())
                if case=='type': rows[-1]['kind']=3
                elif case=='name': rows[-1]['name']='unregistered'
                elif case=='number': rows[-1]['duration']='x'
                elif case=='time': rows[-1]['duration']='2'
                else: rows[-1]['unregistered']='private-canary'
                before=copy.deepcopy(rows)
                with self.assertRaisesRegex(RuntimeError,'^'+diagnostics.TRACE_MESSAGES[self.scope]+'$') as caught:
                    self.parse(rows)
                self.assertEqual(caught.exception.reason,'trace_gate_'+str(gate).zfill(2))
                self.assertEqual(diagnostics.oracle_reason(caught.exception,scope=self.scope),caught.exception.reason)
                self.assertTrue(rows==before,'oracle mutated synthetic rows')
                for field in ('reason','_reason','scope','_scope'):
                    with self.assertRaises(AttributeError):setattr(caught.exception,field,'private-canary')

    def test_every_reachable_semantic_gate_uses_its_permanent_identifier(self):
        def changed(index,**fields):
            rows=copy.deepcopy(self.fixture());rows[index].update(fields);return rows
        def extra(index):
            rows=copy.deepcopy(self.fixture());row=copy.deepcopy(rows[index]);row['span_id']='e'*16;rows.append(row);return rows
        cases=[(1,self.fixture(),{'trace_id':'invalid'}),
               (2,self.fixture()* (2 if self.scope=='sdk' else 8),{}),
               (4,changed(-1,span_id=self.fixture()[0]['span_id']),{})]
        if self.scope=='sdk':
            cases += [(8,changed(0,span_id='f'*16),{}),
                      (9,changed(1,parent_span_id='f'*16),{}),
                      (10,changed(2,parent_span_id=self.arguments['root_id']),{}),
                      (11,changed(2,parent_span_id='f'*16),{}),
                      (12,changed(2,end_time_unix_nano='1800000000002600000',duration='1600000'),{})]
        else:
            root=self.arguments['root_id'];delivery=self.fixture()[1]['span_id']
            cases += [(9,extra(0),{}),(10,changed(1,parent_span_id='f'*16),{}),
                      (11,changed(-1,parent_span_id=self.fixture()[-1]['span_id']),{}),
                      (12,extra(2 if self.scope=='tracking' else 3),{}),
                      (13,changed(2 if self.scope=='tracking' else 3,parent_span_id='f'*16),{})]
            if self.scope=='tracking':
                cases.append((14,changed(3,parent_span_id=root),{}))
            else:cases.append((14,extra(2),{}))
            partial=copy.deepcopy(self.fixture());partial.pop(1)
            partial[-1]['parent_span_id']=partial[1]['span_id']
            cases += [(15,partial,{}),(16,changed(-1,parent_span_id='f'*16),{}),
                      (17,changed(-1,end_time_unix_nano='1800000000001000001',duration='1000001'),{})]
            if self.scope=='tracking':
                cycle=copy.deepcopy(self.fixture());cycle.pop(1)
                cycle[1]['parent_span_id']=cycle[2]['span_id'];cycle[2]['parent_span_id']=cycle[1]['span_id']
                cases.append((18,cycle,{}))
            from datetime import datetime,timezone
            earlier=copy.deepcopy(self.fixture())
            for row in earlier:
                if row['span_id']==delivery or row.get('parent_span_id')==delivery:
                    for key in ('start_time_unix_nano','end_time_unix_nano'):row[key]=str(int(row[key])-2_000_000)
                    seconds,nanos=divmod(int(row['start_time_unix_nano']),1_000_000_000)
                    row['_time']=datetime.fromtimestamp(seconds,timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')+'.'+str(nanos).zfill(9)+'Z'
            cases.append((19,earlier,{}))
        for gate,rows,arguments in cases:
            with self.subTest(gate=gate),self.assertRaises(RuntimeError) as caught:
                self.oracle.traces('\n'.join(json.dumps(row) for row in rows),**{**self.arguments,**arguments})
            self.assertEqual(diagnostics.oracle_reason(caught.exception,scope=self.scope),'trace_gate_'+str(gate).zfill(2))
            self.assertTrue(caught.exception.__suppress_context__)
        # Pending and the earlier parent predicates imply these final checks.
        # Do not weaken those predicates or fabricate data just to enter them:
        # tracking20: two distinct admitted provider parents already equal both mains;
        # waitlist18: visible SQL parents/main edges cannot form a cycle;
        # waitlist20: one admitted provider parent already equals delivery.
        # Their exact original predicates/positions are pinned by the AST contract.

    def test_all_original_predicates_and_semantic_gate_bindings_stay_in_order(self):
        expected=json.loads(Path(__file__).with_name('trace-predicates.json').read_text())['scopes'][self.scope]
        root=Path(__file__).resolve().parents[2]
        function=next(n for n in ast.parse((root/expected['source']).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='traces')
        sha=lambda raw:hashlib.sha256(raw).hexdigest()
        predicates=[ast.dump(n.test) for n in ast.walk(function) if isinstance(n,ast.If)]
        self.assertEqual(sha(json.dumps(predicates).encode()),expected['ordered_predicates_sha256'])
        parents={child:node for node in ast.walk(function) for child in ast.iter_child_nodes(node)}
        found={}
        for node in ast.walk(function):
            if not (isinstance(node,ast.Raise) and isinstance(node.exc,ast.Call) and isinstance(node.exc.func,ast.Name) and node.exc.func.id=='TraceGateRefusal'):continue
            scope,gate=[ast.literal_eval(arg) for arg in node.exc.args]
            if gate=='trace_decode':continue
            self.assertEqual(scope,self.scope);self.assertNotIn(gate,found)
            parent=parents[node]
            while not isinstance(parent,ast.If):parent=parents[parent]
            found[gate]=sha(ast.dump(parent.test).encode())
        self.assertEqual(found,{gate:row['predicate_sha256'] for gate,row in expected['gates'].items()})

    def test_sdk_and_tracking_callers_preserve_the_same_primary_and_traceback(self):
        if self.scope=='waitlist':return  # Its post-capture persistence has its own concrete contracts.
        storage=__import__('sdk_storage' if self.scope=='sdk' else 'tracking_storage')
        diagnostic=diagnostics.Diagnostic(self.scope)
        error=diagnostics.TraceOracleRefusal(self.scope,'trace_gate_06')
        def refuse(*args,**kwargs):raise error from None
        metric_owner=storage if self.scope=='sdk' else storage.sdk_storage
        with patch.object(metric_owner,'metric_response',return_value='synthetic'), \
             patch.object(storage,'trace_response',return_value='synthetic'), \
             patch.object(storage.oracle if self.scope=='sdk' else storage.tracking_oracle,'metrics',return_value={}), \
             patch.object(storage.oracle if self.scope=='sdk' else storage.tracking_oracle,'traces',side_effect=refuse):
            keywords={'token':'synthetic','compose':[],'targets':None,'observed':{'trace_id':'a'*32,'root_id':'b'*16},'result':{},'diagnostic':diagnostic}
            if self.scope=='sdk':keywords['release']='c'*40
            try:storage.stored_metrics_and_traces(**keywords)
            except RuntimeError as caught:
                self.assertIs(caught,error);self.assertTrue(caught.__suppress_context__)
                names=[];tb=caught.__traceback__
                while tb:names.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                self.assertIn('refuse',names)
            else:self.fail('primary swallowed')
        self.assertEqual((diagnostic.snapshot()['phase'],diagnostic.snapshot()['reason']),('trace_validation','trace_gate_06'))

    def test_decode_categories_and_late_poison_never_publish_partial_success(self):
        with self.assertRaises(RuntimeError) as caught:self.oracle.traces('{',**self.arguments)
        self.assertEqual(diagnostics.oracle_reason(caught.exception,scope=self.scope),'response_decode')
        for raw in ('[]',json.dumps({'name':'sdk-storage-private'})):
            with self.subTest(case='row' if raw=='[]' else 'decode'),self.assertRaises(RuntimeError) as caught:
                self.oracle.traces(raw,**self.arguments)
            self.assertEqual(diagnostics.oracle_reason(caught.exception,scope=self.scope),
                             'trace_gate_03' if raw=='[]' else 'trace_decode')
        rows=self.fixture()[:1]
        self.assertIsNone(self.parse(rows))
        rows.append({'name':'sdk-storage-private'})
        with self.assertRaises(RuntimeError) as caught:self.parse(rows)
        self.assertEqual(diagnostics.oracle_reason(caught.exception,scope=self.scope),'trace_decode')


class ClosedTraceMetadata(unittest.TestCase):
    def test_all_metadata_dependencies_and_owning_workflow_routing_are_bound(self):
        import fnmatch
        import sdk_storage
        root=Path(__file__).resolve().parents[2]
        inputs={str(p.relative_to(root)) for p in sdk_storage.source_inputs()}
        required={'scripts/observability-sdk-storage/diagnostics.py',
                  'scripts/observability-sdk-storage/trace-predicates.json',
                  'scripts/observability-sdk-storage/trace_reason_contract.py',
                  'scripts/observability-sdk-storage/test_sdk_trace_reasons.py'}
        self.assertFalse(required-inputs,'trace feedback inputs not bound')
        for scope in ('sdk','tracking','waitlist'):
            workflow=(root/('.github/workflows/observability-'+scope+'-storage.yml')).read_text()
            patterns=[line.strip()[2:] for line in workflow.splitlines() if line.startswith('      - ')]
            for name in required:
                self.assertTrue(any(fnmatch.fnmatchcase(name,pattern) for pattern in patterns))

    def test_exact_types_only_and_readonly_constructor_fields(self):
        class Foreign(RuntimeError):
            def __getattribute__(self,name):
                if name in ('reason','scope','args','private'):raise AssertionError('foreign field read')
                return super().__getattribute__(name)
            def __str__(self):raise AssertionError('foreign str')
            def __repr__(self):raise AssertionError('foreign repr')
        class Subtype(diagnostics.OracleRefusal):
            @property
            def reason(self):raise AssertionError('foreign getter')
            @reason.setter
            def reason(self,value):pass
        for scope in ('sdk','tracking','waitlist'):
            for error in (Foreign('private-canary'),Subtype('private-canary','oracle_refusal'),RuntimeError('private-canary')):
                self.assertEqual(diagnostics.oracle_reason(error,scope=scope),'unknown')
            for cls in (diagnostics.TraceGateRefusal,diagnostics.TraceOracleRefusal):
                for invalid in (None,True,[],{},'private-canary','trace_gate_21'):
                    with self.assertRaises(ValueError):cls(scope,invalid)
                error=cls(scope,'trace_gate_01')
                for field in ('reason','_reason','scope','_scope'):
                    with self.assertRaises(AttributeError):setattr(error,field,'private-canary')
            malformed=diagnostics.TraceOracleRefusal.__new__(diagnostics.TraceOracleRefusal)
            self.assertEqual(diagnostics.oracle_reason(malformed,scope=scope),'unknown')
            object.__setattr__(malformed,'_scope',scope);object.__setattr__(malformed,'_reason',{'private':'canary'})
            self.assertEqual(diagnostics.oracle_reason(malformed,scope=scope),'unknown')
        class ForeignTrace(diagnostics.TraceOracleRefusal):
            @property
            def reason(self):raise AssertionError('foreign trace getter')
            def __str__(self):raise AssertionError('foreign trace str')
        foreign=ForeignTrace.__new__(ForeignTrace)
        self.assertEqual(diagnostics.oracle_reason(foreign,scope='sdk'),'unknown')
        class ForeignGate(diagnostics.TraceGateRefusal):
            @property
            def scope(self):raise AssertionError('foreign gate getter')
        foreign=ForeignGate.__new__(ForeignGate)
        self.assertIs(type(diagnostics.trace_refusal(foreign,scope='sdk')),diagnostics.OracleRefusal)
        for legacy_reason in (None,{},True):
            legacy=diagnostics.OracleRefusal.__new__(diagnostics.OracleRefusal)
            legacy.reason=legacy_reason
            self.assertEqual(diagnostics.oracle_reason(legacy),'unknown')
        for cls in (diagnostics.TraceGateRefusal,diagnostics.TraceOracleRefusal):
            with self.assertRaises(ValueError):cls('sdk','trace_gate_13')
        owned=diagnostics.TraceOracleRefusal('tracking','trace_gate_01')
        self.assertEqual(diagnostics.oracle_reason(owned,scope='sdk'),'unknown')
        self.assertEqual(diagnostics.oracle_reason(owned),'unknown')

    def test_closed_artifact_scope_phase_matrix_first_failure_and_saturation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/diagnostics.NAME
            for scope,limit in (('sdk',12),('tracking',20),('waitlist',20)):
                for gate in ('trace_decode',*('trace_gate_'+str(i).zfill(2) for i in range(1,limit+1))):
                    value=diagnostics.Diagnostic(scope);value.start('trace_validation')
                    for _ in range(1025):value.attempt()
                    value.fail(gate);first=value.snapshot();value.start('complete');value.fail('unknown')
                    self.assertEqual(value.snapshot(),first);self.assertEqual(first['attempts'],1024)
                    self.assertTrue(first['attempts_saturated']);self.assertEqual(len(first),7)
                    diagnostics.write(path,first,scope=scope);self.assertEqual(diagnostics.read(path,scope=scope),first)
                    self.assertLessEqual(path.stat().st_size,2048)
                    self.assertNotIn('private-canary',path.read_text())
                original={**diagnostics.unknown(scope),'phase':'trace_validation','outcome':'failed','reason':'trace_gate_01'}
                for bad in ({**original,'phase':'metric_validation'},{**original,'reason':'trace_gate_21'},
                            {**original,'reason':True},{**original,'private':'canary'},{**original,'scope':'foreign'}):
                    path.write_text(json.dumps(bad))
                    with self.assertRaises(ValueError):diagnostics.read(path,scope=scope)
                if scope=='sdk':
                    with self.assertRaises(ValueError):diagnostics.validate({**original,'reason':'trace_gate_13'},scope=scope)
