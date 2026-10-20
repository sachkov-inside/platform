"""Same-read numeric feedback contracts, not a native allocation reproduction."""
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from types import FunctionType,SimpleNamespace
from unittest.mock import Mock,patch
import hosted


class SameReadGuard(unittest.TestCase):
    def run_guard(self,initial,readings,*,observed=True):
        pilot=hosted.runtime.pilot;targets=[];handlers={};thread=Mock();wait=Mock()
        wait.wait.side_effect=[False]*len(readings)+[True]
        def register(**kwargs):targets.append(kwargs['target']);return thread
        with patch.object(pilot.threading,'Thread',side_effect=register),patch.object(pilot.threading,'Event',return_value=wait), \
             patch.object(pilot.shutil,'disk_usage',side_effect=[SimpleNamespace(free=initial),*[x if isinstance(x,BaseException) else SimpleNamespace(free=x) for x in readings]]) as disk, \
             patch.object(pilot.signal,'signal',side_effect=lambda number,handler:handlers.update({number:handler})),patch.object(pilot.os,'kill') as kill:
            with pilot.disk_budget(Path('/synthetic'),observe_samples=observed) as view:
                if observed:self.assertEqual(view.current[2],(0,initial));self.assertIsNone(view.current[3])
                targets[0]()
            self.assertEqual(disk.call_count,1+len(readings));thread.join.assert_called_once_with(timeout=pilot.MONITOR_SHUTDOWN_SECONDS)
            return view,kill.call_count

    def test_default_false_is_none_and_same_reads_and_guard_decisions(self):
        for initial,readings in ((20*1024**3,[19*1024**3]),(20*1024**3,[16*1024**3]),(12*1024**3,[11_005_853_696]),(20*1024**3,[OSError('private')])):
            with self.subTest(reads=len(readings)):
                plain,kills=self.run_guard(initial,readings,observed=False);self.assertIsNone(plain)
                view,observed_kills=self.run_guard(initial,readings)
                self.assertEqual(kills,observed_kills);self.assertIsNotNone(view.final)

    def test_baseline_is_not_safe_and_final_is_immutable_after_seal(self):
        view,kills=self.run_guard(0,[])
        self.assertEqual(view.final,('observed','none',(0,0),None,None,'baseline',(0,0)))
        self.assertEqual(kills,0)
        snapshot=view.final;view._safe((1,1));self.assertEqual(view.final,snapshot)
        with self.assertRaises(AttributeError):view.current=()
        with self.assertRaises(AttributeError):view.final=()

    def test_monitor_publication_failure_cannot_suppress_original_stop_and_seal_failure_restores_handler(self):
        from disk_samples import DiskSamples
        pilot=hosted.runtime.pilot
        with patch.object(DiskSamples,'_stopping',side_effect=SystemExit('secondary')):
            view,kills=self.run_guard(20*1024**3,[16*1024**3])
        self.assertEqual(kills,1);self.assertEqual(view.final[:2],('refused','sample_failure'))
        for label,error in (('command',RuntimeError('original')),('interrupt',KeyboardInterrupt('original'))):
            with self.subTest(case=label):
                thread=Mock();handler=Mock()
                with patch.object(pilot.threading,'Thread',return_value=thread), \
                     patch.object(pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)), \
                     patch.object(pilot.signal,'signal',handler),patch.object(DiskSamples,'_seal',side_effect=OSError('secondary')):
                    try:
                        with pilot.disk_budget(Path('/synthetic'),observe_samples=True):raise error
                    except BaseException as caught:self.assertIs(caught,error)
                    else:self.fail('primary lost')
                self.assertEqual(handler.call_count,2);thread.join.assert_called_once_with(timeout=pilot.MONITOR_SHUTDOWN_SECONDS)
        with patch.object(pilot.threading,'Thread',return_value=Mock()), \
             patch.object(pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)), \
             patch.object(pilot.signal,'signal') as restore,patch.object(DiskSamples,'_seal',side_effect=OSError('owned')):
            with self.assertRaises(OSError):
                with pilot.disk_budget(Path('/synthetic'),observe_samples=True):pass
            self.assertEqual(restore.call_count,2)
        for invalid in (None,0,1,'true'):
            with patch.object(pilot.shutil,'disk_usage') as disk,self.assertRaises(ValueError):
                with pilot.disk_budget(Path('/synthetic'),observe_samples=invalid):pass
            disk.assert_not_called()

    def test_sealed_view_ignores_late_failure_publication(self):
        view,_=self.run_guard(20*1024**3,[])
        snapshot=view.current
        view._baseline_failure()
        self.assertEqual(view.current,snapshot)
        self.assertIs(view.current,view.final)

    def test_numeric_artifact_exists_as_closed_same_source_schema(self):
        import disk_feedback as numeric
        view,_=self.run_guard(20*1024**3,[19*1024**3])
        record=numeric.Record('a'*40);record.entered(view);record.first_pull();record.seal()
        value=record.value
        self.assertEqual(value['last_observed_before_first_pull']['state'],'safe')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/numeric.NAME;numeric.write(path,value,'a'*40)
            self.assertEqual(numeric.read(path,'a'*40),value);self.assertLessEqual(path.stat().st_size,4096)

    def test_monitor_boundaries_unavailable_and_numeric_exactness(self):
        from disk_samples import DiskSamples
        for initial,readings,reason,stop in ((12*1024**3,[11_005_853_697,11_005_853_696],'none',True),
                (20*1024**3,[17_448_304_641,17_448_304_640],'none',True),
                (20*1024**3,[11_005_853_696],'none',True),
                (20*1024**3,[OSError('private')],'read_unavailable',False),
                (20*1024**3,[RuntimeError('private')],'legacy_stop',False)):
            with self.subTest(reason=reason):
                view,kills=self.run_guard(initial,readings);self.assertEqual(kills,1)
                self.assertEqual(view.final[1],reason);self.assertEqual(view.final[4] is not None,stop)
        for invalid in (True,1.5,-1,2**63,None):
            view=DiskSamples();view._baseline(invalid);view._seal()
            self.assertEqual(view.final[:2],('refused','numeric_refused'))
        view=DiskSamples();view._baseline(100);view._next=65535
        self.assertEqual(view._point(90),(65535,90));self.assertIsNone(view._point(80));view._seal()
        self.assertEqual(view.final[:2],('refused','numeric_refused'))

    def late_monitor(self,early_failure=None,cleanup_failure=None,join_mode='normal',state=None):
        import sys
        import threading
        pilot=hosted.runtime.pilot;started=threading.Event();release=threading.Event();finish=threading.Event();threads=[]
        real_thread=threading.Thread;reads=[0]
        state={} if state is None else state
        state.update(threads=threads,release=release,finish=finish)
        if join_mode=='normal':finish.set()
        class OwnedThread(real_thread):
            def join(self,timeout=None):
                if release.is_set():
                    if join_mode=='timeout':return
                    if join_mode=='early_error':raise cleanup_failure
                super().join(timeout)
                if release.is_set() and cleanup_failure is not None:raise cleanup_failure
        def create(**kwargs):
            target=kwargs['target']
            # Execute the actual monitor code/closure with permanently signal-safe worker globals.
            # Restoring a process-wide patch cannot expose this still-live target to real os.kill.
            worker_globals={**target.__globals__,'os':SimpleNamespace(getpid=os.getpid,kill=kill),
                            'shutil':SimpleNamespace(disk_usage=disk)}
            kwargs['target']=FunctionType(target.__code__,worker_globals,target.__name__,target.__defaults__,target.__closure__)
            thread=OwnedThread(**kwargs);threads.append(thread);return thread
        def disk(path):
            reads[0]+=1
            if reads[0]==1:return SimpleNamespace(free=20*1024**3)
            started.set()
            if not release.wait(4) or not finish.wait(4):raise OSError('owned late fixture timeout')
            return SimpleNamespace(free=16*1024**3)
        with patch.object(pilot.threading,'Thread',side_effect=create),patch.object(pilot.shutil,'disk_usage',side_effect=disk),patch.object(pilot.os,'kill') as kill:
            state['kill']=kill
            try:
                with pilot.disk_budget(Path('/synthetic'),observe_samples=True) as view:
                    self.assertTrue(started.wait(2))
                frozen=view.final;self.assertTrue(threads[0].is_alive())
                if early_failure is not None:raise early_failure
            finally:
                primary=sys.exc_info()[0] is not None;cleanup_error=None
                release.set()
                for thread in threads:
                    try:thread.join(2)
                    except BaseException as error:
                        if cleanup_error is None:cleanup_error=error
                state['alive_at_patch_exit']=any(thread.is_alive() for thread in threads)
                if state['alive_at_patch_exit'] and cleanup_error is None:
                    cleanup_error=RuntimeError('owned late monitor cleanup incomplete')
                state['cleanup_error']=cleanup_error
                if cleanup_error is not None and not primary:raise cleanup_error
            self.assertEqual(view.final,frozen);kill.assert_called_once_with(os.getpid(),signal.SIGUSR1)

    def test_late_monitor_read_after_bounded_join_cannot_mutate_final_or_suppress_original_kill(self):
        self.late_monitor()

    def test_early_fixture_failure_reaps_monitor_before_kill_patch_restoration(self):
        error=AssertionError('owned early failure')
        # Safety net makes the pre-fix real late signal observable without sending it.
        with patch.object(hosted.runtime.pilot.os,'kill') as escaped:
            with self.assertRaises(AssertionError) as caught:self.late_monitor(error)
            self.assertIs(caught.exception,error)
            escaped.assert_not_called()

    def test_early_fixture_error_remains_primary_after_owned_cleanup_bookkeeping_failure(self):
        primary=AssertionError('owned early failure');secondary=OSError('owned joined cleanup failure')
        with patch.object(hosted.runtime.pilot.os,'kill') as escaped:
            with self.assertRaises(AssertionError) as caught:self.late_monitor(primary,secondary)
            self.assertIs(caught.exception,primary);escaped.assert_not_called()
        with patch.object(hosted.runtime.pilot.os,'kill') as escaped:
            with self.assertRaises(OSError) as caught:self.late_monitor(cleanup_failure=secondary)
            self.assertIs(caught.exception,secondary);escaped.assert_not_called()

    def test_still_live_join_timeout_and_pretermination_join_error_cannot_escape_containment(self):
        import threading
        for mode in ('timeout','early_error'):
            for failing in (False,True):
                with self.subTest(mode=mode,primary=failing):
                    state={};primary=AssertionError('owned primary') if failing else None
                    secondary=OSError('owned pretermination join refusal')
                    with patch.object(hosted.runtime.pilot.os,'kill') as escaped:
                        try:
                            try:self.late_monitor(primary,secondary,mode,state)
                            except BaseException as caught:
                                if primary is not None:self.assertIs(caught,primary)
                                elif mode=='early_error':self.assertIs(caught,secondary)
                                else:self.assertIsInstance(caught,RuntimeError)
                            else:self.fail('cleanup refusal lost')
                            self.assertTrue(state['alive_at_patch_exit'])
                            self.assertTrue(state['threads'][0].is_alive())
                            self.assertIsNotNone(state['cleanup_error'])
                        finally:
                            state['release'].set();state['finish'].set()
                            for thread in state['threads']:
                                # Base join bypasses only the deliberate test-owned join refusal.
                                threading.Thread.join(thread,2)
                                self.assertFalse(thread.is_alive())
                        escaped.assert_not_called()
                        state['kill'].assert_called_once_with(os.getpid(),signal.SIGUSR1)

    def test_baseline_interrupt_is_original_before_handler_or_thread_and_default_has_no_view(self):
        from disk_samples import DiskSamples
        pilot=hosted.runtime.pilot
        for kind in (KeyboardInterrupt,SystemExit):
            error=kind('synthetic')
            with patch.object(pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)), \
                 patch.object(DiskSamples,'_baseline',side_effect=error),patch.object(pilot.signal,'signal') as handler,patch.object(pilot.threading,'Thread') as thread:
                with self.assertRaises(kind) as caught:
                    with pilot.disk_budget(Path('/synthetic'),observe_samples=True):pass
                self.assertIs(caught.exception,error);handler.assert_not_called();thread.assert_not_called()
        with patch.object(pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)),patch.object(DiskSamples,'__init__',side_effect=AssertionError('default allocated view')):
            with pilot.disk_budget(Path('/synthetic')) as view:self.assertIsNone(view)


