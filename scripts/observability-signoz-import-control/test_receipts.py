"""Real benign owned CLI processes, no Docker or external providers."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-signoz'))
from test_lifecycle import benign_engine
import lifecycle
import receipts

class RawReceipts(unittest.TestCase):
    def test_real_success_has_actual_full_window_and_reaped_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine=benign_engine(Path(tmp));argv=['-c','print("owned")']
            with receipts.observe_raw(engine,argv) as seen:
                self.assertEqual(engine.raw(argv,timeout=3),'owned\n')
            self.assertTrue(seen['available'])
            self.assertEqual(seen['timeout_seconds'],3)
            self.assertGreaterEqual(seen['outer_remaining_seconds'],3)
            self.assertGreaterEqual(seen['finished'],seen['started'])
            self.assertEqual(seen['native_exit'],0);self.assertFalse(engine.child)
            self.assertIsNone(sys.getprofile())


class ReceiptFailures(unittest.TestCase):
    def test_original_exception_and_prior_profiler_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine=benign_engine(Path(tmp));argv=['-c','raise SystemExit(7)']
            caught=None
            try:
                with receipts.observe_raw(engine,argv) as seen:engine.raw(argv,timeout=3)
            except lifecycle.Refusal as error:caught=error
            self.assertEqual(caught.reason,'command_failed')
            self.assertTrue(receipts.full_window(seen))
            self.assertEqual(lifecycle.first_raw_command(caught)['native_exit'],7)
            self.assertFalse(engine.child);self.assertIsNone(sys.getprofile())
            def previous(*_args):pass
            sys.setprofile(previous)
            try:
                with receipts.observe_raw(engine,['-c','pass']) as refused:engine.raw(['-c','pass'],timeout=3)
                self.assertFalse(refused['available']);self.assertIs(sys.getprofile(),previous)
            finally:sys.setprofile(None)

    def test_short_window_duplicate_frame_and_observer_fault_are_unavailable(self):
        import time
        from types import SimpleNamespace
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            engine=benign_engine(Path(tmp));argv=['-c','pass'];engine.deadline=time.monotonic()+1
            with receipts.observe_raw(engine,argv) as short:engine.raw(argv,timeout=3)
            self.assertFalse(receipts.full_window(short))
            engine.deadline=time.monotonic()+5
            with receipts.observe_raw(engine,argv) as duplicate:
                engine.raw(argv,timeout=3);engine.raw(argv,timeout=3)
            self.assertFalse(duplicate['available'])
            def fail():raise RuntimeError('fixture_observer_fault')
            with patch.object(receipts,'time',SimpleNamespace(monotonic=fail)):
                with receipts.observe_raw(engine,argv) as fault:self.assertEqual(engine.raw(argv,timeout=3),'')
            self.assertFalse(fault['available']);self.assertIsNone(sys.getprofile());self.assertFalse(engine.child)

if __name__=='__main__':unittest.main()
