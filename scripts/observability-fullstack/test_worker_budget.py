"""The technical corpus alone receives a longer, source-bound worker clock."""
from contextlib import ExitStack, nullcontext, redirect_stdout
import copy
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import fullstack
import stage_timing
import test_technical_scope

SOURCE='a'*40


class WorkerBudget(unittest.TestCase):
    def test_real_owned_supervisor_retains_timeout_and_sticky_monitor_failure(self):
        pilot=fullstack.pilot
        fixture=fullstack.HERE.parent/'observability-pilot/fixtures/process.py'
        for mode,expected in (('success',0),('failure',7),('timeout',124),('monitor',1)):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                output=Path(directory);(output/'foreign-resource').write_text('foreign')
                program='''import os,signal,sys
from pathlib import Path
output=Path(sys.argv[1]);mode=sys.argv[2]
if mode=='timeout':signal.signal(signal.SIGTERM,signal.SIG_IGN)
(output/'owned-resource').write_text('owned')
if mode=='monitor':os.kill(os.getppid(),signal.SIGUSR1)
if mode=='timeout':signal.pause()
sys.exit(7 if mode=='failure' else 0)
'''
                samples=[]
                def clock():
                    samples.append(None)
                    if len(samples)==2:
                        until=time.monotonic()+3
                        while not (output/'owned-resource').exists():
                            if time.monotonic()>=until:raise AssertionError('owned child did not start')
                            time.sleep(.01)
                    return 0 if len(samples)<=2 else 901
                started=time.monotonic()
                with ExitStack() as patches:
                    # Prior protocol cases can retain frozen daemon observations.
                    # This native command fixture owns no daemon or Docker identity.
                    patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',None))
                    patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_IDENTITY',None))
                    if mode=='timeout':patches.enter_context(patch.object(pilot,'time',SimpleNamespace(monotonic=clock)))
                    status=pilot.supervise_worker([sys.executable,'-c',program,str(output),mode],
                        [sys.executable,str(fixture),'compose',directory,'normal'],output,'inside-observability-pilot-fixture',
                        docker=[sys.executable,str(fixture),'docker',directory,'normal'],deadline_seconds=900)
                self.assertEqual(status,expected)
                self.assertLess(time.monotonic()-started,10)
                registered=json.loads((output/'worker.json').read_text())
                self.assertEqual(registered['deadline_seconds'],900)
                with self.assertRaises(ProcessLookupError):os.kill(registered['pid'],0)
                with self.assertRaises(ProcessLookupError):os.killpg(registered['group'],0)
                outcome=json.loads((output/'worker-outcome.json').read_text())
                self.assertEqual(outcome['exit_code'],expected)
                self.assertEqual(outcome['monitor_failed'],mode=='monitor')
                self.assertEqual((outcome['cleanup']['down'],outcome['cleanup']['residue']),('passed','passed'))
                self.assertFalse((output/'owned-resource').exists())
                self.assertEqual((output/'foreign-resource').read_text(),'foreign')

    def test_foreign_budget_binding_and_extended_contacts_are_refused_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            output,pins=test_technical_scope.TechnicalScope().prepare_inputs(Path(directory).resolve())
            prepared=json.loads((output/'fullstack-source.json').read_text())
            for key,bad in (('worker_deadline_seconds',600),('worker_deadline_seconds',601),('worker_deadline_seconds',899),
                    ('worker_deadline_seconds',True),('worker_deadline_seconds',901),
                    ('scope','full'),('source','b'*40),('output_sha256','0'*64),('profile','platform-representative-v1')):
                changed=copy.deepcopy(prepared);changed['scope_binding'][key]=bad
                (output/'fullstack-source.json').write_text(json.dumps(changed))
                with self.subTest(key=key,bad=bad),self.assertRaises(ValueError):fullstack.timing_options(output,SOURCE)
            (output/'fullstack-source.json').write_text(json.dumps(prepared))
            with self.assertRaises(ValueError):fullstack.timing_options(output,'b'*40)
            options=fullstack.timing_options(output,SOURCE)
            with self.assertRaises(ValueError):stage_timing.Timing(output,SOURCE,name=stage_timing.CONTACTS_NAME,**options)

    def test_only_technical_measurement_step_gets_30_minutes(self):
        workflow=(fullstack.ROOT/'.github/workflows/observability-resource.yml').read_text()
        job=workflow.split('\n  fullstack:\n')[1].split('\n  stability:\n')[0]
        measure=next(step for step in job.split('      - name: ') if 'fullstack.py run\n' in step)
        self.assertIn("timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 12 }}\n",measure)
        self.assertIn('    timeout-minutes: 60\n',job)
        self.assertIn('timeout-minutes: 5\n',next(step for step in job.split('      - name: ') if 'fullstack.py recover\n' in step))
        self.assertIn('timeout-minutes: 1\n',next(step for step in job.split('      - name: ') if 'fullstack.py collect\n' in step))
        self.assertEqual(workflow.count("&& 30 || 12"),1)
        self.assertEqual(fullstack.pilot.CLEANUP_TIMEOUT_SECONDS,90)

    def test_new_technical_timing_records_900_without_relabeling_legacy_600(self):
        with tempfile.TemporaryDirectory() as directory:
            output,pins=test_technical_scope.TechnicalScope().prepare_inputs(Path(directory).resolve())
            binding=json.loads((output/'fullstack-source.json').read_text())['scope_binding']
            self.assertEqual(stage_timing.SCHEMA2_TECHNICAL_FULL_DEADLINE_SECONDS,900)
            with patch.object(fullstack.sys,'platform','linux'):
                self.assertEqual(fullstack.worker_deadline('technical'),binding['worker_deadline_seconds'])
            self.assertEqual(binding['worker_deadline_seconds'],900)
            options=fullstack.timing_options(output,pins['source'])
            for seconds in (601,899,901):
                now=[0.0]
                timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0],**options)
                timer.call('phase_load',lambda:now.__setitem__(0,seconds),group=0,phase=0)
                timer.finish()
                value=stage_timing.read(output,SOURCE,**options)
                self.assertEqual((value['schema'],value['worker_deadline_seconds']),(2,900))
                self.assertEqual(value['scope_binding'],binding)
                self.assertEqual((value['elapsed_ms'],value['saturated']),(min(seconds*1000,900000),seconds>900))
                self.assertEqual(value['stages'][0]['duration_ms'],min(seconds*1000,900000))
                for bad_deadline in (601,899,901):
                    changed=copy.deepcopy(value);changed['worker_deadline_seconds']=bad_deadline
                    with self.subTest(seconds=seconds,bad_deadline=bad_deadline),self.assertRaises(ValueError):
                        stage_timing.validate(changed,SOURCE,output,**options)
                with self.assertRaises(ValueError):stage_timing.read(output,SOURCE)
            # Historical technical input and timing retain their original format.
            prepared=json.loads((output/'fullstack-source.json').read_text())
            del prepared['scope_binding']['worker_deadline_seconds']
            (output/'fullstack-source.json').write_text(json.dumps(prepared))
            self.assertEqual(fullstack.timing_options(output,SOURCE),{})
            now=[0.0];timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0])
            timer.call('phase_load',lambda:now.__setitem__(0,601),group=0,phase=0);timer.finish()
            legacy=stage_timing.read(output,SOURCE)
            self.assertEqual((legacy['schema'],legacy['elapsed_ms'],legacy['saturated']),(1,600000,True))
            self.assertNotIn('worker_deadline_seconds',legacy)
            with self.assertRaises(ValueError):stage_timing.read(output,SOURCE,**options)

    def test_technical_collection_preserves_budget_contacts_and_existing_caps(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();output,pins=test_technical_scope.TechnicalScope().prepare_inputs(base)
            options=fullstack.timing_options(output,SOURCE);now=[0.0]
            timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0],**options)
            timer.call('phase_load',lambda:now.__setitem__(0,899),group=0,phase=0);timer.finish()
            value=stage_timing.read(output,SOURCE,**options)
            contacts=stage_timing.Timing(output,SOURCE,name=stage_timing.CONTACTS_NAME)
            contacts.call('seed_contacts',lambda:None);contacts.call('seed_contact_count',lambda:None);contacts.finish()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
                public=base/'public';fullstack.collect(output,base/'metadata',public,scope='technical')
                self.assertEqual(stage_timing.read(public,SOURCE,binding_output=output,**options),value)
                self.assertEqual(stage_timing.read(public,SOURCE,binding_output=output,name=stage_timing.CONTACTS_NAME)['schema'],1)
                for index,change in enumerate(('source','scope','nonce','deadline','binding_deadline_float','elapsed','rows','bytes','unknown')):
                    bad=copy.deepcopy(value)
                    if change=='source':bad['source']='b'*40
                    if change=='scope':bad['scope_binding']['scope']='full'
                    if change=='nonce':bad['scope_binding']['nonce']='b'*64
                    if change=='deadline':bad['worker_deadline_seconds']=600
                    if change=='binding_deadline_float':bad['scope_binding']['worker_deadline_seconds']=900.0
                    if change=='elapsed':bad['elapsed_ms']=901000
                    if change=='rows':bad['stages']*=385
                    if change=='bytes':bad['stages'][0]['stage']='x'*131072
                    if change=='unknown':bad['private']='secret'
                    (output/stage_timing.NAME).write_text(json.dumps(bad))
                    destination=base/('refused-'+str(index))
                    with self.subTest(change=change),self.assertRaises(ValueError):fullstack.collect(output,base/'metadata',destination,scope='technical')
                    self.assertFalse(destination.exists())

    def test_technical_budget_refuses_nonlinux_and_diagnostic_cli_without_acquiring_worker(self):
        with patch.object(fullstack.sys,'platform','darwin'):
            with self.assertRaises(ValueError):fullstack.worker_deadline('technical')
        for scope in ('unknown',True,None):
            with self.subTest(scope=scope),self.assertRaises(ValueError):fullstack.worker_deadline(scope)
        with patch.object(sys,'argv',['fullstack.py','diagnostic-run','--scope','technical']),patch('sys.stderr',new=io.StringIO()),patch.object(fullstack.pilot,'run') as run:
            with self.assertRaises(SystemExit) as error:fullstack.main()
            self.assertEqual(error.exception.code,2);run.assert_not_called()

    def test_main_reaches_existing_supervisor_with_scope_exact_budget(self):
        # Only native preparation/Docker ownership boundaries are doubles. The
        # CLI, pilot.run and its forwarding to the supervisor execute unchanged.
        for action,scope,expected in (('run','technical',900),('run','full',600),('run',None,600),('diagnostic-run','full',600),(None,'full',600)):
            with self.subTest(action=action,scope=scope),tempfile.TemporaryDirectory() as directory:
                output=Path(directory)/'owned'
                stage=SimpleNamespace(in_use=nullcontext,require_consumer=lambda *_:None,pass_fds=lambda:())
                def prepare(path,*args,**options):
                    path.mkdir();(path/'compose.json').write_text('{}')
                def command(args,**options):
                    if args[0]=='git':return '' if 'status' in args else SOURCE
                    if args==['docker','context','show']:return 'fixture'
                    if args==['docker','compose','ls','--format','json']:return '[]'
                    raise AssertionError('uncontrolled native command')
                def supervise(execute,compose,path,project,**options):
                    self.assertEqual(options.get('deadline_seconds',600),expected)
                    self.assertEqual(execute[-3:],['worker','--output',str(output)])
                    return 0
                pilot=fullstack.pilot
                with ExitStack() as patches:
                    for target,name,value in ((sys,'argv',['fullstack.py',action,*(['--scope',scope] if scope is not None else []),'--output',str(output),'--images',str(Path(directory)/'images.json')]),
                            (sys,'platform','linux')):
                        patches.enter_context(patch.object(target,name,value))
                    patches.enter_context(patch.object(fullstack.preparation,'recover_stage',return_value=stage))
                    patches.enter_context(patch.object(fullstack,'inputs',side_effect=prepare))
                    patches.enter_context(patch.object(fullstack,'stability_inputs',side_effect=prepare))
                    patches.enter_context(patch.object(pilot,'command',side_effect=command))
                    patches.enter_context(patch.object(pilot.platform,'system',return_value='Linux'))
                    patches.enter_context(patch.object(pilot.daemon,'identify',return_value={'endpoint':'fixture','storage':directory}))
                    patches.enter_context(patch.object(pilot.shutil,'disk_usage',return_value=SimpleNamespace(total=128*1024**3,free=64*1024**3)))
                    patches.enter_context(patch.object(pilot,'socket',SimpleNamespace(socket=lambda:nullcontext(SimpleNamespace(setsockopt=lambda *_:None,bind=lambda *_:None)),SOL_SOCKET=1,SO_REUSEADDR=2)))
                    patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_ENDPOINT'))
                    patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_IDENTITY'))
                    patches.enter_context(patch.object(pilot,'supervise_worker',side_effect=supervise))
                    patches.enter_context(redirect_stdout(io.StringIO()))
                    if action is None:pilot.run(output,prepare_inputs=prepare,ports=())
                    else:fullstack.main()
                evidence=json.loads((output/'evidence.json').read_text())
                if scope=='technical':self.assertEqual(evidence['worker_deadline_seconds'],900)
                else:self.assertNotIn('worker_deadline_seconds',evidence)


if __name__=='__main__':unittest.main()
