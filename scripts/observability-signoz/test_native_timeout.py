"""Real owned Python helpers distinguish native exit, pipe timeout and cancellation."""
import json,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
import lifecycle
from test_lifecycle import benign_engine
from test_oci_admission import fixture,Native,container_fixture

class Feedback(unittest.TestCase):
 def owned(self,root,mode):
  lock,row,image=fixture();native=Native(image);own,value=container_fixture(native,row,image,root)
  (root/'container.json').write_text(json.dumps(value));(root/'mode').write_text(mode)
  helper=root/'helper';helper.write_text('#!'+sys.executable+'\n'+'''import json,sys,time,subprocess,os
from pathlib import Path
r=Path(__file__).parent;args=sys.argv[1:];mode=(r/'mode').read_text()
with (r/'pids').open('a') as f:f.write(str(os.getpid())+'\\n')
if args and args[0]=='identity':
 if mode=='preflight_blocked':(r/'blocked').touch();time.sleep(30)
 print('identity');raise SystemExit
args=args[4:]
if args[0]=='inspect':print(json.dumps([json.loads((r/'container.json').read_text())]));raise SystemExit
if mode=='probe_sleep':(r/'blocked').touch();time.sleep(30)
if mode=='probe_pipe':
 child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
 with (r/'pids').open('a') as f:f.write(str(child.pid)+'\\n')
 (r/'blocked').touch()
 raise SystemExit
if mode=='probe_exit':raise SystemExit(7)
print(json.dumps(dict(fsid=1,device=2,block=4096,blocks=25000000,available=23000000,files=0,free_files=0)))
''');helper.chmod(0o700)
  engine=benign_engine(root);engine.invocation=helper;engine.cli=helper.resolve();st=helper.lstat();engine.invocation_identity=(st.st_dev,st.st_ino,st.st_mode,str(engine.cli));engine.cli_hash=lifecycle.digest(helper);engine.identity={'owned':'fixture'};engine.endpoint='fixture';engine.anon=root;engine.image_proofs=native.image_proofs
  def identify():engine.raw(['identity'],timeout=2);return engine.identity
  engine.identify=identify;own.engine=engine;return engine,own
 def no_live(self,root):
  if not (root/'pids').exists():return
  import subprocess
  for pid in set((root/'pids').read_text().split()):
   r=subprocess.run(['ps','-o','stat=','-p',pid],capture_output=True,text=True)
   self.assertTrue(r.returncode or not r.stdout.strip() or r.stdout.lstrip().startswith('Z'),('owned PID live',pid))
 def test_real_owned_exec_distinguishes_native_exit_and_pipe_deadline(self):
  for mode,reason in [('valid',None),('preflight_blocked','command_deadline'),('probe_sleep','command_deadline'),('probe_pipe','command_deadline'),('probe_exit','command_failed')]:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);engine,own=self.owned(root,mode)
    try:
     seen=None;value=None
     real_monotonic=time.monotonic
     def fixture_clock():
      # Advance only after the actual owned helper reaches its blocked stage.
      # The inherited-pipe case also requires its native leader to have exited.
      blocked=(root/'blocked').exists()
      if mode=='probe_pipe':
       with engine.lock:blocked=blocked and any(proc.poll()==0 for proc in engine.child)
      return real_monotonic()+(20 if blocked else 0)
     try:
      with patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=fixture_clock)):
       value=own.exec(['disk'],timeout=2)
     except BaseException as error:seen=str(error)
     print(json.dumps({'case':mode,'expected_reason':reason,'actual_reason':seen,'native':json.loads((root/'failure.json').read_text()) if (root/'failure.json').exists() else None}),flush=True)
     self.assertEqual(seen,reason)
     if reason is None:self.assertEqual(set(json.loads(value)),{'fsid','device','block','blocks','available','files','free_files'})
     self.assertFalse(engine.child);self.no_live(root)
    finally:engine.cancel_children()
 def test_owned_cancel_before_deadline_is_not_false_monitor_timeout(self):
  self.race("early")
 def test_owned_cancel_after_deadline_keeps_genuine_timeout(self):
  self.race("late")
 def test_tie_no_owned_request_or_other_thread_cannot_hide_deadline(self):
  for mode in ('tie','no_cancel','wrong_thread','repeat','returned_early','returned_late'):
   with self.subTest(mode=mode):self.race(mode)
 def race(self,mode):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);engine=benign_engine(root);engine.monitor_stop=threading.Event();entered=threading.Event();release=threading.Event();caught=[];real_selector=lifecycle.selectors.DefaultSelector;virtual=[1000.];engine.deadline=1005.
   class Selector:
    def __init__(self):self.inner=real_selector();self.first=True
    def register(self,*a):return self.inner.register(*a)
    def unregister(self,*a):return self.inner.unregister(*a)
    def get_map(self):return self.inner.get_map()
    def close(self):return self.inner.close()
    def select(self,*a):
     if self.first:
      self.first=False;entered.set();release.wait(2)
      if mode.startswith('returned_'):return [(key,1) for key in list(self.inner.get_map().values())]
      return []
     return self.inner.select(*a)
   def monotonic():return virtual[0]
   def worker():
    try:engine.raw(['-c','import time;time.sleep(30)'],timeout=.3)
    except BaseException as error:caught.append(error)
   t=threading.Thread(target=worker,name='other-fixture' if mode=='wrong_thread' else 'owned-signoz-storage')
   try:
    with patch.object(lifecycle.selectors,'DefaultSelector',Selector),patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=monotonic)):
     t.start();self.assertTrue(entered.wait(2))
     if mode in ('late','returned_late'):virtual[0]=1001.
     elif mode=='tie':virtual[0]=1000.3
     engine.monitor_stop.set()
     if mode!='no_cancel':engine.cancel_children()
     if mode=='repeat':
      virtual[0]=1001.;engine.cancel_children()
      self.assertTrue(all(value==1000. for value in engine.cancel_requested_at.values()))
     virtual[0]=1001.
     release.set();t.join(2)
    self.assertFalse(t.is_alive());self.assertFalse(engine.child);self.assertEqual(len(caught),1)
    reason=str(caught[0]);expected='monitor_stopping' if mode in ('early','repeat','returned_early') else 'command_failed' if mode=='returned_late' else 'command_deadline'
    print(json.dumps({'case':mode,'reason':reason,'expected':expected}),flush=True)
    self.assertEqual(reason,expected);self.assertFalse(engine.cancel_requested_at);self.assertFalse(engine.cancel_requested)
   finally:release.set();engine.cancel_children();t.join(2)

if __name__=='__main__':unittest.main()
