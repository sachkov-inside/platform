"""Fixed timing feedback does not drive smoke calls or deadlines."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import core_timing


class CoreTiming(unittest.TestCase):
    def test_active_before_work_and_completed_duration_and_cumulative_time(self):
        clock=iter((10,10.125,10.375,10.875))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);owner=core_timing.Timing(root,'a'*40,clock=lambda:next(clock))
            with owner.stage('plugin_install'):
                value=core_timing.read(root/core_timing.NAME,'a'*40)
                self.assertEqual(value['active'],'plugin_install')
                self.assertEqual(value['stages'][0]['outcome'],'running')
            owner.finish()
            value=core_timing.read(root/core_timing.NAME,'a'*40)
            self.assertEqual(value['stages'][0]['duration']['ms'],250)
            self.assertEqual(value['elapsed']['ms'],875)
            self.assertEqual(value['state'],'running')
            with self.assertRaises(ValueError):owner.require()

    def test_secondary_persistence_rethrowing_same_primary_keeps_original_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            owner=core_timing.Timing(Path(directory),'a'*40,clock=lambda:1)
            error=RuntimeError('owned primary')
            try:raise error
            except RuntimeError:
                original=sys.exc_info()[2]
                with patch.object(core_timing,'write',side_effect=error):owner.finish()
                self.assertIs(BaseException.__traceback__.__get__(error),original)

    def test_legacy_and_invalid_present_are_distinct_and_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/core_timing.NAME
            self.assertEqual(core_timing.read(path,'a'*40)['state'],'unavailable')
            for raw in ('{',' '*16385,'{"schema":1,"schema":1}'):
                path.write_text(raw)
                with self.assertRaises(ValueError):core_timing.read(path,'a'*40)

    def test_original_smoke_statements_and_worker_calls_are_preserved(self):
        import ast
        import pilot
        source=Path(pilot.__file__)
        before=ast.parse((source.parent/'fixtures/core_calls_7271.py').read_text())
        after=ast.parse(source.read_text())
        def function(tree,name):return next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
        class Original(ast.NodeTransformer):
            def visit_With(self,node):
                call=node.items[0].context_expr
                if isinstance(call,ast.Call) and isinstance(call.func,ast.Name) and call.func.id=='stage':
                    return [self.visit(n) for n in node.body]
                return self.generic_visit(node)
            def visit_Assign(self,node):
                if any(isinstance(n,ast.Name) and n.id=='stage' for n in node.targets):return None
                return self.generic_visit(node)
        old=function(before,'smoke');new=Original().visit(function(after,'smoke'));new.args=old.args
        self.assertEqual(ast.dump(new),ast.dump(old))
        def calls(tree):
            selected=[]
            class Calls(ast.NodeVisitor):
                def visit_Call(self,node):
                    owner=node.func.value.id if isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) else None
                    if owner in ('timing','core_timing'):return
                    node.keywords=[kw for kw in node.keywords if kw.arg!='timing']
                    selected.append(ast.dump(node));self.generic_visit(node)
            Calls().visit(tree);return selected
        self.assertEqual(calls(function(after,'run_worker')),calls(function(before,'run_worker')))

    def test_actual_worker_observes_before_original_calls_and_keeps_original_failure(self):
        from contextlib import nullcontext
        import os
        import pilot
        import json
        import source_status_scenario
        for fail in (False,True):
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);error=RuntimeError('original command')
                (root/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'synthetic'}))
                (root/'auth.json').write_text('{"users":[{"bearer_token":"synthetic"}]}')
                (root/'evidence.json').write_text(json.dumps({'source':'a'*40,'missing':[],'status':'failed','scope':core_timing.EVIDENCE_SCOPE}))
                def active(name):self.assertEqual(core_timing.read(root/core_timing.NAME,'a'*40)['active'],name)
                def command(args,**kw):
                    active('compose_validate' if args[-1]=='--quiet' else 'compose_up')
                    if fail:raise error
                    return ''
                def smoke(token,output,compose,*,timing):
                    for name in core_timing.STAGES[3:21]:
                        with timing.stage(name):active(name)
                    return {}
                def freshness(*args,**kwargs):active('freshness');return {'duration_seconds':1}
                with patch.object(pilot,'worker_storage_guard',return_value=nullcontext()), \
                     patch.object(pilot,'install_plugin',side_effect=lambda output:active('plugin_install')), \
                     patch.object(pilot,'command',side_effect=command),patch.object(pilot,'smoke',side_effect=smoke), \
                     patch.object(pilot,'compose_plan',return_value={}),patch.object(source_status_scenario,'run',side_effect=freshness):
                    if fail:
                        with self.assertRaises(RuntimeError) as caught:pilot.run_worker(root)
                        self.assertIs(caught.exception,error)
                    else:pilot.run_worker(root)
                value=core_timing.read(root/core_timing.NAME,'a'*40)
                self.assertEqual(value['state'],'failed' if fail else 'passed')
                self.assertEqual(value['active'],'compose_validate' if fail else None)

    def test_clock_refusal_never_skips_original_work_and_saturation_is_bounded(self):
        for invalid in (True,float('nan'),-1,'private',2**54):
            with self.subTest(kind=type(invalid).__name__),tempfile.TemporaryDirectory() as directory:
                owner=core_timing.Timing(Path(directory),'a'*40,clock=lambda:invalid);work=[]
                with owner.stage('plugin_install'):work.append('original')
                self.assertEqual(work,['original'])
                with self.assertRaises(ValueError):owner.require()
                self.assertEqual(owner.value['reason'],'clock_refused')
        clock=iter((0,600,601,602))
        with tempfile.TemporaryDirectory() as directory:
            owner=core_timing.Timing(Path(directory),'a'*40,clock=lambda:next(clock))
            with owner.stage('plugin_install'):pass
            owner.finish();row=owner.value['stages'][0]
            self.assertEqual(row['start'],{'ms':600000,'saturated':False})
            self.assertEqual(row['end'],{'ms':600000,'saturated':True})
            self.assertEqual(row['duration'],{'ms':1000,'saturated':False})
            core_timing.validate(owner.value,'a'*40)

    def test_primary_and_same_or_different_secondary_preserve_exact_original_traceback(self):
        import subprocess
        for kind in (OSError,ValueError,RuntimeError,KeyboardInterrupt,SystemExit,subprocess.TimeoutExpired):
            for same in (False,True):
                with self.subTest(kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                    owner=core_timing.Timing(Path(directory),'a'*40,clock=lambda:1)
                    error=kind('owned',1) if kind is subprocess.TimeoutExpired else kind('owned')
                    secondary=error if same else OSError('secondary')
                    try:raise error
                    except BaseException:
                        original=sys.exc_info()[2]
                        try:
                            with patch.object(core_timing,'write',side_effect=secondary):owner.finish()
                        except BaseException:self.fail('secondary escaped pending primary')
                        self.assertIs(BaseException.__traceback__.__get__(error),original)

    def test_invalid_timing_refuses_before_any_public_copy_and_legacy_is_unavailable(self):
        import ci
        import json
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);private=root/'private';private.mkdir();metadata=root/'metadata';metadata.mkdir()
            (metadata/'source.json').write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,'scope':core_timing.METADATA_SCOPE}))
            (private/core_timing.NAME).write_text('{')
            with self.assertRaises(ValueError):ci.collect(private,metadata,root/'refused')
            self.assertFalse((root/'refused').exists())
            (private/core_timing.NAME).unlink()
            ci.collect(private,metadata,root/'public')
            self.assertEqual(core_timing.read(root/'public'/core_timing.NAME,'a'*40)['state'],'unavailable')

    def test_default_smoke_has_no_timing_allocation_write_or_clock_before_original_failure(self):
        import pilot
        error=RuntimeError('original first call')
        with patch.object(core_timing,'Timing') as allocation,patch.object(core_timing,'write') as write, \
             patch.object(core_timing.time,'monotonic') as clock,patch.object(pilot,'verify_trace_store_logging',side_effect=error):
            with self.assertRaises(RuntimeError) as caught:pilot.smoke('synthetic',Path('/synthetic'),[])
        self.assertIs(caught.exception,error);allocation.assert_not_called();write.assert_not_called();clock.assert_not_called()

    def test_strict_whole_record_state_integer_source_and_nested_negatives(self):
        with tempfile.TemporaryDirectory() as directory:
            owner=core_timing.Timing(Path(directory),'a'*40,clock=lambda:1)
            for name in core_timing.STAGES:
                with owner.stage(name):pass
            owner.require();owner.finish();value=owner.value
            self.assertEqual(value['state'],'passed');self.assertLessEqual(owner.writes,50)
            cases=[]
            for key,invalid in (('schema',True),('source','b'*40),('active','private'),('reason','work_failed'),('elapsed',None)):
                bad=copy.deepcopy(value);bad[key]=invalid;cases.append(bad)
            for key,invalid in (('stage','private'),('outcome','running'),('extra',0),('end',None)):
                bad=copy.deepcopy(value);bad['stages'][0][key]=invalid;cases.append(bad)
            for key,invalid in (('ms',True),('ms',-1),('ms',600001),('ms',1.1),('saturated',1),('saturated',True),('extra',0)):
                bad=copy.deepcopy(value);bad['elapsed'][key]=invalid;cases.append(bad)
            for bad in cases:
                with self.assertRaises(ValueError):core_timing.validate(bad,'a'*40)
            bad=copy.deepcopy(value);bad['stages'].reverse()
            with self.assertRaises(ValueError):core_timing.validate(bad,'a'*40)

    def test_temp_ownership_survives_foreign_recreation_and_paths_are_strict(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/core_timing.NAME;temporary=root/'.core-stage-timing.new'
            value=core_timing.unavailable('a'*40);replace=core_timing.os.replace
            def committed(source,destination):replace(source,destination);temporary.write_text('foreign')
            with patch.object(core_timing.os,'replace',side_effect=committed):core_timing.write(path,value,'a'*40)
            self.assertEqual(temporary.read_text(),'foreign');temporary.unlink()
            held=[];error=OSError('original commit refusal')
            def failed(source,destination):
                held.append(os.open(source,os.O_RDONLY));source.unlink();source.write_text('foreign');raise error
            try:
                with patch.object(core_timing.os,'replace',side_effect=failed):
                    with self.assertRaises(OSError) as caught:core_timing.write(path,value,'a'*40)
                self.assertIs(caught.exception,error);self.assertEqual(temporary.read_text(),'foreign')
            finally:
                for fd in held:os.close(fd)
            temporary.unlink();temporary.symlink_to(root/'absent')
            with self.assertRaises(FileExistsError):core_timing.write(path,value,'a'*40)
            temporary.unlink();path.unlink();path.symlink_to(root/'absent')
            with self.assertRaises(ValueError):core_timing.read(path,'a'*40)
            with self.assertRaises(ValueError):core_timing.write(path,value,'a'*40)
            path.unlink();path.mkdir()
            with self.assertRaises(ValueError):core_timing.read(path,'a'*40)

    def test_foreign_metadata_scope_cannot_claim_core_timing_before_public_copy(self):
        import ci
        import json
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);metadata=root/'metadata';metadata.mkdir();private=root/'private';private.mkdir()
            (metadata/'source.json').write_text(json.dumps({'checkout_sha':'a'*40,'checkout_tree':'b'*40,
                'provider_execution_sha':'a'*40,'scope':'foreign-scope'}))
            with self.assertRaises(ValueError):ci.collect(private,metadata,root/'public')
            self.assertFalse((root/'public').exists())
