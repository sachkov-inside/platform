"""Actual tooling owner interruption, escaped sessions and a foreign sentinel."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/heavy-check'))
from processes import process_row,process_snapshot


def wait_for(read,seconds=12):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        value=read()
        if value:return value
        time.sleep(.02)
    raise AssertionError('wrapper_owned_boundary_deadline')


def live(pid):
    row=process_row(pid)
    return row is not None and row[2]!='Z'


@unittest.skipIf(os.environ.get('SIGNOZ_WRAPPER_FIXTURE'), 'no recursive wrapper faults')
class WrapperBoundary(unittest.TestCase):
    def test_verification_entry_reaps_all_sessions_after_exit_failure_timeout_and_owner_death(self):
        for action in ('success','failure','timeout','interruption','owner_KILL'):
            with self.subTest(action=action),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);pids=[];births={}
                foreign=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(60)'],start_new_session=True)
                args=['-B',str(Path(__file__).with_name('test_wrapper_fixture.py'))]
                program=("import{verify}from"+json.dumps((ROOT/'scripts/observability-signoz/verify.mjs').as_uri())+";"
                    +"import{writeFileSync}from'node:fs';const result=await verify({args:"+json.dumps(args)
                    +",timeoutMs:"+('3000' if action=='timeout' else '30000')+"});writeFileSync("
                    +json.dumps(str(root/'outcome.json'))+",JSON.stringify(result));")
                owner=subprocess.Popen(['node','--input-type=module','-e',program],cwd=ROOT,
                    env={**os.environ,'SIGNOZ_WRAPPER_FIXTURE':tmp,'SIGNOZ_WRAPPER_RESIST':'1' if action not in ('success','failure') else '0'},start_new_session=True,
                    stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                try:
                    pids=wait_for(lambda:json.loads((root/'ready.json').read_text()) if (root/'ready.json').exists() and (root/'ready.json').stat().st_size else None)
                    snapshot=process_snapshot();owned={owner.pid,*pids}
                    while True:
                        added={pid for pid,row in snapshot.items() if row[0] in owned}-owned
                        if not added:break
                        owned.update(added)
                    pids=list(owned);births={pid:snapshot[pid][3] for pid in pids if pid in snapshot}
                    if action in ('success','failure'):(root/'release').write_text(action)
                    if action=='interruption':os.kill(owner.pid,signal.SIGTERM)
                    if action=='owner_KILL':os.kill(owner.pid,signal.SIGKILL)
                    owner.wait(timeout=9)
                    wait_for(lambda:all(not live(pid) for pid in pids),seconds=7)
                    self.assertTrue(live(foreign.pid))
                    if action!='owner_KILL':
                        result=json.loads((root/'outcome.json').read_text())
                        self.assertEqual(result['reason'],{'success':'exit','failure':'exit','timeout':'timeout','interruption':'interrupted'}[action])
                        if action in ('success','failure'):self.assertEqual(result['code'],0 if action=='success' else 1)
                finally:
                    for pid in reversed(pids):
                        row=process_row(pid)
                        if row is not None and row[3]==births.get(pid):
                            try:os.kill(pid,signal.SIGKILL)
                            except ProcessLookupError:pass
                    if owner.poll() is None:os.killpg(owner.pid,signal.SIGKILL)
                    owner.wait(timeout=2);foreign.kill();foreign.wait(timeout=2)

    def test_tooling_owner_SIGTERM_cleans_escaped_sessions_and_preserves_foreign(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);pids=[];births={}
            foreign=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(60)'],start_new_session=True)
            owner=subprocess.Popen(['node','--test','scripts/observability-signoz.test.mjs'],cwd=ROOT,
                # A nested CLI is a new test run, preserving all ownership markers.
                # Inheriting Node's private worker context silently skips its files.
                env={**{k:v for k,v in os.environ.items() if k!='NODE_TEST_CONTEXT'},'SIGNOZ_WRAPPER_FIXTURE':tmp},start_new_session=True,
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                pids=wait_for(lambda:json.loads((root/'ready.json').read_text()) if (root/'ready.json').exists() and (root/'ready.json').stat().st_size else None)
                births={pid:process_row(pid)[3] for pid in pids}
                os.kill(owner.pid,signal.SIGTERM);owner.wait(timeout=5)
                wait_for(lambda:all(not live(pid) for pid in pids),seconds=7)
                self.assertTrue(live(foreign.pid))
            finally:
                # The regression harness itself preserves native birth identity before
                # emergency cleanup. Never signal an observed replacement or sentinel.
                for pid in reversed(pids):
                    row=process_row(pid)
                    if row is not None and row[3]==births.get(pid):
                        try:os.kill(pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                if owner.poll() is None:os.killpg(owner.pid,signal.SIGKILL)
                owner.wait(timeout=2);foreign.kill();foreign.wait(timeout=2)


if __name__=='__main__':unittest.main()
