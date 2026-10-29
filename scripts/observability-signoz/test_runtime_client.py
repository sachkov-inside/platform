"""The real functional coordinator routes readiness without using disk CPU."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import agent_probe
import lifecycle
import runtime


IDENTITY={'device':1,'inode':2,'uid':1001,'gid':1001,'mode':0o600,'links':1}


class ClientBoundary:
    """Only the external container commands and native /proc observations are controlled."""
    def __init__(self,root,replies):
        self.root=root;self.replies=iter(replies);self.engine=self
        self.deadline=time.monotonic()+5;self.containers={'agent':'agent-cid','disk':'disk-cid'}
        self.plan={'networks':{'backend':{'name':'owned-backend'}}}
        self.entered=threading.Event();self.release=threading.Event();self.polls=[];self.client_calls=0
        self.cancelled=[];self.delivered=[];self.functional_error=None;self.functional_thread=None
    def start(self,*names):raise AssertionError('agent must already be started during acquisition')
    def validate(self,role):
        return {'State':{'Pid':10101 if role=='agent' else 20202},
            'NetworkSettings':{'Networks':{'owned-backend':{'IPAddress':'172.20.0.2'}}}}
    def exec(self,args,timeout):
        if args==['functional']:
            self.functional_thread=threading.current_thread();self.entered.set()
            if not self.release.wait(2):raise AssertionError('controlled functional was not released')
            if self.functional_error is not None:raise self.functional_error
            return '{"functional":1}'
        if args[0]=='agent-result':
            self.delivered.append(json.loads(args[1]));self.release.set();return '{"stored":1}'
        raise AssertionError('readiness exec must not compete in disk cgroup: '+str(args))
    def call(self,args,timeout):
        if args==['exec','agent-cid','python','-B','/driver/agent_probe.py','socket-identity']:
            assert self.entered.wait(1);assert timeout==10
            self.polls.append(args);reply=next(self.replies)
            if callable(reply):reply=reply()
            if isinstance(reply,BaseException):raise reply
            return reply
        assert args==['exec','agent-cid','python','-B','/driver/agent_probe.py']
        self.client_calls+=1
        config=json.loads((self.root/'agent-admission/fixture.json').read_text())
        return json.dumps({'schema':1,'nonce':config['nonce'],'reads':4,'gateway_denials':9,
            'backend_denials':sum(map(len,agent_probe.ENDPOINTS.values())),'filesystem_isolated':1,
            'namespace_inode':123,'socket_inode':2,'socket_device':1,
            'dns_noname':0,'dns_unavailable':1,'dns_resolved':0})
    def cancel_thread_children(self,thread):
        self.cancelled.append(thread);self.release.set()


class FunctionalClient(unittest.TestCase):
    def invoke(self,root,boundary,changed_namespace=None,changed_birth=False):
        readlink=os.readlink
        births=iter(('original','changed')) if changed_birth else None
        def namespace(path,*args,**kwargs):
            values={'/proc/10101/ns/net':'net:[123]','/proc/20202/ns/net':'net:[456]',
                '/proc/self/ns/net':'net:[789]'}
            if changed_namespace=='before':values['/proc/10101/ns/net']='net:[456]'
            if changed_namespace=='after' and boundary.client_calls:values['/proc/10101/ns/net']='net:[124]'
            return values[path] if path in values else readlink(path,*args,**kwargs)
        def birth(_pid):return next(births) if births is not None else 'original-birth'
        with patch.object(runtime,'process_start',side_effect=birth),patch.object(runtime.os,'readlink',side_effect=namespace):
            return runtime.functional_with_client(boundary,root,3)
    def prepared(self,root,replies):
        (root/'private').mkdir();(root/'agent-admission').mkdir()
        return ClientBoundary(root,replies)
    def assert_reaped(self,boundary):
        self.assertIsNotNone(boundary.functional_thread)
        self.assertFalse(boundary.functional_thread.is_alive())
        self.assertFalse(any(t.name=='owned-signoz-functional' for t in threading.enumerate()))
    def test_actual_coordinator_polls_only_agent_and_delivers_result_to_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);boundary=self.prepared(root,['{"available":false}',json.dumps({'available':True,'identity':IDENTITY})])
            try:
                self.assertEqual(self.invoke(root,boundary),{'functional':1})
                self.assertEqual(len(boundary.polls),2);self.assertEqual(boundary.client_calls,1)
                self.assertEqual(len(boundary.delivered),1);self.assertEqual(boundary.cancelled,[])
                self.assertEqual(json.loads((root/'isolation.json').read_text())['socket_identity'],IDENTITY)
                self.assert_reaped(boundary)
            finally:boundary.release.set()

    def test_polling_failure_keeps_original_error_and_reaps_actual_functional_thread(self):
        primary=lifecycle.Refusal('command_deadline')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);boundary=self.prepared(root,[primary])
            try:
                with self.assertRaises(lifecycle.Refusal) as caught:self.invoke(root,boundary)
                self.assertIs(caught.exception,primary)
                self.assertEqual(boundary.cancelled,[boundary.functional_thread])
                self.assertEqual(boundary.client_calls,0);self.assertEqual(boundary.delivered,[])
                self.assertFalse((root/'agent-admission/fixture.json').exists());self.assert_reaped(boundary)
            finally:boundary.release.set()

    def test_functional_failure_is_not_replaced_by_unavailable_poll(self):
        primary=RuntimeError('original functional error')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);boundary=self.prepared(root,[]);boundary.functional_error=primary
            def fail_functional():
                boundary.release.set();boundary.functional_thread.join(timeout=1)
                self.assertFalse(boundary.functional_thread.is_alive())
                return '{"available":false}'
            boundary.replies=iter([fail_functional])
            try:
                with self.assertRaises(RuntimeError) as caught:self.invoke(root,boundary)
                self.assertIs(caught.exception,primary);self.assertEqual(boundary.client_calls,0)
                self.assert_reaped(boundary)
            finally:boundary.release.set()

    def test_closed_identity_failures_never_admit_or_run_client(self):
        for reply in ('[]','{"available":1}','{"available":false,"extra":1}',
            '{"available":true}', '{"agent_failed":1}',
            '{"available":false,"available":true}',
            json.dumps({'available':True,'identity':{**IDENTITY,'inode':True}}),
            json.dumps({'available':True,'identity':{**IDENTITY,'extra':1}})):
            with self.subTest(reply=reply),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);boundary=self.prepared(root,[reply])
                try:
                    with self.assertRaises((ValueError,lifecycle.Refusal)):self.invoke(root,boundary)
                    self.assertEqual(boundary.client_calls,0);self.assertEqual(boundary.delivered,[])
                    self.assertFalse((root/'agent-admission/fixture.json').exists());self.assert_reaped(boundary)
                finally:boundary.release.set()

    def test_original_namespace_boundary_refuses_replacement_before_and_after_client(self):
        for mode,birth,client_calls in [('before',False,0),('after',False,1),(None,True,0)]:
            with self.subTest(mode=mode,birth=birth),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);boundary=self.prepared(root,[json.dumps({'available':True,'identity':IDENTITY})])
                try:
                    with self.assertRaisesRegex(lifecycle.Refusal,'native_namespace_changed'):
                        self.invoke(root,boundary,mode,birth)
                    self.assertEqual(boundary.client_calls,client_calls);self.assertEqual(boundary.delivered,[])
                    self.assert_reaped(boundary)
                finally:boundary.release.set()


if __name__=='__main__':unittest.main()
