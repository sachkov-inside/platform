"""Post-capture storage feedback, without acquisition or native failure attribution."""
import ast
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import diagnostics
import waitlist_storage as storage


class StorageFeedback(unittest.TestCase):
    def invoke(self,output,diagnostic):
        return storage.stored_metrics_and_traces(output,token='synthetic',compose=[],targets=None,
            observed={'trace_id':'a'*32,'root_id':'b'*16},result={},diagnostic=diagnostic)

    def contexts(self):
        metrics={'dependency_counts':{'postgresql:query':3,'postgresql:acquire':2}}
        traces={'postgresql_counts':{'query':3,'acquire':2}}
        return (patch.object(storage.sdk_storage,'metric_response',return_value='synthetic'),
                patch.object(storage,'trace_response',return_value='synthetic'),
                patch.object(storage.waitlist_oracle,'metrics',return_value=metrics),
                patch.object(storage.waitlist_oracle,'traces',return_value=traces))

    def test_entered_boundaries_first_failure_and_original_error_identity(self):
        for phase,error in (('metric_query',OSError('private-canary')),
                            ('metric_validation',RuntimeError('private-canary')),
                            ('trace_query',subprocess.TimeoutExpired('private-canary',1)),
                            ('trace_validation',diagnostics.TraceOracleRefusal('waitlist','trace_gate_06'))):
            with self.subTest(phase=phase),tempfile.TemporaryDirectory() as directory:
                diagnostic=diagnostics.Diagnostic('waitlist');contexts=self.contexts()
                with contexts[0] as metric_read,contexts[1] as trace_read,contexts[2] as metric_validate,contexts[3] as trace_validate:
                    owning={'metric_query':metric_read,'trace_query':trace_read,'metric_validation':metric_validate,'trace_validation':trace_validate}[phase]
                    def primary(*args,**kwargs):raise error
                    owning.side_effect=primary
                    try:self.invoke(Path(directory),diagnostic)
                    except BaseException as caught:
                        self.assertIs(caught,error)
                        names=[];tb=caught.__traceback__
                        while tb:names.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                        self.assertIn('primary',names)
                    else:self.fail('original error swallowed')
                value=diagnostics.read(Path(directory)/diagnostics.NAME,scope='waitlist')
                self.assertEqual(value['phase'],phase)
                self.assertEqual(value['reason'],{'metric_query':'transport','metric_validation':'unknown','trace_query':'deadline','trace_validation':'trace_gate_06'}[phase])
                self.assertNotIn('private-canary',json.dumps(value))
                diagnostic.start('complete');diagnostic.fail('unknown');self.assertEqual(diagnostic.snapshot(),value)

    def test_observer_write_failure_preserves_primary_but_refuses_success(self):
        for observer in (OSError,ValueError):
            for kind in ('runtime','timeout','interrupt','success'):
                with self.subTest(observer=observer.__name__,kind=kind),tempfile.TemporaryDirectory() as directory:
                    contexts=self.contexts();error={'runtime':RuntimeError('private-canary'),'timeout':subprocess.TimeoutExpired('private-canary',1),'interrupt':KeyboardInterrupt()} .get(kind)
                    with contexts[0],contexts[1] as trace_read,contexts[2],contexts[3],patch.object(diagnostics,'write',side_effect=observer('private-observer')):
                        original_traceback=[]
                        def fail(*args,**kwargs):
                            try:raise error
                            except BaseException:
                                original_traceback.append(sys.exc_info()[2]);raise
                        if error is not None:trace_read.side_effect=fail
                        try:self.invoke(Path(directory),diagnostics.Diagnostic('waitlist'))
                        except BaseException as caught:
                            if error is not None:
                                self.assertIs(caught,error)
                                frames=[];tb=caught.__traceback__
                                while tb:frames.append(tb);tb=tb.tb_next
                                self.assertTrue(any(tb is original_traceback[0] for tb in frames))
                            else:self.assertIs(type(caught),observer)
                        else:self.fail('observer failure accepted')

    def test_pending_deadline_and_later_metric_failure_never_inherit_a_trace_gate(self):
        for case in ('pending','later_metric','reconciliation'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                now=[0.0];contexts=self.contexts();diagnostic=diagnostics.Diagnostic('waitlist')
                def sleep(seconds):self.assertEqual(seconds,.25);now[0]+=60
                with contexts[0] as read,contexts[1],contexts[2] as metrics,contexts[3] as traces,patch.object(storage.time,'monotonic',side_effect=lambda:now[0]),patch.object(storage.time,'sleep',side_effect=sleep):
                    if case=='pending':metrics.return_value=None;traces.return_value=None
                    elif case=='later_metric':
                        metrics.return_value=None
                        read.side_effect=['synthetic',OSError('private-canary')]
                        def next_poll(seconds):self.assertEqual(seconds,.25);now[0]+=1
                        storage.time.sleep.side_effect=next_poll
                    else:metrics.return_value={'dependency_counts':{'postgresql:query':2,'postgresql:acquire':2}}
                    with self.assertRaises((TimeoutError,OSError,RuntimeError)):self.invoke(Path(directory),diagnostic)
                value=diagnostics.read(Path(directory)/diagnostics.NAME,scope='waitlist')
                self.assertEqual((value['phase'],value['reason']),{'pending':('visibility','deadline'),'later_metric':('metric_query','transport'),'reconciliation':('reconciliation','oracle_refusal')}[case])

    def test_success_query_budgets_order_and_capture_defaults_stay_owned(self):
        contexts=self.contexts();events=[]
        with tempfile.TemporaryDirectory() as directory,contexts[0] as metric_read,contexts[1] as trace_read,contexts[2] as metric_validate,contexts[3] as trace_validate:
            for label,call in (('metric_query',metric_read),('trace_query',trace_read),('metric_validation',metric_validate),('trace_validation',trace_validate)):
                result=call.return_value
                def observed(*args,label=label,result=result,**kwargs):events.append(label);return result
                call.side_effect=observed
            self.invoke(Path(directory),diagnostics.Diagnostic('waitlist'))
            self.assertEqual(events,['metric_query','metric_validation','trace_query','trace_validation'])
            for call in (metric_read,trace_read):self.assertGreater(call.call_args.kwargs['budget'],0);self.assertLessEqual(call.call_args.kwargs['budget'],10)
            self.assertEqual(diagnostics.read(Path(directory)/diagnostics.NAME,scope='waitlist')['phase'],'complete')
        self.assertEqual(str(inspect.signature(storage.capture_producer)),"(output, *, environment, source)")
        function=next(n for n in ast.parse(Path(storage.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='worker')
        calls={}
        for node in ast.walk(function):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ('capture_producer','stored_metrics_and_traces'):calls[node.func.id]=node.lineno
        self.assertLess(calls['capture_producer'],calls['stored_metrics_and_traces'])
        # Capture is not caught inside this worker: its failure is terminal before storage.
        parents={child:node for node in ast.walk(function) for child in ast.iter_child_nodes(node)}
        capture=next(n for n in ast.walk(function) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='capture_producer')
        while capture is not function:
            capture=parents[capture]
            if isinstance(capture,ast.Try):self.assertFalse(capture.handlers)