class Artifact(unittest.TestCase):
    def value(self):
        import disk_feedback as numeric
        from disk_samples import DiskSamples
        view=DiskSamples();view._baseline(20*1024**3);view._safe(view._point(19*1024**3))
        record=numeric.Record('a'*40);record.entered(view);record.first_pull()
        view._safe(view._point(18*1024**3));view._seal();record.seal();return record.value

    def test_source_integer_schema_and_checkpoint_relationships_refuse_before_copy(self):
        import copy
        import disk_feedback as numeric
        value=self.value();self.assertEqual(value['last_observed_before_first_pull']['sample']['id'],1)
        self.assertEqual(value['latest_safe']['id'],2)
        cases=[]
        for field,invalid in (('schema',True),('source','b'*40),('state','safe'),('reason','private'),('cutoff','stopped'),('baseline',None)):
            bad=copy.deepcopy(value);bad[field]=invalid;cases.append(bad)
        for field in ('baseline','latest_safe'):
            for key,bad_value in (('free_bytes',True),('free_bytes',1.0),('free_bytes',-1),('free_bytes',2**63),('id',True),('id',-1),('id',65536),('extra',0)):
                bad=copy.deepcopy(value);bad[field][key]=bad_value;cases.append(bad)
        for kind,sample in (('baseline',{'id':0,'free_bytes':1}),('safe',{'id':2,'free_bytes':1}),('safe',{'id':3,'free_bytes':1}),('stopping',{'id':3,'free_bytes':1}),('unavailable',None),('refused',None),('not_reached',{'id':0,'free_bytes':1})):
            bad=copy.deepcopy(value);bad['last_observed_before_first_pull']={'state':kind,'sample':sample};cases.append(bad)
        for bad in cases:
            with self.subTest(case=cases.index(bad)),self.assertRaises(ValueError):numeric.validate(bad,'a'*40)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/numeric.NAME
            self.assertEqual(numeric.read(path,'a'*40)['reason'],'legacy_absent')
            for raw in (' '*4097,'{','{"schema":1,"schema":1}',json.dumps(value).replace('"id": 0','"id":NaN',1)):
                path.write_text(raw)
                with self.assertRaises(ValueError):numeric.read(path,'a'*40)
            path.unlink();path.symlink_to(Path(directory)/'missing')
            with self.assertRaises(ValueError):numeric.read(path,'a'*40)
            with self.assertRaises(ValueError):numeric.write(path,value,'a'*40)

    def test_invalid_present_is_refused_before_generic_collection_and_missing_is_unavailable(self):
        import disk_feedback as numeric
        from test_hosted import metadata
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);meta=metadata(root);(meta/numeric.NAME).write_text('{')
            with patch.object(hosted.runtime.ci,'collect') as copy:
                with self.assertRaises(ValueError):hosted.collect(root/'private',root/'public',metadata=meta)
                copy.assert_not_called();self.assertFalse((root/'public').exists())

    def test_closed_state_combinations_and_nested_json_negatives(self):
        import copy
        import itertools
        import disk_feedback as numeric
        value=self.value()
        allowed={('observed','none','after_bounded_join'),
                 ('unavailable','entry_unavailable','not_entered'),('unavailable','unsealed_exit','unsealed_exit'),
                 ('unavailable','read_unavailable','after_bounded_join'),('unavailable','legacy_stop','after_bounded_join')}
        allowed.update(('refused',reason,cutoff) for reason in ('numeric_refused','sample_failure')
                       for cutoff in ('not_entered','unsealed_exit','after_bounded_join'))
        for state,reason,cutoff in itertools.product(numeric.STATES,numeric.REASONS,numeric.CUTOFFS):
            candidate=copy.deepcopy(value);candidate.update(state=state,reason=reason,cutoff=cutoff)
            if (state,reason,cutoff) in allowed:numeric.validate(candidate,'a'*40)
            else:
                with self.subTest(state=state,reason=reason,cutoff=cutoff),self.assertRaises(ValueError):numeric.validate(candidate,'a'*40)
        for key in value:
            candidate=copy.deepcopy(value);del candidate[key]
            with self.assertRaises(ValueError):numeric.validate(candidate,'a'*40)
        candidate=copy.deepcopy(value);candidate['private-canary']='must never publish'
        with self.assertRaises(ValueError):numeric.validate(candidate,'a'*40)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/numeric.NAME
            for raw in (json.dumps(value).replace('"id": 0','"id":0,"id":0',1),
                        json.dumps(value).replace('"free_bytes": 21474836480','"free_bytes":Infinity',1)):
                path.write_text(raw)
                with self.assertRaises(ValueError):numeric.read(path,'a'*40)
            path.unlink();path.mkdir()
            with self.assertRaises(ValueError):numeric.read(path,'a'*40)
            with self.assertRaises(ValueError):numeric.write(path,value,'a'*40)

    def test_committed_writer_does_not_delete_recreated_foreign_temp(self):
        import disk_feedback as numeric
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/numeric.NAME;temporary=root/'.resource-disk-samples.new'
            original=numeric.os.replace
            def replace(source,destination):
                original(source,destination)
                temporary.write_text('next writer owns this file')
            with patch.object(numeric.os,'replace',side_effect=replace):numeric.write(path,self.value(),'a'*40)
            self.assertTrue(temporary.is_file(),'committed writer deleted another writer temporary')
            self.assertEqual(temporary.read_text(),'next writer owns this file')
            self.assertEqual(numeric.read(path,'a'*40),self.value())

    def test_atomic_temp_collision_and_cleanup_never_replace_primary(self):
        import disk_feedback as numeric
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/numeric.NAME;temp=root/'.resource-disk-samples.new';temp.write_text('owned sentinel')
            with self.assertRaises(FileExistsError):numeric.write(path,self.value(),'a'*40)
            self.assertEqual(temp.read_text(),'owned sentinel');temp.unlink()
            error=OSError('primary')
            original=Path.unlink
            def cleanup(path,*args,**kwargs):
                if path==temp:raise OSError('secondary')
                return original(path,*args,**kwargs)
            try:
                with patch.object(numeric.os,'replace',side_effect=error),patch.object(Path,'unlink',side_effect=cleanup,autospec=True):
                    with self.assertRaises(OSError) as caught:numeric.write(path,self.value(),'a'*40)
                self.assertIs(caught.exception,error)
            finally:
                if temp.exists():temp.unlink()


