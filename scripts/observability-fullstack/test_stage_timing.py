import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import stage_timing


SOURCE='a'*40


class StageTimingTests(unittest.TestCase):
    def test_real_fifo_at_artifact_name_refuses_without_waiting_for_a_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);os.mkfifo(output/stage_timing.NAME)
            program='''import sys
from pathlib import Path
import stage_timing
try:stage_timing.read(Path(sys.argv[1]),'a'*40)
except ValueError:sys.exit(23)
sys.exit(1)
'''
            result=subprocess.run([sys.executable,'-c',program,str(output)],timeout=.5,capture_output=True,
                env={**os.environ,'PYTHONPATH':str(Path(stage_timing.__file__).parent)})
            self.assertEqual((result.returncode,result.stdout,result.stderr),(23,b'',b''))
            os.mkfifo(output/'evidence.json')
            self.assertIsNone(stage_timing.source(output))

    def test_actual_failed_child_retains_closed_stage_without_private_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            timer=stage_timing.Timing(output,SOURCE)
            try:
                try:
                    timer.call('horizon_install',subprocess.run,[sys.executable,'-c',
                        'import sys; print("private-token"); sys.exit(7)'],check=True,capture_output=True,timeout=3)
                finally:timer.finish()
            except subprocess.CalledProcessError as error:self.assertEqual(error.returncode,7)
            else:self.fail('the actual child failure was lost')
            raw=(output/stage_timing.NAME).read_text()
            self.assertNotIn('private',raw)
            value=stage_timing.read(output,SOURCE)
            self.assertEqual(value['state'],'failed')
            self.assertEqual(value['stages'][0]['stage'],'horizon_install')
            self.assertEqual(value['stages'][0]['outcome'],'failed')
            self.assertGreaterEqual(value['stages'][0]['duration_ms'],0)

    def test_real_process_interrupt_retains_active_phase_and_reaps_process(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            program='''import signal,sys,time
from pathlib import Path
import stage_timing
def stop(*_):raise KeyboardInterrupt()
signal.signal(signal.SIGTERM,stop)
timer=stage_timing.Timing(Path(sys.argv[1]),'a'*40)
try:
    try:timer.call('phase_load',time.sleep,30,group=3,phase=11)
    finally:timer.finish()
except KeyboardInterrupt:sys.exit(42)
'''
            process=subprocess.Popen([sys.executable,'-c',program,str(output)],
                env={**os.environ,'PYTHONPATH':str(Path(stage_timing.__file__).parent)},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                deadline=time.monotonic()+3
                while time.monotonic()<deadline:
                    if (output/stage_timing.NAME).exists() and stage_timing.read(output,SOURCE)['active']==0:break
                    time.sleep(.01)
                else:self.fail('child did not enter the real interruptible phase')
                process.send_signal(signal.SIGTERM)
                stdout,stderr=process.communicate(timeout=3)
                self.assertEqual((process.returncode,stdout,stderr),(42,b'',b''))
                value=stage_timing.read(output,SOURCE)
                self.assertEqual(value['state'],'interrupted')
                self.assertEqual(value['stages'][0]['outcome'],'interrupted')
                self.assertEqual((value['stages'][0]['group'],value['stages'][0]['phase']),(3,11))
            finally:
                if process.poll() is None:process.kill();process.communicate(timeout=3)

    def test_actual_child_timeout_is_failed_and_reaped_and_success_stays_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);pidfile=output/'child.pid';timer=stage_timing.Timing(output,SOURCE)
            program='import os,sys,time; from pathlib import Path; Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(30)'
            with self.assertRaises(subprocess.TimeoutExpired):
                try:timer.call('phase_load',subprocess.run,[sys.executable,'-c',program,str(pidfile)],
                    capture_output=True,check=True,timeout=2,group=0,phase=0)
                finally:timer.finish()
            with self.assertRaises(ProcessLookupError):os.kill(int(pidfile.read_text()),0)
            self.assertEqual(stage_timing.read(output,SOURCE)['state'],'failed')
            timer=stage_timing.Timing(output,SOURCE)
            result=timer.call('phase_load',subprocess.run,[sys.executable,'-c','pass'],
                capture_output=True,check=True,timeout=3,group=0,phase=0)
            timer.finish()
            self.assertEqual(result.returncode,0)
            self.assertEqual(stage_timing.read(output,SOURCE)['state'],'completed')

    def test_diagnostic_write_or_clock_failure_never_replaces_original_base_exception(self):
        for failure in (OSError('private disk error'),KeyboardInterrupt('private clock error')):
            with self.subTest(failure=type(failure).__name__),tempfile.TemporaryDirectory() as directory:
                timer=stage_timing.Timing(Path(directory),SOURCE)
                primary=SystemExit(91)
                boundary=patch.object(stage_timing,'write',side_effect=failure) if isinstance(failure,OSError) else patch.object(timer,'clock',side_effect=failure)
                def original():boundary.start();raise primary
                try:
                    try:
                        try:timer.call('phase_load',original,group=0,phase=0)
                        finally:timer.finish()
                    except BaseException as caught:self.assertIs(caught,primary)
                    else:self.fail('primary BaseException was swallowed')
                finally:boundary.stop()

    def test_closed_contract_output_binding_clock_and_count_are_bounded(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as other:
            output=Path(directory);now=[10.0]
            timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0])
            def actual():now[0]+=0.025;return 19
            self.assertEqual(timer.call('phase_load',actual,group=0,phase=0),19)
            timer.finish()
            value=stage_timing.read(output,SOURCE)
            self.assertEqual(value['state'],'completed')
            self.assertGreaterEqual(value['stages'][0]['duration_ms'],24)
            for key,bad in (('source','b'*40),('output_sha256',stage_timing.output_binding(other)),('private','secret')):
                changed=dict(value);changed[key]=bad
                with self.assertRaises(ValueError):stage_timing.validate(changed,SOURCE,output)
            for bad in ('private SQL payload',[],None):
                changed=json.loads(json.dumps(value));changed['stages'][0]['stage']=bad
                with self.assertRaises(ValueError):stage_timing.validate(changed,SOURCE,output)
            now[0]=9
            timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0])
            now[0]=8
            self.assertEqual(timer.call('phase_load',lambda:4,group=0,phase=0),4)
            with self.assertRaises(ValueError):timer.finish()
            self.assertEqual(stage_timing.read(output,SOURCE)['reason'],'clock_refused')
            timer=stage_timing.Timing(output,SOURCE)
            for _ in range(stage_timing.MAX_ROWS+1):timer.call('mode_api_ready',lambda:None,group=0)
            with self.assertRaises(ValueError):timer.finish()
            retained=stage_timing.read(output,SOURCE)
            self.assertEqual(len(retained['stages']),stage_timing.MAX_ROWS)
            self.assertEqual(retained['reason'],'contract_refused')
            self.assertLessEqual((output/stage_timing.NAME).stat().st_size,stage_timing.MAX_BYTES)

    def test_refusal_reasons_are_exact_strings_on_read_and_canonical_write(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);timer=stage_timing.Timing(output,SOURCE)
            timer.call('private SQL payload',lambda:None)
            with self.assertRaises(ValueError):timer.finish()
            good=stage_timing.read(output,SOURCE)
            self.assertEqual((good['state'],good['reason']),('refused','contract_refused'))
            path=output/stage_timing.NAME
            for reason in (None,False,[],{},['private SQL'],{'private':'payload'},'private exception'):
                with self.subTest(reason=type(reason).__name__):
                    bad={**good,'reason':reason}
                    path.write_text(json.dumps(bad))
                    with self.assertRaises(ValueError):stage_timing.read(output,SOURCE)
                    stage_timing.write(output,good,SOURCE)
                    before=path.read_bytes()
                    with self.assertRaises(ValueError):stage_timing.write(output,bad,SOURCE)
                    self.assertEqual(path.read_bytes(),before)
            self.assertNotIn('private',path.read_text())

    def test_symlink_target_is_never_written_and_elapsed_over600_is_explicitly_saturated(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);foreign=output/'foreign';foreign.write_text('foreign')
            (output/stage_timing.NAME).symlink_to(foreign)
            timer=stage_timing.Timing(output,SOURCE)
            with self.assertRaises(ValueError):timer.finish()
            self.assertEqual(foreign.read_text(),'foreign')
            (output/stage_timing.NAME).unlink()
            now=[0.0];timer=stage_timing.Timing(output,SOURCE,clock=lambda:now[0])
            def late():now[0]=600.001
            timer.call('phase_load',late,group=0,phase=0);timer.finish()
            value=stage_timing.read(output,SOURCE)
            self.assertTrue(value['saturated']);self.assertEqual(value['elapsed_ms'],600000)

    def test_public_collection_canonicalizes_only_closed_same_source_same_output_timing(self):
        import fullstack
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';output.mkdir();metadata=root/'metadata';metadata.mkdir()
            (output/'evidence.json').write_text(json.dumps({'source':SOURCE}))
            timer=stage_timing.Timing(output,SOURCE)
            timer.call('phase_load',lambda:None,group=0,phase=0);timer.finish()
            path=output/stage_timing.NAME;good=path.read_text()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
                for index,invalid in enumerate((good[:-2]+',"private":"secret"}\n',good.replace('phase_load','private SQL'),
                        good.replace(SOURCE,'b'*40),good.replace('"schema":1','"schema":1,"schema":1'))):
                    path.write_text(invalid)
                    destination=root/('refused'+str(index))
                    with self.assertRaises(ValueError):fullstack.collect(output,metadata,destination)
                    self.assertFalse(destination.exists())
                path.write_text(good)
                destination=root/'public';fullstack.collect(output,metadata,destination)
                self.assertEqual(stage_timing.read(destination,SOURCE,binding_output=output),stage_timing.read(output,SOURCE))
                self.assertNotIn(str(output),(destination/stage_timing.NAME).read_text())

    def test_worker_diagnostic_preserves_all_four_modes_twelve_phases_and_outage(self):
        # Pure orchestration unit. Docker, product, kernel and network are replaced;
        # this proves caller coverage, not a Linux run or resource acceptance.
        from contextlib import ExitStack,nullcontext
        from types import SimpleNamespace
        import fullstack
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'owned'}))
            (output/'evidence.json').write_text(json.dumps({'source':SOURCE}))
            (output/'compose.json').write_text(json.dumps({'services':{'grafana':{'user':'1:1'}}}))
            dispatched=[]
            def phase(compose,project,definition,active,enabled,pair,path,**options):
                dispatched.append((pair,enabled,definition['name'],options['group'],options['index']))
                return {'mode':'on' if enabled else 'off','name':definition['name'],'errors':[],
                    'samples':[],'load':{'completed':True,'query_seconds':[.1],
                        'timing_diagnostics':{'state':'complete','requests':[[0,0,1,2]]}},
                    'source_cache_samples':[{'postgresql':'observed','caddy':'observed'}]*{'idle':2,'steady':8,'spike':2}[definition['name']]}
            def invoke(compose,args,**options):
                if args[-1]=='loss':return '{"attempted":1,"acknowledged":0,"explained_loss":1}'
                if args[-1]=='recover-probe':return '{"post_restart_acknowledged":1,"post_restart_stored":1,"outage_stored":0}'
                return ''
            with ExitStack() as patches:
                patches.enter_context(patch.object(fullstack,'sys',SimpleNamespace(platform='linux')))
                patches.enter_context(patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()))
                for target,name in ((fullstack.production.pilot,'install_horizon'),(fullstack.production.pilot,'install_plugin'),
                        (fullstack.resource_runtime,'wait_ready'),(fullstack.extra,'warmup'),(fullstack,'mode'),
                        (fullstack,'ready'),(fullstack,'await_sources'),(fullstack,'await_collector')):
                    patches.enter_context(patch.object(target,name))
                patches.enter_context(patch.object(fullstack,'seed',return_value={}))
                patches.enter_context(patch.object(fullstack,'prove_web_http',return_value={}))
                patches.enter_context(patch.object(fullstack,'invoke',side_effect=invoke))
                patches.enter_context(patch.object(fullstack,'phase',side_effect=phase))
                patches.enter_context(patch.object(fullstack.technical,'summarize',return_value={}))
                patches.enter_context(patch.object(fullstack,'evaluate',return_value={'state':'passed'}))
                fullstack.worker(output)
                first_dispatched=list(dispatched)
                value=stage_timing.read(output,SOURCE)
                original_write=stage_timing.write
                def refuse_terminal(path,value,source,**options):
                    if value['state']=='completed':raise OSError('private terminal disk failure')
                    return original_write(path,value,source,**options)
                primary=ValueError('closed fullstack timing contract')
                with patch.object(stage_timing,'write',side_effect=refuse_terminal),patch.object(stage_timing,'refuse',side_effect=primary):
                    with self.assertRaises(ValueError) as caught:fullstack.worker(output)
                self.assertIs(caught.exception,primary)
                self.assertEqual(json.loads((output/'fullstack-proof.json').read_text())['state'],'failed')
            self.assertEqual(value['state'],'completed')
            summary=json.loads((output/'fullstack-proof.json').read_text())
            self.assertTrue(all('timing_diagnostics' not in row['load'] for row in summary['phases']))
            for index in range(12):
                raw=json.loads((output/f'fullstack-phase-{index}.json').read_text())
                self.assertEqual(raw['load']['timing_diagnostics'],{'state':'complete','requests':[[0,0,1,2]]})
                self.assertTrue(raw['load']['completed'])
            self.assertEqual(first_dispatched,[(pair,on,name,group,group*3+phase)
                for pair,on,group in ((0,False,0),(0,True,1),(1,True,2),(1,False,3))
                for phase,name in enumerate(('idle','steady','spike'))])
            rows=value['stages']
            self.assertEqual([row['group'] for row in rows if row['stage']=='mode_database_broker_recreate'],[0,1,2,3])
            self.assertEqual([row['stage'] for row in rows if row['stage'].startswith('outage_')],
                ['outage_core_up','outage_collector_stop','outage_loss','outage_collector_up','outage_ready','outage_recover'])
            self.assertIn(stage_timing.NAME,fullstack.ARTIFACTS)

    def test_actual_worker_primary_failure_survives_terminal_diagnostic_write_failure(self):
        import fullstack
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'owned'}))
            (output/'evidence.json').write_text(json.dumps({'source':SOURCE}))
            original_write=stage_timing.write
            primary=RuntimeError('private original guard failure')
            def fail_terminal(path,value,source,**options):
                if value['state']=='failed':raise OSError('private terminal disk failure')
                return original_write(path,value,source,**options)
            with patch.object(fullstack,'sys',SimpleNamespace(platform='linux')), \
                    patch.object(fullstack.pilot,'worker_storage_guard',side_effect=primary), \
                    patch.object(stage_timing,'write',side_effect=fail_terminal):
                with self.assertRaises(RuntimeError) as caught:fullstack.worker(output)
            self.assertIs(caught.exception,primary)
            self.assertEqual(json.loads((output/'fullstack-proof.json').read_text())['state'],'failed')
            # Failed persistence can retain only the last successful checkpoint.
            self.assertEqual(stage_timing.read(output,SOURCE)['state'],'running')
            self.assertNotIn('private',(output/stage_timing.NAME).read_text())

    def test_actual_phase_failure_preserves_reader_sql_baseline_and_failed_load_stage(self):
        import fullstack
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);timer=stage_timing.Timing(output,SOURCE)
            volumes={name:{key:0 for key in fullstack.storage.FIELDS} for name in fullstack.storage.VOLUMES}
            def invoke(compose,args,**options):
                if args[-1]=='volume-reader':return json.dumps(volumes)
                subprocess.run([sys.executable,'-c','import sys; sys.exit(7)'],check=True,capture_output=True,timeout=3)
            owned={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
            counters={'at_seconds':1,'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
            with patch.object(fullstack.technical,'owned',return_value=owned), \
                    patch.object(fullstack.technical,'capture',return_value=counters),patch.object(fullstack,'host',return_value={}), \
                    patch.object(fullstack,'invoke',side_effect=invoke), \
                    patch.object(fullstack,'sql',return_value=json.dumps({name:1 for name in fullstack.storage.DATABASES})):
                with self.assertRaises(subprocess.CalledProcessError):
                    try:fullstack.phase([],'owned',{'name':'idle','seconds':10},('loadgen',),False,0,output,timing=timer,group=0,index=0)
                    finally:timer.finish()
            value=stage_timing.read(output,SOURCE)
            self.assertEqual(value['state'],'failed')
            self.assertEqual([row['stage'] for row in value['stages']],['phase_ownership_before','phase_baseline',
                'phase_storage_before_reader','phase_storage_before_database','phase_load'])
            self.assertEqual(value['stages'][-1]['outcome'],'failed')


if __name__=='__main__':unittest.main()
