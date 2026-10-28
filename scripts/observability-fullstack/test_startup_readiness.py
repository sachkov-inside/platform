"""Startup ordering at the real mode boundary, with only native effects controlled."""
from contextlib import ExitStack
import copy
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import fullstack
import startup_refusal


class StartupReadiness(unittest.TestCase):
    def test_mode_waits_for_production_tls_listener_before_starting_backends(self):
        calls=[];listener={'ready':False,'attempts':0}
        def invoke(compose,args,**options):
            calls.append(args)
            if args==['exec','-T','rabbitmq','rabbitmq-diagnostics','-q','check_port_listener','5671']:
                listener['attempts']+=1
                if listener['attempts']==1:raise RuntimeError('not yet listening')
                listener['ready']=True;return ''
            if args[:5]==['up','-d','--force-recreate','--no-deps',*fullstack.BACKENDS[:1]]:
                self.assertTrue(listener['ready'],'application startup must wait for the real AMQPS listener')
            return ''
        with tempfile.TemporaryDirectory() as directory,ExitStack() as patches:
            output=Path(directory)
            # HTTP and workload effects are outside this startup-order contract.
            for target in ('mode','ready','await_sources'):
                patches.enter_context(patch.object(fullstack,target))
            patches.enter_context(patch.object(fullstack.extra,'warmup'))
            patches.enter_context(patch.object(fullstack,'invoke',side_effect=invoke))
            patches.enter_context(patch.object(fullstack.resource_runtime,'invoke',side_effect=invoke))
            active=fullstack.configure_mode(['owned'],output,False)
        self.assertEqual(listener['attempts'],2)
        self.assertEqual(active,fullstack.APPS)
        self.assertIn('test: ["CMD", "rabbitmq-diagnostics", "-q", "check_port_listener", "5671"]',
                      (fullstack.ROOT/'compose.production.yaml').read_text())

    def test_actual_failed_native_health_probe_retains_closed_first_refusal(self):
        project='inside-observability-fullstack-'+'a'*12
        primary=RuntimeError('primary_wait_refused')
        ids={'notifications-worker':'b'*64,'rabbitmq':'c'*64}
        def run(args,**options):
            if args[-2:]==['node','dist/infrastructure/worker-healthcheck.js'] and 'notifications-worker' in args:
                return subprocess.CompletedProcess(args,7,'private-output','amqps://private-secret@host')
            if 'inspect' in args:
                rows=[dict(id=identity,project=project,service=role,state='exited' if role=='notifications-worker' else 'running',
                           running=role!='notifications-worker',oom=False,exit_code=1 if role=='notifications-worker' else 0,restarts=0)
                      for role,identity in ids.items()]
                return subprocess.CompletedProcess(args,0,'\n'.join(json.dumps(row) for row in rows),'')
            if 'ps' in args:return subprocess.CompletedProcess(args,0,'\n'.join(ids.values()),'')
            return subprocess.CompletedProcess(args,0,'','')
        def awaited(read,predicate,**options):
            result=read()
            if not predicate(result):raise primary
            return result
        with tempfile.TemporaryDirectory() as directory,ExitStack() as patches:
            output=Path(directory);(output/'evidence.json').write_text(json.dumps({'source':'a'*40}))
            compose=['docker','compose','-p',project,'-f',str(output/'compose.json')]
            for target in ('mode','ready','await_sources'):
                patches.enter_context(patch.object(fullstack,target))
            patches.enter_context(patch.object(fullstack.extra,'warmup'))
            patches.enter_context(patch.object(fullstack.pilot,'assert_docker_identity'))
            patches.enter_context(patch.object(fullstack.pilot,'await_fact',side_effect=awaited))
            patches.enter_context(patch.object(fullstack.subprocess,'run',side_effect=run))
            with self.assertRaises(RuntimeError) as caught:fullstack.configure_mode(compose,output,False)
            self.assertIs(caught.exception,primary)
            path=output/'fullstack-startup-refusal.json'
            self.assertTrue(path.exists(),'real native health refusal must survive until public collection')
            value=json.loads(path.read_text())
            self.assertEqual(value['role'],'notifications-worker')
            self.assertEqual(value['probe'],{'reason':'exit_nonzero','exit_code':7})
            self.assertEqual(value['containers']['notifications-worker'],dict(state='exited',running=False,oom=False,exit_code=1,restarts=0))
            self.assertNotIn('private',path.read_text());self.assertNotIn(ids['notifications-worker'],path.read_text())

    def refusal(self):
        return dict(schema=1,source='a'*40,role='notifications-worker',
                    probe=dict(reason='exit_nonzero',exit_code=7),
                    containers={role:dict(state='exited' if role=='notifications-worker' else 'running',
                                         running=role!='notifications-worker',oom=False,exit_code=1 if role=='notifications-worker' else 0,restarts=0)
                                for role in ('notifications-worker','rabbitmq')})

    def test_both_collectors_validate_closed_source_bound_refusal_before_publication(self):
        value=self.refusal();source='a'*40
        bads=[{**value,'raw':'private-sentinel'},{**value,'source':'b'*40},{**value,'role':'foreign'},
              {**value,'schema':True},{**value,'probe':{'reason':'private-sentinel','exit_code':7}},
              {**value,'probe':{'reason':'exit_nonzero','exit_code':0}},
              {**value,'probe':{'reason':'timeout','exit_code':7}},
              {**value,'probe':{'reason':'output_limit','exit_code':7}},
              {**value,'probe':{'reason':'exit_nonzero','exit_code':True}},
              {**value,'probe':{'reason':'exit_nonzero','exit_code':float('nan')}},
              {**value,'containers':{'notifications-worker':{'state':'unavailable'}}}]
        for field,invalid in [('state','private-sentinel'),('exit_code',float('inf')),('oom',1),('id','private-sentinel')]:
            bad=copy.deepcopy(value);bad['containers']['notifications-worker'][field]=invalid;bads.append(bad)
        for collector in (fullstack.collect,fullstack.stability_collect):
            with self.subTest(collector=collector.__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);output=root/'private';output.mkdir();metadata=root/'metadata';metadata.mkdir()
                path=output/startup_refusal.NAME
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{})):
                    for bad in bads:
                        path.write_text(json.dumps(bad))
                        with self.assertRaises(ValueError),patch.object(fullstack.resource_runtime.ci,'collect',side_effect=AssertionError('unsafe copy')):
                            collector(output,metadata,root/'public')
                    for wire in ('{"schema":1,"schema":1}',json.dumps(value)+' '*4096):
                        path.write_text(wire)
                        with self.assertRaises(ValueError):collector(output,metadata,root/'public')
                    path.unlink();target=root/'target';target.write_text(json.dumps(value));path.symlink_to(target)
                    with self.assertRaises(OSError):collector(output,metadata,root/'public')
                    path.unlink();path.write_text(json.dumps(value));collector(output,metadata,root/'public')
                    self.assertEqual(json.loads((root/'public'/startup_refusal.NAME).read_text()),value)

    def test_first_refusal_stays_sticky_and_failed_observer_preserves_primary(self):
        primary=RuntimeError('original readiness refusal')
        for fault in ('inspect','write'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                output=Path(directory);(output/'evidence.json').write_text(json.dumps({'source':'a'*40}))
                first=self.refusal();startup_refusal.write(output,first,'a'*40,fullstack.BACKENDS)
                with self.assertRaises(FileExistsError):startup_refusal.write(output,first,'a'*40,fullstack.BACKENDS)
                with patch.object(fullstack,'invoke',side_effect=subprocess.TimeoutExpired('private-command',5,stderr='private-error')),\
                     patch.object(fullstack.pilot,'await_fact',side_effect=lambda read,predicate,**opts:(read(),(_ for _ in ()).throw(primary))[1]),\
                     patch.object(fullstack,'readiness_containers',side_effect=KeyboardInterrupt() if fault=='inspect' else None,return_value=first['containers']):
                    with self.assertRaises(RuntimeError) as caught:
                        fullstack.await_startup_role([],output,'notifications-worker',['node','dist/infrastructure/worker-healthcheck.js'])
                    self.assertIs(caught.exception,primary)
                self.assertEqual(startup_refusal.read(output,'a'*40,fullstack.BACKENDS),first)

    def test_shared_native_failure_retains_only_bounded_numeric_outcome(self):
        for code,stdout,reason in ((7,'private-output','exit_nonzero'),(0,'x'*1_048_577,'output_limit')):
            with self.subTest(code=code),patch.object(fullstack.pilot,'assert_docker_identity'),\
                 patch.object(fullstack.subprocess,'run',return_value=subprocess.CompletedProcess(['private-command'],code,stdout,'private-error')):
                with self.assertRaises(fullstack.resource_runtime.CommandFailure) as caught:
                    fullstack.resource_runtime.invoke(['docker'],['native'])
                error=caught.exception
                self.assertEqual(str(error),'resource_command_failed')
                self.assertEqual(vars(error),{'reason':reason,'exit_code':code})

if __name__=='__main__':unittest.main()
