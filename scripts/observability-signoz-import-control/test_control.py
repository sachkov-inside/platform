"""Owned benign Engine CLI seams and closed projection, no native Docker."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'observability-signoz'))
spec=importlib.util.spec_from_file_location('import_discriminator',HERE/'control.py')
control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
import lifecycle
import test_native_timeout as native_fixture


def state():
    return {'generation':'a'*64,'clock':{'boot':'b'*64,'time_namespace':'c'*64},
        'cpu':{'usage_usec':1,'nr_periods':1,'nr_throttled':0,'throttled_usec':0}}


def record(case='contended'):
    raw={'available':True,'started':10.,'finished':12.,'timeout_seconds':3,'raw_window_seconds':3.,
        'outer_remaining_seconds':40.,'native_exit':0,'reaped':True}
    identity={**state()['clock'],'self_generation':'d'*64}
    actor={'schema':1,'before':identity,'after':dict(identity),'started':11.,'finished':11.5,
        'cpu_seconds':.1,'imports_completed':True}
    return {'case':case,'status':'succeeded','raw':raw,'before':state(),'after':state(),
        'inner':{'available':False},'value':{},'actor':actor if case=='contended' else None,
        'actor_raw':{**raw,'started':9.,'finished':13.,'timeout_seconds':10,'raw_window_seconds':10.},'actor_error':False,'failure_reason':'none','cleanup_complete':True,'cleanup_fault':False}


class Projection(unittest.TestCase):
    def test_only_actual_total_raw_window_overlap_with_same_clock_is_interpretable(self):
        rows=[record('quiet'),record()];result=control.interpret(rows)
        self.assertEqual([r['status'] for r in result],['succeeded','succeeded'])
        self.assertEqual(result[1]['overlap'],'overlap');self.assertFalse(result[1]['actor_host_pid_attested'])
        wire=json.dumps(result)
        for private in ('a'*64,'b'*64,'self_generation','/proc','fixture-key'):self.assertNotIn(private,wire)
        for change in ('clock','generation','short','none','after_cap','actor_raw','actor_error'):
            with self.subTest(change=change):
                value=copy.deepcopy(rows)
                if change=='clock':value[1]['actor']['before']['boot']='e'*64;value[1]['actor']['after']['boot']='e'*64
                if change=='generation':value[1]['after']['generation']='e'*64
                if change=='short':value[1]['raw']['outer_remaining_seconds']=2.9
                if change=='none':value[1]['actor'].update(started=9.1,finished=9.5)
                if change=='after_cap':
                    value[1]['raw']['finished']=14.
                    value[1]['actor'].update(started=13.2,finished=13.4)
                    value[1]['actor_raw']['finished']=15.
                if change=='actor_raw':value[1]['actor_raw']=None
                if change=='actor_error':value[1]['actor_error']=True
                self.assertEqual(control.interpret(value)[1]['status'],'not_run')

    def test_forged_private_inner_or_extra_actor_fields_fail_closed(self):
        for kind in ('extra','nan','duplicate','identity'):
            actor=copy.deepcopy(record()['actor'])
            if kind=='extra':actor['private']='fixture-key'
            if kind=='nan':actor['started']=float('nan')
            if kind=='identity':actor['after']['self_generation']='e'*64
            raw=json.dumps(actor)
            if kind=='duplicate':raw=raw.replace('"schema": 1','"schema": 1,"schema": 1')
            with self.subTest(kind=kind),self.assertRaises(ValueError):control.actor_value(raw)
        row=record('quiet');row['inner']={'available':False,'private':'fixture-key'}
        with self.assertRaises(ValueError):control.interpret([row])

    def test_actor_contains_real_imports_but_no_functional_execution(self):
        tree=ast.parse(control.ACTOR)
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        imports=[n.names[0].name for n in main.body if isinstance(n,ast.Import)]
        self.assertEqual(imports,['inside','functional_witness'])
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
            and isinstance(n.func.value,ast.Name) and n.func.value.id in imports for n in ast.walk(main)))


class ActualCoordinator(unittest.TestCase):
    def test_actual_vm_sample_real_CLI_receipt_and_no_latest_failure_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine,own=native_fixture.Feedback().owned(root,'valid')
            try:
                with patch.object(control.lifecycle,'vm_sample',wraps=lifecycle.vm_sample) as real:
                    row,error=control.sample(own)
                self.assertIsNone(error);self.assertEqual(real.call_count,1)
                self.assertEqual(row['status'],'succeeded');self.assertTrue(control.receipts.full_window(row['raw']))
                self.assertFalse(engine.child)
                (root/'failure.json').write_text('{"native_exit":99,"private":"fixture-key"}')
                (root/'mode').write_text('probe_exit')
                row,error=control.sample(own)
                self.assertEqual(row['status'],'failed');self.assertEqual(error.reason,'command_failed')
                self.assertEqual(row['inner']['native_exit'],7);self.assertNotIn('private',json.dumps(row['inner']))
                self.assertIsNone(sys.getprofile());self.assertFalse(engine.child)
            finally:engine.cancel_children()

    def test_importer_failure_keeps_first_sample_error_object_and_joins(self):
        class Boundary:
            containers={'disk':'owned'}
            def __init__(self):self.engine=self;self.deadline=time.monotonic()+2;self.anon=Path('/owned');self.endpoint='fixture';self.cancelled=[]
            def call(self,*_args,**_kwargs):raise RuntimeError('fixture_import_failure')
            def cancel_thread_children(self,thread):self.cancelled.append(thread)
        own=Boundary();error=lifecycle.Refusal('command_deadline');row=record('quiet')
        with patch.object(control,'snapshot',side_effect=lambda _:state()),patch.object(control,'sample',side_effect=lambda _:(copy.deepcopy(row),error)):
            rows,first=control.measure_pair(own)
        self.assertIs(first,error);self.assertEqual(len(rows),2);self.assertEqual(len(own.cancelled),1)
        self.assertFalse(own.cancelled[0].is_alive());self.assertTrue(rows[1]['actor_error'])

    def test_actual_selective_group_reap_preserves_unrelated_registered_child(self):
        from test_lifecycle import benign_engine
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=benign_engine(root);engine.deadline=time.monotonic()+5
            caught=[]
            def run(index):
                try:
                    code=('import subprocess,sys,time,os;from pathlib import Path;'
                        'child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"]);'
                        'Path('+repr(str(root))+'+"/"+str('+str(index)+')).write_text(str(child.pid));time.sleep(10)')
                    engine.raw(['-c',code],timeout=3)
                except BaseException as error:caught.append(error)
            threads=[threading.Thread(target=run,args=(i,)) for i in (0,1)]
            try:
                for thread in threads:thread.start()
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:
                    with engine.lock:
                        if len(engine.child_threads)==2 and all((root/str(i)).exists() for i in (0,1)):break
                    time.sleep(.01)
                with engine.lock:
                    groups={owner:proc for proc,owner in engine.child_threads.items()};self.assertEqual(len(groups),2)
                foreign=groups[threads[1].ident]
                children=[int((root/str(i)).read_text()) for i in (0,1)]
                def inspect(pid):
                    value=subprocess.run(['ps','-o','pgid=,lstart=,stat=','-p',str(pid)],capture_output=True,text=True)
                    parts=value.stdout.split()
                    return parts if value.returncode==0 and len(parts)>=7 else None
                births={pid:inspect(pid) for pid in children}
                self.assertTrue(all(births.values()))
                self.assertEqual([int(births[children[i]][0]) for i in (0,1)],
                    [groups[threads[i].ident].pid for i in (0,1)])
                def live(pid):
                    parts=inspect(pid)
                    return parts is not None and parts[:6]==births[pid][:6] and not parts[6].startswith('Z')
                self.assertTrue(all(live(pid) for pid in children))
                engine.cancel_thread_children(threads[0]);threads[0].join(2)
                self.assertFalse(threads[0].is_alive());self.assertIsNone(foreign.poll())
                self.assertFalse(live(children[0]));self.assertTrue(live(children[1]))
            finally:
                engine.cancel_children()
                for thread in threads:thread.join(2)
            self.assertFalse(any(t.is_alive() for t in threads));self.assertFalse(engine.child)
            self.assertFalse(any(live(pid) for pid in children))

class Collector(unittest.TestCase):
    def test_actual_owned_source_projection_and_cleanup_stay_closed_on_partial_cases(self):
        import test_disk_component as fixtures
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir()
            fixtures.collection_fixture(output)
            control.lifecycle.private_json(output/'import-cases.json',{'schema':1,'source_sha':'a'*40,'source_tree':'e'*40,
                'cases':[record('quiet'),record()]})
            with patch.object(control.runtime,'verify_source'),patch.object(control,'verify_import_source',return_value={'schema':1,'inputs':{'new-workflow':'bound'}}):
                self.assertTrue(control.collect(output,root/'complete'))
                result=json.loads((root/'complete/import-control.json').read_text())
                self.assertTrue(result['diagnostic_complete'])
                self.assertTrue(all(result[k] is False for k in ('capacity_acceptance','functional_acceptance',
                    'resource_acceptance','full_workload_acceptance','production_acceptance','actor_host_pid_attested')))
                (output/'component-inventory-after.json').unlink()
                self.assertFalse(control.collect(output,root/'partial'))
                partial=json.loads((root/'partial/import-control.json').read_text())
                self.assertTrue(partial['cleanup']['passed']);self.assertFalse(partial['diagnostic_complete'])
            with patch.object(control.runtime,'verify_source',side_effect=ValueError('unbound')):
                self.assertFalse(control.collect(output,root/'unbound'))
                self.assertFalse(json.loads((root/'unbound/import-control.json').read_text())['cleanup']['available'])
            wire=json.dumps(result)
            self.assertNotIn('self_generation',wire);self.assertNotIn('private/',wire)

    def test_real_native_entrypoint_optin_refuses_before_output_or_Docker(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'GITHUB_EVENT_NAME':'not_pull_request'}):
            output=Path(tmp)/'must-not-exist'
            with patch.object(control.lifecycle.Engine,'freeze') as native,self.assertRaises(ValueError):control.run(output)
            native.assert_not_called();self.assertFalse(output.exists())


class SourceBinding(unittest.TestCase):
    def test_new_workflow_is_in_own_source_and_changed_binding_refuses_before_recovery(self):
        base={'commit':'a'*40,'tree':'b'*40,'inputs':{'old-workflow':'c'*64},'scope':'original'}
        actual=control.import_source(base)
        path='.github/workflows/observability-signoz-import-control.yml'
        self.assertIn(path,actual['inputs']);self.assertNotIn(path,base['inputs'])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();control.lifecycle.private_json(root/'import-source.json',actual)
            with patch.object(control.runtime,'source',return_value=base):
                self.assertEqual(control.verify_import_source(root),actual)
                bad=copy.deepcopy(actual);bad['inputs'][path]='f'*64
                control.lifecycle.private_json(root/'import-source.json',bad)
                with patch.object(control.component,'recover') as native,self.assertRaises(ValueError):control.recover(root)
                native.assert_not_called()


class ConcurrentAuthority(unittest.TestCase):
    def test_real_concurrent_native_failures_keep_each_sample_exception_and_reap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine,own=native_fixture.Feedback().owned(root,'probe_exit')
            original=control.sample;errors=[]
            def observed(value):
                row,error=original(value);errors.append(error);return row,error
            try:
                with patch.object(control,'snapshot',side_effect=lambda _:state()),patch.object(control,'sample',side_effect=observed):
                    rows,first=control.measure_pair(own)
                self.assertIs(first,errors[0]);self.assertEqual(len(errors),2)
                self.assertTrue(all(isinstance(error,lifecycle.Refusal) for error in errors))
                self.assertTrue(all(row['inner']['native_exit']==7 for row in rows))
                self.assertTrue(rows[1]['actor_error']);self.assertFalse(engine.child)
                self.assertIsNone(sys.getprofile());native_fixture.Feedback().no_live(root)
            finally:engine.cancel_children()

class SettlementFailure(unittest.TestCase):
    def test_cancel_fault_preserves_real_sample_primary_and_always_joins_retaining_case(self):
        for sample_fails in (True,False):
            with self.subTest(sample_fails=sample_fails),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine,own=native_fixture.Feedback().owned(root,'valid')
                original=control.sample;observed=[];joins=[];rows=[];cleanup=OSError('fixture_cancel_fault')
                join=threading.Thread.join
                def joined(thread,*args,**kwargs):
                    if thread.name=='owned-signoz-import-only':joins.append(thread)
                    return join(thread,*args,**kwargs)
                def sampled(value):
                    if observed and sample_fails:(root/'mode').write_text('probe_exit')
                    row,error=original(value);observed.append((error,None if error is None else error.__traceback__))
                    return row,error
                caught=None;frames=[]
                try:
                    with patch.object(control,'snapshot',side_effect=lambda _:state()),patch.object(control,'sample',side_effect=sampled),\
                        patch.object(engine,'cancel_thread_children',side_effect=cleanup),patch.object(threading.Thread,'join',joined):
                        try:control.measure_pair(own,rows)
                        except BaseException as error:
                            caught=error;frame=error.__traceback__
                            while frame is not None:frames.append(frame);frame=frame.tb_next
                    expected=observed[1][0] if sample_fails else cleanup
                    self.assertIs(caught,expected)
                    if sample_fails:self.assertIn(observed[1][1],frames)
                    self.assertEqual(len(joins),2);self.assertTrue(all(not t.is_alive() for t in joins))
                    self.assertEqual(len(rows),2);self.assertTrue(rows[1]['cleanup_fault'])
                    self.assertFalse(rows[1]['cleanup_complete'])
                    self.assertEqual(control.interpret(rows)[1]['status'],'not_run')
                    self.assertFalse(engine.child);native_fixture.Feedback().no_live(root)
                finally:engine.cancel_children()

    def test_public_partial_settlement_retains_closed_fault_without_comparison(self):
        import test_disk_component as fixtures
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir()
            fixtures.collection_fixture(output);(output/'component-inventory-after.json').unlink()
            bad=record();bad.update(after=None,cleanup_complete=False,cleanup_fault=True)
            control.lifecycle.private_json(output/'import-cases.json',{'schema':1,'source_sha':'a'*40,'source_tree':'e'*40,
                'cases':[record('quiet'),bad]})
            with patch.object(control.runtime,'verify_source'),patch.object(control,'verify_import_source',return_value={'schema':1,'inputs':{'new-workflow':'bound'}}):
                self.assertFalse(control.collect(output,root/'public'))
            result=json.loads((root/'public/import-control.json').read_text())
            self.assertFalse(result['diagnostic_complete']);self.assertEqual(result['comparison'],'unavailable')
            self.assertEqual(len(result['cases']),2)
            self.assertTrue(result['cases'][1]['cleanup_fault'])
            self.assertFalse(result['cases'][1]['cleanup_complete'])
            self.assertEqual(result['cases'][1]['status'],'not_run')