class Preparation(unittest.TestCase):
    def exercise(self,root,*,primary=None,write_failure=None,seal_failure=None,snapshot_failure=None):
        from contextlib import ExitStack,contextmanager
        from disk_samples import DiskSamples
        import disk_feedback as numeric
        source={'checkout_sha':'a'*40,'run_id':'123','run_attempt':'1'}
        images=root/'images.json';events=[];view=DiskSamples();view._baseline(20*1024**3)
        @contextmanager
        def guard(path,**options):
            self.assertIs(options['observe_samples'],True)
            try:yield view
            finally:
                if seal_failure is not None:raise seal_failure
                view._seal()
        def command(args,*positional,**options):
            events.append(options['stage'])
            if primary is not None:raise primary
            if args[1]=='pull':
                # The checkpoint must already exist before the original command boundary.
                self.assertTrue(record.checkpoint_taken)
                view._safe(view._point(19*1024**3))
        record=numeric.Record('a'*40)
        with ExitStack() as stack:
            stack.enter_context(patch.object(hosted,'metadata_source',return_value=(source,{'ready':True})))
            stack.enter_context(patch.object(numeric,'Record',return_value=record))
            stack.enter_context(patch.object(hosted.runtime.ci,'read_command',return_value=''))
            stack.enter_context(patch.object(hosted.runtime.pilot.daemon,'identify',return_value={'storage':'/synthetic','endpoint':'synthetic'}))
            stack.enter_context(patch.object(hosted.runtime.pilot,'disk_budget',side_effect=guard))
            stack.enter_context(patch.object(hosted,'command',side_effect=command))
            stack.enter_context(patch.object(hosted.runtime.pilot,'assert_docker_identity'))
            stack.enter_context(patch.object(hosted.runtime.pilot,'command',side_effect=['sha256:'+'b'*64,'sha256:'+'c'*64]))
            if write_failure is not None:stack.enter_context(patch.object(numeric,'write',side_effect=write_failure))
            if snapshot_failure is not None:stack.enter_context(patch.object(DiskSamples,'current',new_callable=lambda:property(lambda self:(_ for _ in ()).throw(snapshot_failure))))
            hosted.prepare(root,images)
        return record,events,images

    def test_first_pull_is_once_before_command_and_retains_stale_baseline(self):
        import disk_feedback as numeric
        with tempfile.TemporaryDirectory() as directory:
            record,events,images=self.exercise(Path(directory))
            self.assertEqual(events[:3],['backend_build','foundation_build','preload_grafana'])
            self.assertEqual(record.value['last_observed_before_first_pull'],{'state':'baseline','sample':{'id':0,'free_bytes':20*1024**3}})
            self.assertGreater(record.value['latest_safe']['id'],1)
            self.assertTrue(images.is_file())
            self.assertEqual(numeric.read(Path(directory)/numeric.NAME,'a'*40),record.value)

    def test_primary_command_timeout_interrupt_and_traceback_survive_secondary_persistence_failure(self):
        import subprocess
        import traceback
        for label,error in (('command',RuntimeError('original')),('timeout',subprocess.TimeoutExpired('owned',1)),
                            ('interrupt',KeyboardInterrupt('original')),('exit',SystemExit(9))):
            with self.subTest(case=label),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                try:self.exercise(root,primary=error,write_failure=OSError('secondary'))
                except BaseException as caught:
                    self.assertIs(caught,error)
                    names=[frame.name for frame in traceback.extract_tb(caught.__traceback__)]
                    self.assertEqual(names[-1],'command');self.assertNotIn('persist',names)
                else:self.fail('original exception lost')
                self.assertFalse((root/'images.json').exists())

    def test_numeric_persist_seal_and_snapshot_refusals_block_otherwise_success_manifest(self):
        for label,options in (('persist',{'write_failure':OSError('owned')}),
                              ('seal',{'seal_failure':ValueError('owned')}),
                              ('snapshot',{'snapshot_failure':ValueError('owned')})):
            with self.subTest(case=label),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                with self.assertRaises((OSError,ValueError)):self.exercise(root,**options)
                self.assertFalse((root/'images.json').exists())

    def test_committed_write_never_probes_released_temp_path(self):
        original=Path.is_file
        def inspect(path):
            if path.name=='.resource-disk-samples.new':raise AssertionError('released path probed')
            return original(path)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(Path,'is_file',autospec=True,side_effect=inspect):
                self.exercise(root)
            self.assertTrue((root/'images.json').is_file())
            self.assertTrue((root/hosted.disk_feedback.NAME).is_file())

    def test_stopping_first_pull_and_unsealed_prefix_are_recorded_without_safety_promotion(self):
        import disk_feedback as numeric
        from disk_samples import DiskSamples
        for sealed in (False,True):
            with self.subTest(sealed=sealed):
                view=DiskSamples();view._baseline(20*1024**3)
                view._safe(view._point(19*1024**3));view._stopping(view._point(16*1024**3))
                record=numeric.Record('a'*40);record.attempt();record.entered(view);record.first_pull()
                if sealed:view._seal()
                record.seal();value=record.value
                self.assertEqual(value['last_observed_before_first_pull'],{'state':'stopping','sample':{'id':2,'free_bytes':16*1024**3}})
                self.assertEqual(value['latest_safe']['id'],1)
                self.assertEqual(value['cutoff'],'after_bounded_join' if sealed else 'unsealed_exit')
                if not sealed:
                    self.assertEqual(value['state'],'unavailable')
                    with self.assertRaises(ValueError):record.require()

    def test_known_type_only_and_first_numeric_refusal_remains_terminal(self):
        import disk_feedback as numeric
        from disk_samples import DiskSamples
        class Foreign:
            @property
            def current(self):raise AssertionError('foreign getter inspected')
        record=numeric.Record('a'*40);record.entered(Foreign());record.first_pull();record.seal()
        self.assertEqual(record.value['state'],'refused')
        with self.assertRaises(ValueError):record.require()
        view=DiskSamples();view._baseline(100);view._point(True);view._baseline_failure();view._safe((1,90));view._seal()
        self.assertEqual(view.final[:2],('refused','numeric_refused'))
        record=numeric.Record('a'*40);record.entered(view);record.first_pull();record.seal()
        self.assertEqual(record.value['reason'],'numeric_refused')
