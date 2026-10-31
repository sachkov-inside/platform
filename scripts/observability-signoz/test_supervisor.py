"""Real owned POSIX process trees, bounded by barriers; no Docker/provider calls."""
import os
import importlib.util
import platform
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import supervisor

CHILD = '''import os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);signal.signal(signal.SIGTERM,signal.SIG_IGN)
child=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'])
(root/'ready').write_text(str(child.pid))
while not (root/'release').exists():time.sleep(.01)
sys.exit(int((root/'release').read_text()))
'''


def barrier(read):
    end = time.monotonic() + 5
    while time.monotonic() < end:
        value = read()
        if value: return value
        time.sleep(.01)
    raise AssertionError('owned_process_barrier_deadline')


def live(pid):
    result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True, timeout=1)
    return result.returncode == 0 and bool(result.stdout.strip()) and not result.stdout.strip().startswith('Z')


class ProcessTree(unittest.TestCase):
    @unittest.skipUnless(platform.system() == 'Linux', 'actual /proc session ownership requires Linux')
    def test_native_session_recovery_after_worker_SIGKILL_reaps_separate_CLI_group(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',Path(__file__).with_name('runtime.py'))
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            # Docker/Compose's separate group, same session, is represented by a benign child.
            program=CHILD.replace("subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'])",
                "subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'],process_group=0)")
            process=subprocess.Popen([sys.executable,'-c',program,tmp],start_new_session=True)
            child=None
            try:
                token=runtime.process_start(process.pid)
                child=int(barrier(lambda:(root/'ready').read_text() if (root/'ready').exists() and (root/'ready').stat().st_size else None))
                os.kill(process.pid,signal.SIGKILL)
                self.assertEqual(supervisor.wait(process,time.monotonic()+5,lambda:False),-signal.SIGKILL)
                self.assertEqual(runtime.process_start(process.pid),token)
                runtime.stop_worker({'pid':process.pid,'group':process.pid,'start_ticks':token})
                process.wait(timeout=1)
                barrier(lambda:not live(child))
            finally:
                supervisor.stop(process)
                if child is not None and live(child):os.kill(child,signal.SIGKILL)

    def test_real_tree_cleanup_after_success_failure_timeout_and_interruption(self):
        for outcome in ('success', 'failure', 'timeout', 'interruption'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); process = subprocess.Popen([sys.executable, '-c', CHILD, tmp],
                    start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                child = None
                try:
                    child = int(barrier(lambda: (root / 'ready').read_text() if (root / 'ready').exists() and (root / 'ready').stat().st_size else None))
                    cancelled = threading.Event()
                    if outcome in ('success', 'failure'): (root / 'release').write_text('0' if outcome == 'success' else '7')
                    if outcome == 'interruption': cancelled.set()
                    deadline = time.monotonic() + (0 if outcome == 'timeout' else 5)
                    result = supervisor.wait(process, deadline, cancelled.is_set)
                    self.assertEqual(result, {'success': 0, 'failure': 7, 'timeout': 124, 'interruption': 130}[outcome])
                finally:
                    supervisor.stop(process)
                    if child is not None: barrier(lambda: not live(child))
                self.assertIsNotNone(process.returncode)
                self.assertFalse(live(process.pid))


if __name__ == '__main__': unittest.main()
