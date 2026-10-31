"""Native CLI boundary faults use owned benign Python children, never Docker."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import lifecycle


def benign_engine(directory):
    engine=lifecycle.Engine.__new__(lifecycle.Engine)
    engine.run=directory;engine.deadline=time.monotonic()+5
    engine.invocation=Path(sys.executable);engine.cli=engine.invocation.resolve(strict=True)
    native=engine.invocation.lstat()
    engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli))
    engine.cli_hash=lifecycle.digest(engine.cli);engine.plugin=None
    engine.lock=threading.RLock();engine.child=set();engine.child_threads={};engine.cancel_requested=set();engine.cancel_requested_at={}
    return engine


class NativeFaults(unittest.TestCase):
    def test_role_inventory_rejects_missing_extra_and_duplicate_image_pins(self):
        original=lifecycle.verify_packet()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in original['config_sha256']:(root/name).write_bytes((lifecycle.CONFIG/name).read_bytes())
            for pins in (original['images'][:-1],original['images']+[dict(original['images'][0],repository='docker.io/foreign/image')],original['images']+[original['images'][0]]):
                lifecycle.private_json(root/'inputs.lock.json',{**original,'images':pins})
                with patch.object(lifecycle,'CONFIG',root),self.assertRaisesRegex(lifecycle.Refusal,'complete_role_image_coverage'):
                    lifecycle.verify_packet()

    def test_complete_final_role_health_requires_exited_init_live_backends_and_no_restart(self):
        roles={'volume-init','disk','histogram-init','keeper','postgres','clickhouse','migrator','collector','server','mcp','agent'}
        states={role:{'exit_code':0,'running':role not in ('volume-init','histogram-init','migrator'),'oom_killed':False,'restart_count':0} for role in roles}
        self.assertTrue(lifecycle.healthy_states(states))
        for role,field,value in [('agent','running',False),('migrator','exit_code',1),('server','running',False),('mcp','oom_killed',True),('collector','restart_count',1),('disk','restart_count',False)]:
            with self.subTest(role=role,field=field):
                self.assertFalse(lifecycle.healthy_states({**states,role:{**states[role],field:value}}))
        self.assertFalse(lifecycle.healthy_states({k:v for k,v in states.items() if k!='agent'}))

    def test_genuine_exit_and_bounded_private_bytes_precede_process_reap(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);engine=benign_engine(directory)
            with self.assertRaises(lifecycle.Refusal):
                engine.raw(['-c',"import sys;sys.stderr.write('private-key-DSN-query');sys.exit(7)"])
            record=json.loads((directory/'failure.json').read_text())
            self.assertEqual(record['native_exit'],7);self.assertFalse(record['alive_before_reap'])
            self.assertEqual(record['stderr_bytes'],21)
            self.assertEqual((directory/'failure-1-stderr.private').stat().st_mode & 0o777,0o600)
            self.assertNotIn('private-key',json.dumps(record));self.assertFalse(engine.child)

    def test_deadline_retains_unknown_native_exit_and_reaps_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);engine=benign_engine(directory)
            with self.assertRaises(lifecycle.Refusal):engine.raw(['-c','import time;time.sleep(30)'],timeout=.1)
            record=json.loads((directory/'failure.json').read_text())
            self.assertIsNone(record['native_exit']);self.assertTrue(record['alive_before_reap'])
            self.assertFalse(engine.child)

    def test_changed_created_identity_refuses_native_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            project='signoz1566-'+'1'*12;nonce='2'*32;cid='3'*64
            class Native:
                def __init__(self):self.removed=[]
                def call(self,args,timeout=10):
                    if args[0]=='rm':self.removed.append(args);return ''
                    if args[:2]==['ps','-aq'] and '--no-trunc' in args:return cid
                    return ''
                def inspect(self,kind,identity):
                    return {'Id':cid,'Created':'replacement','Config':{'Labels':{**lifecycle.labels(project,nonce),'inside.monitoring.service':'server'}}}
            native=Native();owned=lifecycle.Owned(native,Path(tmp),{},project,nonce)
            owned.plan=lifecycle.make_plan(Path(tmp),lifecycle.verify_packet()['images'],project,nonce,1001,1001)
            owned.containers={'server':cid};owned.created={'server':'original'}
            self.assertFalse(owned.cleanup_exact())
            self.assertEqual(native.removed,[])
            receipt=json.loads((Path(tmp)/'cleanup.json').read_text())
            self.assertFalse(receipt['passed'])

    def test_atomic_private_receipt_rejects_symlink_without_modifying_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/'foreign';target.write_text('keep')
            (root/'receipt').symlink_to(target)
            with self.assertRaises(lifecycle.Refusal):lifecycle.private_json(root/'receipt',{'bad':1})
            self.assertEqual(target.read_text(),'keep')


if __name__ == '__main__':unittest.main()
