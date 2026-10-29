"""Worker signal scope only; no native host, Docker or provider work."""
from contextlib import contextmanager
from pathlib import Path
import signal
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

import disk_component as component


class WorkerSignalScope(unittest.TestCase):
    def setUp(self):
        self.previous={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT)}
        # This harness must restore the enclosing verifier even on the pristine RED.
        self.addCleanup(self.restore_signals)

    def restore_signals(self):
        for signum,handler in self.previous.items():signal.signal(signum,handler)

    def assert_signals_restored(self):
        for signum,handler in self.previous.items():
            with self.subTest(signal=signum.name):self.assertIs(signal.getsignal(signum),handler)

    @contextmanager
    def worker_fixture(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(component.runtime,'require_native_host'),\
            patch.object(component,'require_opt_in'),\
            patch.object(component,'registered_phase',return_value=({}, {}, time.monotonic()+90)),\
            patch.object(component.runtime,'recover',return_value={'passed':True}) as recover,\
            patch.object(component,'component_engine') as engine,\
            patch.object(component,'prepare') as prepare,patch.object(component,'measure') as measure:
            engine.return_value=SimpleNamespace(cancel_children=Mock())
            yield Path(tmp),recover,engine,prepare,measure

    def test_cleanup_preflight_failure_preserves_exception_traceback_and_enclosing_handlers(self):
        error=ValueError('benign_preflight_refusal');frames=[]
        def refuse(*_args):
            try:raise error
            except ValueError:
                frames.append(error.__traceback__);raise
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);(output/'owner.json').write_text('{}')
            with patch.object(component.runtime,'require_native_host'),\
                patch.object(component,'registered_phase',return_value=({}, {}, time.monotonic()+90)),\
                patch.object(component,'recovery_preflight',side_effect=refuse),\
                patch.object(component.runtime,'recover',side_effect=AssertionError('native recovery forbidden')):
                try:component.worker(output,'cleanup')
                except ValueError as caught:
                    self.assertIs(caught,error)
                    frame=caught.__traceback__;observed=[]
                    while frame is not None:observed.append(frame);frame=frame.tb_next
                    self.assertIn(frames[0],observed)
                else:self.fail('cleanup preflight must refuse')
            self.assert_signals_restored()

    def test_success_and_failed_cleanup_result_restore_custom_handlers(self):
        def enclosing(*_args):pass
        for signum in self.previous:signal.signal(signum,enclosing)
        for passed in (True,False):
            with self.subTest(passed=passed),self.worker_fixture() as (output,recover,*_rest):
                recover.return_value={'passed':passed}
                self.assertEqual(component.worker(output,'cleanup'),0 if passed else 1)
                for signum in self.previous:self.assertIs(signal.getsignal(signum),enclosing)

    def test_cleanup_recovery_and_report_failures_restore_handlers(self):
        for boundary in ('recovery','report'):
            error=OSError('benign_'+boundary)
            with self.subTest(boundary=boundary),self.worker_fixture() as (output,recover,*_rest):
                if boundary=='recovery':recover.side_effect=error
                with patch.object(component.lifecycle,'private_json',side_effect=error if boundary=='report' else None):
                    with self.assertRaises(OSError) as caught:component.worker(output,'cleanup')
                self.assertIs(caught.exception,error);self.assert_signals_restored()

    def test_setup_and_measure_restore_handlers_on_success_engine_body_and_finalizer_failure(self):
        for phase in ('setup','measure'):
            for boundary in ('success','engine','body','finalizer'):
                error=RuntimeError('benign_'+boundary)
                with self.subTest(phase=phase,boundary=boundary),self.worker_fixture() as (output,_recover,engine,prepare,measure):
                    if boundary=='engine':engine.side_effect=error
                    if boundary=='body':(prepare if phase=='setup' else measure).side_effect=error
                    if boundary=='finalizer':engine.return_value.cancel_children.side_effect=error
                    if boundary=='success':self.assertEqual(component.worker(output,phase),0)
                    else:
                        with self.assertRaises(RuntimeError) as caught:component.worker(output,phase)
                        self.assertIs(caught.exception,error)
                    self.assert_signals_restored()

    def test_partial_registration_failure_restores_preceding_handler_and_keeps_first_traceback(self):
        original=signal.signal;error=ValueError('benign_partial_registration');frames=[]
        def register(signum,handler):
            if signum==signal.SIGINT and handler is not self.previous[signum]:
                try:raise error
                except ValueError:frames.append(error.__traceback__);raise
            return original(signum,handler)
        with self.worker_fixture() as (output,*_rest),patch.object(component.signal,'signal',side_effect=register):
            try:component.worker(output,'cleanup')
            except ValueError as caught:
                self.assertIs(caught,error)
                frame=caught.__traceback__;observed=[]
                while frame is not None:observed.append(frame);frame=frame.tb_next
                self.assertIn(frames[0],observed)
            else:self.fail('partial signal registration must refuse')
            self.assert_signals_restored()

    def test_restore_attempts_both_handlers_and_does_not_replace_active_failure(self):
        original=signal.signal
        for body_fails in (False,True):
            error=ValueError('benign_body');secondary=OSError('benign_signal_restore');frames=[];restored=[]
            def fail_body(*_args,**_kwargs):
                try:raise error
                except ValueError:frames.append(error.__traceback__);raise
            def restore(signum,handler):
                result=original(signum,handler)
                if handler is self.previous[signum]:
                    restored.append(signum)
                    if signum==signal.SIGTERM:raise secondary
                return result
            with self.subTest(body_fails=body_fails),self.worker_fixture() as (output,recover,*_rest):
                if body_fails:recover.side_effect=fail_body
                with patch.object(component.signal,'signal',side_effect=restore):
                    try:component.worker(output,'cleanup')
                    except (ValueError,OSError) as caught:
                        self.assertIs(caught,error if body_fails else secondary)
                        if body_fails:
                            frame=caught.__traceback__;observed=[]
                            while frame is not None:observed.append(frame);frame=frame.tb_next
                            self.assertIn(frames[0],observed)
                    else:self.fail('first failure must propagate')
                self.assertEqual(restored,[signal.SIGTERM,signal.SIGINT]);self.assert_signals_restored()

    def test_worker_interrupt_handler_still_refuses_and_restores_enclosing_handlers(self):
        for signum in self.previous:
            with self.subTest(signal=signum.name),self.worker_fixture() as (output,recover,*_rest):
                recover.side_effect=lambda *_args,**_kwargs:signal.getsignal(signum)(signum,None)
                with self.assertRaisesRegex(component.lifecycle.Refusal,'^component_interrupted$'):
                    component.worker(output,'cleanup')
                self.assert_signals_restored()

    def test_restore_failure_propagates_even_when_caller_is_handling_an_unrelated_exception(self):
        original=signal.signal;error=OSError('benign_signal_restore')
        def restore(signum,handler):
            result=original(signum,handler)
            if signum==signal.SIGTERM and handler is self.previous[signum]:raise error
            return result
        with self.worker_fixture() as (output,*_rest),patch.object(component.signal,'signal',side_effect=restore):
            try:raise ValueError('unrelated_caller_exception')
            except ValueError:
                with self.assertRaises(OSError) as caught:component.worker(output,'cleanup')
                self.assertIs(caught.exception,error)
            self.assert_signals_restored()


if __name__=='__main__':unittest.main()
