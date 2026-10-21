"""Finite unexpected-key evidence through the real strict oracle; no API/PG."""
import json
from pathlib import Path
import tempfile
import unittest

import tracking_oracle
import unexpected_keys as facts
from test_tracking_oracle import trace_rows, TRACE, ROOT

SOURCE='a'*40


class UnexpectedKeyFacts(unittest.TestCase):
    def test_real_unexpected_refusal_keeps_original_error_and_persists_only_closed_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private-value-canary'
            with facts.create(output) as owner:
                facts.bind_source(owner,SOURCE)
                with self.assertRaises(RuntimeError) as caught:
                    tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)
                self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                self.assertEqual(caught.exception.args,('Tracking storage trace contract failed',))
            path=output/facts.NAME
            self.assertTrue(path.is_file(),'first unexpected refusal has no closed observation')
            self.assertEqual(json.loads(path.read_text()),dict(schema=1,scope='tracking',source=SOURCE,state='observed',
                gate='trace_gate_06_unexpected_key',role='postgresql_acquire',known_keys=['a19'],other=False))
            self.assertNotIn('private-value-canary',path.read_text())


# Literal contract from the existing non-Telegram Alloy keep_keys catalog.
CATALOG = ('http.route','http.request.method','http.request.outcome','http.response.status_code',
    'messaging.system','messaging.destination.name','messaging.operation.name','messaging.operation.type',
    'pgboss.job.state','error.type','dependency.name','dependency.operation','dependency.outcome',
    'tracking.operation','tracking.outcome','waitlist.operation','waitlist.outcome','email.lane',
    'messaging.message.id','pgboss.job.retry_count','messaging.batch.message_count')


def closed(state='unknown',role='unknown',keys=(),other=False):
    return dict(schema=1,scope='tracking',source=SOURCE,state=state,gate='trace_gate_06_unexpected_key' if state=='observed' else 'unknown',
                role=role,known_keys=list(keys),other=other)


class ObserverContracts(unittest.TestCase):
    def observe_rows(self,rows,output,owner):
        return tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)

    def test_every_catalog_candidate_has_exact_source_id_for_all_five_roles(self):
        import producer_phase
        for index,role in ((0,'root'),(1,'delivery'),(2,'provider'),(4,'postgresql_query'),(-1,'postgresql_acquire')):
            for ordinal,key in enumerate(CATALOG,1):
                with self.subTest(role=role,key=ordinal),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory).resolve();rows=trace_rows();extra='span_attr:'+key
                    unexpected=extra not in rows[index]
                    if unexpected:rows[index][extra]='private-value-canary'
                    with facts.create(output) as owner:
                        facts.bind_source(owner,SOURCE)
                        if unexpected:
                            with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$') as caught:self.observe_rows(rows,output,owner)
                            self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                        else:self.assertIsNotNone(self.observe_rows(rows,output,owner))
                    value=producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE)
                    self.assertEqual(value,closed('observed',role,('a'+str(ordinal).zfill(2),)) if unexpected else closed())
                    wire=(output/facts.NAME).read_text();self.assertNotIn('private-value-canary',wire);self.assertNotIn(extra,wire)

    def test_unknown_keys_are_only_a_boolean_and_multiple_keys_sort_and_latch(self):
        import producer_phase
        for ordering in (('messaging.batch.message_count','messaging.system','messaging.message.id'),
                         ('messaging.message.id','messaging.batch.message_count','messaging.system')):
            with tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();rows=trace_rows()
                for key in ordering:rows[-1]['span_attr:'+key]='private-value-canary'
                rows[-1]['private-key-canary']='private-value-canary'
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    self.assertIsNone(self.observe_rows(trace_rows()[:1],output,owner))
                    with self.assertRaises(RuntimeError):self.observe_rows(rows,output,owner)
                    later=trace_rows();later[0]['span_attr:error.type']='private-later'
                    with self.assertRaises(RuntimeError):self.observe_rows(later,output,owner)
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed('observed','postgresql_acquire',('a05','a19','a21'),True))
                self.assertNotIn('private', (output/facts.NAME).read_text())

    def test_earlier_and_other_gate06_details_never_produce_unexpected_facts(self):
        import producer_phase
        for case in ('missing','expected','optional','earlier'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();rows=trace_rows()
                if case=='missing':rows[-1].pop('resource_attr:service.version');rows[-1]['private-key']='private'
                elif case=='expected':rows[-1]['kind']='999'
                elif case=='optional':rows[-1]['scope_version']='private'
                else:rows[-1]['span_id']='invalid';rows[-1]['private-key']='private'
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    with self.assertRaises(RuntimeError):self.observe_rows(rows,output,owner)
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed())

    def test_default_and_foreign_observers_do_not_touch_hostile_inputs_or_io(self):
        from unittest.mock import patch
        import producer_phase
        class Hostile:
            def __hash__(self):raise AssertionError('foreign hash')
            def __getattribute__(self,_):raise AssertionError('foreign getter')
        class Derived(type(facts.create(Path('/owned')))):pass
        for owner in (None,Hostile(),object.__new__(Derived),object.__new__(type(facts.create(Path('/owned'))))):
            self.assertIsNone(facts.admit(owner))
            with patch.object(producer_phase,'write_unexpected_keys',side_effect=AssertionError('unexpected IO')):
                facts.observe(owner,Hostile(),Hostile(),Hostile());facts.bind_source(owner,Hostile())
        rows=trace_rows();rows[-1]['private-key']='private'
        with patch.object(facts,'create',side_effect=AssertionError('default allocation')),patch.object(producer_phase,'write_unexpected_keys',side_effect=AssertionError('default IO')):
            with self.assertRaises(RuntimeError):tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT)

    def test_source_binding_is_once_and_internal_fault_is_only_channel_refusal(self):
        from unittest.mock import patch
        import producer_phase
        for case in ('conflict','invalid','internal'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve()
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    if case=='conflict':facts.bind_source(owner,'b'*40)
                    elif case=='invalid':facts.bind_source(owner,True)
                    else:
                        rows=trace_rows();rows[-1]['private-key']='private'
                        with patch.object(facts,'validate',side_effect=RuntimeError('private failure')):
                            with self.assertRaises(RuntimeError) as caught:self.observe_rows(rows,output,owner)
                            self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed('refused'))
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output):pass
            self.assertFalse((output/facts.NAME).exists())


