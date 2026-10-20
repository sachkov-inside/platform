"""Four closed reasons refine rejection, never native cause or acceptance."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import tracking_oracle
from test_tracking_oracle import trace_rows,TRACE,ROOT
import diagnostics


class Gate06Detail(unittest.TestCase):
    def test_four_rejected_row_contracts_keep_gate_and_publish_only_fixed_detail(self):
        for detail in ('missing_mandatory','unexpected_key','expected_value','optional_value'):
            rows=copy.deepcopy(trace_rows())
            if detail=='missing_mandatory':rows[-1].pop('resource_attr:service.version')
            elif detail=='unexpected_key':rows[-1]['private-canary-key']='private-canary-value'
            elif detail=='expected_value':rows[-1]['kind']='999'
            else:rows[-1]['scope_version']='private-canary-value'
            with self.subTest(detail=detail),self.assertRaises(RuntimeError) as caught:
                tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT)
            error=caught.exception
            self.assertEqual(error.reason,'trace_gate_06');self.assertEqual(error.detail,detail)
            self.assertEqual(diagnostics.oracle_reason(error,scope='tracking'),'trace_gate_06_'+detail)
            self.assertEqual(str(error),'Tracking storage trace contract failed')
            self.assertTrue(error.__suppress_context__)
            value=diagnostics.Diagnostic('tracking');value.start('trace_validation');value.fail(error.diagnostic_reason)
            self.assertEqual(len(value.snapshot()),7)
            self.assertNotIn('private-canary',json.dumps(value.snapshot()))

    def test_tracking_only_failed_trace_validation_and_legacy_aggregate(self):
        error=diagnostics.TraceOracleRefusal('tracking','trace_gate_06')
        self.assertEqual(error.reason,error.diagnostic_reason);self.assertIsNone(error.detail)
        for scope,gate in (('sdk','trace_gate_06'),('waitlist','trace_gate_06'),('tracking','trace_gate_05')):
            with self.assertRaises(ValueError):diagnostics.TraceGateRefusal(scope,gate,detail='unexpected_key')
        for scope,phase in (('sdk','trace_validation'),('waitlist','trace_validation'),('tracking','metric_validation')):
            owner=diagnostics.Diagnostic(scope);owner.start(phase)
            with self.assertRaises(ValueError):owner.fail('trace_gate_06_unexpected_key')

    def test_secondary_persist_rethrowing_primary_keeps_original_traceback(self):
        import subprocess
        for kind in (OSError,ValueError,RuntimeError,KeyboardInterrupt,SystemExit,subprocess.TimeoutExpired):
            for same in (False,True):
                with self.subTest(kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                    error=kind('owned',1) if kind is subprocess.TimeoutExpired else kind('owned')
                    secondary=error if same else OSError('secondary');owner=diagnostics.Diagnostic('tracking')
                    try:raise error
                    except BaseException:
                        original=sys.exc_info()[2]
                        try:
                            with patch.object(diagnostics,'write',side_effect=secondary):owner.persist(Path(directory)/diagnostics.NAME)
                        except BaseException:self.fail('secondary persistence escaped the pending primary')
                        self.assertIs(BaseException.__traceback__.__get__(error),original)

    def test_mixed_refusals_follow_original_conjunct_order_and_foreign_metadata_is_unknown(self):
        rows=copy.deepcopy(trace_rows());rows[-1].pop('resource_attr:service.version');rows[-1]['private-key']='private-value';rows[-1]['kind']='999'
        with self.assertRaises(RuntimeError) as caught:tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT)
        self.assertEqual(caught.exception.detail,'missing_mandatory')
        for name in ('detail','diagnostic_reason','_detail'):
            with self.assertRaises(AttributeError):setattr(caught.exception,name,'private')
        error=diagnostics.TraceOracleRefusal('tracking','trace_gate_06',detail='unexpected_key')
        object.__setattr__(error,'_detail',object())
        self.assertEqual(diagnostics.oracle_reason(error,scope='tracking'),'unknown')
        class Foreign(diagnostics.TraceOracleRefusal):
            def __getattribute__(self,key):raise AssertionError('foreign getter')
        foreign=BaseException.__new__(Foreign)
        self.assertEqual(diagnostics.oracle_reason(foreign,scope='tracking'),'unknown')

    def test_shared_writer_does_not_delete_foreign_temp_recreated_after_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/diagnostics.NAME;temporary=root/'.storage-diagnostic.new'
            value=diagnostics.unknown('tracking');replace=diagnostics.os.replace
            def commit(source,destination):replace(source,destination);temporary.write_text('foreign writer')
            with patch.object(diagnostics.os,'replace',side_effect=commit):diagnostics.write(path,value,scope='tracking')
            self.assertTrue(temporary.is_file(),'committed writer deleted foreign file')
            self.assertEqual(temporary.read_text(),'foreign writer')

    def test_shared_writer_cleanup_requires_its_created_inode(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/diagnostics.NAME;temporary=root/'.storage-diagnostic.new';held=[]
            primary=OSError('owned commit failure')
            def refuse(source,destination):
                held.append(os.open(source,os.O_RDONLY));source.unlink();source.write_text('foreign writer');raise primary
            try:
                with patch.object(diagnostics.os,'replace',side_effect=refuse):
                    with self.assertRaises(OSError) as caught:diagnostics.write(path,diagnostics.unknown('tracking'),scope='tracking')
                self.assertIs(caught.exception,primary)
                self.assertTrue(temporary.is_file(),'failed writer deleted foreign inode')
                self.assertEqual(temporary.read_text(),'foreign writer')
            finally:
                for fd in held:os.close(fd)