class ReadPrimaryContracts(unittest.TestCase):
    def test_new_read_keeps_first_control_flow_primary_and_traceback_across_all_closes(self):
        import os
        import stat
        from unittest.mock import patch
        import producer_phase as phase
        class HostileTraceback(RuntimeError):
            def with_traceback(self,*_):raise AssertionError('overridden traceback method')
        for operation in ('read','fstat'):
            for kind in (KeyboardInterrupt,SystemExit,HostileTraceback):
                for same in (False,True):
                    with self.subTest(operation=operation,kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                        output=Path(directory).resolve();path=output/facts.NAME;phase.write_unexpected_keys(path,closed(),source=SOURCE)
                        primary=kind('private primary');secondary=primary if same else OSError('private secondary')
                        original_close=os.close;original_fstat=os.fstat;closes=[]
                        def failing_read(*_):raise primary
                        def failing_fstat(fd):
                            value=original_fstat(fd)
                            if stat.S_ISREG(value.st_mode):raise primary
                            return value
                        def close_after_actual(fd):
                            closes.append(fd);original_close(fd)
                            if len(closes)==1:raise secondary
                        with patch.object(phase.os,'close',side_effect=close_after_actual),patch.object(phase.os,operation,side_effect=failing_read if operation=='read' else failing_fstat):
                            captured=None
                            try:phase.read_unexpected_keys(path,source=SOURCE)
                            except BaseException as error:captured=error
                        self.assertIs(captured,primary);self.assertEqual(len(closes),2);self.assertEqual(len(set(closes)),2)
                        frames=[];tb=BaseException.__traceback__.__get__(primary)
                        while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                        self.assertNotIn('close_after_actual',frames)
                        for fd in closes:
                            with self.assertRaises(OSError):original_fstat(fd)



class OrchestrationContracts(unittest.TestCase):
    def test_producer_binds_only_its_existing_single_git_read(self):
        from unittest.mock import patch
        import tracking_storage as storage
        diagnostic=storage.diagnostics.Diagnostic('tracking')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output) as owner:
                with patch.object(storage.ci,'read_command',return_value=SOURCE) as command,patch.object(storage.producer_protocol,'capture',return_value={}),patch.object(storage.producer_protocol,'witness',return_value={'runtime_modules':{}}),patch.object(storage.pilot,'write_json'):
                    storage.producer_observation(output,environment={},diagnostic=diagnostic,observation=owner)
                    command.assert_called_once_with(['git','-C',str(storage.pilot.ROOT),'rev-parse','HEAD'])
                rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private'
                with self.assertRaises(RuntimeError):tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)
            self.assertTrue((output/facts.NAME).is_file(),'existing Git source did not bind observation')
            self.assertEqual(json.loads((output/facts.NAME).read_text()),closed('observed','postgresql_acquire',('a19',)))

    def test_stored_loop_forwards_first_actual_refusal_after_pending_without_more_queries(self):
        from unittest.mock import patch
        import tracking_storage as storage
        from test_tracking_oracle import vector
        rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private'
        diagnostic=storage.diagnostics.Diagnostic('tracking');result={}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output) as owner:
                facts.bind_source(owner,SOURCE)
                with patch.object(storage.sdk_storage,'metric_response',return_value=json.dumps(vector())) as metrics,patch.object(storage,'trace_response',side_effect=['','\n'.join(json.dumps(row) for row in rows),'unreachable']) as traces,patch.object(storage.time,'sleep') as sleep:
                    with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$') as caught:
                        storage.stored_metrics_and_traces(token='owned',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result=result,diagnostic=diagnostic,observation=owner)
                    self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                    self.assertEqual((metrics.call_count,traces.call_count,sleep.call_count),(2,2,1))
            self.assertEqual(json.loads((output/facts.NAME).read_text()),closed('observed','postgresql_acquire',('a19',)))
            self.assertEqual((diagnostic.snapshot()['phase'],diagnostic.snapshot()['reason']),('trace_validation','trace_gate_06_unexpected_key'))


if __name__=='__main__':unittest.main()
