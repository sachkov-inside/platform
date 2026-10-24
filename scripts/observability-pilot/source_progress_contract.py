"""Three synthetic passive-progress controls, outside the original274-test discovery."""
import ast
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


class CoreSourceProgress(unittest.TestCase):
    def test_inventory_preserves_all_baseline_methods_and_exact_additions(self):
        import core_source_progress as owner
        root=Path(__file__).parent;expected=[]
        # A fresh interpreter reproduces Caddy's actual pilot-before-Caddy search order.
        # Import identities and fixed inventories only; no original fixture body executes.
        import subprocess
        identity="""import importlib,json,sys,unittest
from pathlib import Path
pilot,caddy=map(Path,sys.argv[1:])
sys.path[:0]=[str(pilot),str(caddy)]
assert 'source_progress' not in sys.modules and 'core_source_progress' not in sys.modules
caddy_owner=importlib.import_module('source_progress')
core_owner=importlib.import_module('core_source_progress')
assert Path(caddy_owner.__file__).resolve()==caddy/'source_progress.py'
assert Path(core_owner.__file__).resolve()==pilot/'core_source_progress.py'
assert issubclass(caddy_owner.ProgressResult,unittest.TextTestResult)
assert issubclass(core_owner.PassiveRunner,unittest.TextTestRunner)
print(json.dumps([len(caddy_owner.SOURCE_IDS),len(core_owner.SOURCE_IDS)]))
"""
        result=subprocess.run([sys.executable,'-c',identity,str(root.resolve()),
            str(root.resolve().parent/'observability-caddy-storage')],capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0,'closed Core/Caddy module identity refused')
        self.assertEqual(result.stdout,b'[80, 274]\n')
        for path in sorted(root.glob('test_*.py')):
            for cls in ast.parse(path.read_text()).body:
                if isinstance(cls,ast.ClassDef):
                    expected.extend(path.stem+'.'+cls.name+'.'+method.name for method in cls.body
                        if isinstance(method,ast.FunctionDef) and method.name.startswith('test_'))
        self.assertEqual(len(expected),274)
        self.assertEqual(tuple(sorted(expected)),owner.SOURCE_IDS)
        self.assertEqual(len(json.dumps(list(owner.SOURCE_IDS),separators=(',',':')).encode()),30713)
        self.assertLessEqual((root/'source-tests.json').stat().st_size,32768)
        self.assertEqual(len([node for node in ast.parse(Path(__file__).read_text()).body
            if isinstance(node,ast.ClassDef) for method in node.body
            if isinstance(method,ast.FunctionDef) and method.name.startswith('test_')]),3)
        suite=unittest.TestLoader().discover(str(root),pattern='test_*.py')
        mapping=owner.verify_inventory(suite)
        self.assertEqual(len(mapping),274)
        with self.assertRaisesRegex(ValueError,'^closed Core source inventory refused$'):
            owner.verify_inventory(unittest.TestSuite())

    def test_markers_preserve_first_primary_and_completed_is_not_success(self):
        import core_source_progress as owner
        # Synthetic body only; its identity is an existing fixed source ID, not original fixture execution.
        identifier=owner.SOURCE_IDS[0];module,cls,method=identifier.split('.')
        case=type(cls,(unittest.TestCase,),{'__module__':module,method:lambda self:self.fail('controlled private-canary')})(method)
        with patch.object(owner,'SOURCE_IDS',(identifier,)):
            stream=io.StringIO();runner=owner.PassiveRunner(stream=stream)
            result=runner.run(unittest.TestSuite([case]))
        self.assertFalse(result.wasSuccessful());self.assertEqual(result.testsRun,1)
        self.assertIn('CORE_SOURCE_V1 start '+identifier+'\n',stream.getvalue())
        self.assertIn('CORE_SOURCE_V1 completed '+identifier+'\n',stream.getvalue())

        # Callbacks use stable objects, never a later overridden id/getter or private representation.
        mapping={id(case):(case,identifier)}
        class FixedResult(owner.PassiveResult):_source_objects=mapping
        events=[]
        class Writer(io.StringIO):
            fault=None
            def write(self,value):
                if 'CORE_SOURCE' in value:
                    events.append('marker.start' if ' start ' in value else 'marker.completed')
                    if self.fault is not None:raise self.fault
                return super().write(value)
            def flush(self):events.append('flush');return super().flush()
        writer=Writer();result=FixedResult(writer,True,1)
        actual_start=unittest.TextTestResult.startTest;actual_stop=unittest.TextTestResult.stopTest
        def start(result,test):events.append('super.start');return actual_start(result,test)
        def stop(result,test):events.append('super.stop');return actual_stop(result,test)
        with patch.object(type(case),'id',side_effect=AssertionError('foreign id')), \
             patch.object(unittest.TextTestResult,'startTest',start),patch.object(unittest.TextTestResult,'stopTest',stop):
            result.startTest(case);result.stopTest(case)
        self.assertEqual(events,['super.start','marker.start','flush','super.stop','marker.completed','flush'])
        for callback in ('startTest','stopTest'):
            primary=RuntimeError('controlled super failure');events.clear();writer.seek(0);writer.truncate()
            with patch.object(unittest.TextTestResult,callback,side_effect=primary):
                try:getattr(result,callback)(case)
                except RuntimeError as error:self.assertIs(error,primary)
                else:self.fail('superclass failure suppressed')
            self.assertEqual(events,[]);self.assertEqual(writer.getvalue(),'')
        for callback in ('startTest','stopTest'):
            for fault in (OSError('optional marker loss'),ValueError('private-canary'),KeyboardInterrupt(),SystemExit()):
                writer.fault=fault
                try:getattr(result,callback)(case)
                except BaseException as error:
                    self.assertIs(error,fault);self.assertNotIsInstance(error,OSError)
                else:self.assertIsInstance(fault,OSError)
            for primary in (AssertionError('active primary'),KeyboardInterrupt(),SystemExit()):
                for same,fault in ((True,None),(False,ValueError('private-canary')),(False,KeyboardInterrupt()),(False,SystemExit())):
                    try:raise primary
                    except BaseException:
                        before=sys.exc_info()[2];writer.fault=primary if same else fault
                        getattr(result,callback)(case)
                        self.assertIs(BaseException.__traceback__.__get__(primary),before)
        writer.fault=None

        # Project actual stdlib result records without executing any of the original274 bodies.
        cases=[CoreSourceProgress(method) for method in PROTOCOL_METHODS]
        observed=unittest.TextTestResult(io.StringIO(),True,1)
        for case in cases:observed.startTest(case);observed.stopTest(case)
        primaries=[]
        for case,callback in ((cases[0],observed.addFailure),(cases[2],observed.addError)):
            try:raise AssertionError('controlled private-canary')
            except AssertionError as error:
                primaries.append(error);callback(case,sys.exc_info())
        failure_record=observed.failures[0];error_record=observed.errors[0]
        tracebacks=[error.__traceback__ for error in primaries]
        output=io.StringIO()
        with patch.object(unittest.TextTestRunner,'run',return_value=observed):
            returned=ProtocolRunner(stream=output).run(unittest.TestSuite())
        self.assertIs(returned,observed)
        self.assertEqual(output.getvalue(),'CORE_PROTOCOL_V1 failures F-E\n')
        self.assertIs(observed.failures[0],failure_record);self.assertIs(observed.errors[0],error_record)
        for error,before in zip(primaries,tracebacks):self.assertIs(error.__traceback__,before)
        # Exercise the actual comparison seam, not a duplicate parity model.
        parity=cases[2];fixed=('fixed',)*9
        for index,label in enumerate(('exit','program','warnings','tests','failures','errors','skips','discovery','output')):
            unequal=list(fixed);unequal[index]='controlled private-canary'
            failed=unittest.TextTestResult(io.StringIO(),True,1)
            for case in cases:failed.startTest(case);failed.stopTest(case)
            try:parity._assert_parity_records(fixed,tuple(unequal))
            except AssertionError:failed.addFailure(parity,sys.exc_info())
            else:self.fail('unequal parity component accepted')
            self.assertEqual(_protocol_failure_summary(failed),'CORE_PROTOCOL_V1 failures --F field '+label+'\n')
            parity._assert_parity_records(fixed,fixed)
            self.assertIsNone(parity._parity_field)
            # An actual later failure on the same case has no stale comparison attribution.
            try:parity.fail('controlled later private-canary')
            except AssertionError:
                later=unittest.TextTestResult(io.StringIO(),True,1)
                for case in cases:later.startTest(case);later.stopTest(case)
                later.addFailure(parity,sys.exc_info())
            self.assertEqual(_protocol_failure_summary(later),'CORE_PROTOCOL_V1 failures --F\n')
        class ForeignField:
            def __getattribute__(self,name):raise AssertionError('foreign field read')
        class ForeignString(str):pass
        for invalid in (None,'private-canary',ForeignString('output'),ForeignField()):
            parity.__dict__['_parity_field']=invalid
            self.assertEqual(_protocol_failure_summary(observed),'CORE_PROTOCOL_V1 failures F-E\n')
        del parity.__dict__['_parity_field']
        def forbidden_field(case):raise AssertionError('foreign field getter')
        with patch.object(CoreSourceProgress,'_parity_field',property(forbidden_field),create=True):
            self.assertEqual(_protocol_failure_summary(observed),'CORE_PROTOCOL_V1 failures F-E\n')
        cases[0].__dict__['_parity_field']='output'
        self.assertEqual(_protocol_failure_summary(observed),'CORE_PROTOCOL_V1 failures F-E\n')
        parity._parity_field='output'
        with patch.object(unittest.TextTestRunner,'run',return_value=observed):
            output=io.StringIO();self.assertIs(ProtocolRunner(stream=output).run(unittest.TestSuite()),observed)
        self.assertEqual(output.getvalue(),'CORE_PROTOCOL_V1 failures F-E field output\n')
        self.assertIs(observed.failures[0],failure_record);self.assertIs(observed.errors[0],error_record)
        for error,before in zip(primaries,tracebacks):self.assertIs(error.__traceback__,before)
        parity._parity_field=None
        class ForeignCase(CoreSourceProgress):pass
        foreign_case=ForeignCase(PROTOCOL_METHODS[2]);foreign_case._parity_field='output'
        with patch.object(observed,'errors',[(foreign_case,'opaque')]):
            self.assertIsNone(_protocol_failure_summary(observed))
        with patch.dict(parity.__dict__,{'_testMethodName':ForeignString(PROTOCOL_METHODS[2])}):
            self.assertIsNone(_protocol_failure_summary(observed))
        class BrokenWriter(io.StringIO):
            def write(self,value):raise self.fault
        for fault in (OSError(),ValueError(),KeyboardInterrupt(),SystemExit()):
            output=BrokenWriter();output.fault=fault
            with patch.object(unittest.TextTestRunner,'run',return_value=observed):
                self.assertIs(ProtocolRunner(stream=output).run(unittest.TestSuite()),observed)
        successful=unittest.TextTestResult(io.StringIO(),True,1);output=io.StringIO()
        with patch.object(unittest.TextTestRunner,'run',return_value=successful):
            self.assertIs(ProtocolRunner(stream=output).run(unittest.TestSuite()),successful)
        self.assertEqual(output.getvalue(),'')
        primary=KeyboardInterrupt()
        with patch.object(unittest.TextTestRunner,'run',side_effect=primary):
            try:ProtocolRunner(stream=output).run(unittest.TestSuite())
            except KeyboardInterrupt as error:self.assertIs(error,primary)
            else:self.fail('original runner primary replaced')
        # Neither overridden id nor a foreign/subtest representation participates in projection.
        with patch.object(CoreSourceProgress,'id',side_effect=AssertionError('foreign id')):
            self.assertEqual(_protocol_failure_summary(observed),'CORE_PROTOCOL_V1 failures F-E\n')
        class Foreign:
            def __getattribute__(self,name):raise AssertionError('foreign attribute')
        self.assertIsNone(_protocol_failure_summary(Foreign()))
        observed.failures=[(cases[0],Foreign())]
        self.assertEqual(_protocol_failure_summary(observed),'CORE_PROTOCOL_V1 failures F-E\n')
        subtest=unittest.case._SubTest(cases[0],None,{})
        for foreign in (Foreign(),subtest,CoreSourceProgress('runTest')):
            observed.failures=[(foreign,'opaque')]
            self.assertIsNone(_protocol_failure_summary(observed))
        observed.failures=[failure_record,failure_record]
        self.assertIsNone(_protocol_failure_summary(observed))
        observed.failures=[failure_record];observed.errors=[(cases[0],'opaque')]
        self.assertIsNone(_protocol_failure_summary(observed))

        # Actual third-method assertions, not a duplicate method or a fake stage setter.
        for target in ('source_shape','import_order','count'):
            parity=CoreSourceProgress(PROTOCOL_METHODS[2]);calls=[];helper_returns=[];origins=[]
            primary=AssertionError('controlled private-stage-canary')
            actual_equal=parity.assertEqual;actual_records=parity._assert_parity_records
            def records(*args):
                answer=actual_records(*args);helper_returns.append(True);return answer
            def equal(left,right,*args,**kwargs):
                calls.append(True)
                selected=(target=='source_shape' and len(calls)==1
                    or target=='import_order' and type(left) is int and type(right) is int and left==right==1 and not helper_returns
                    or target=='count' and bool(helper_returns))
                if selected:
                    try:raise primary
                    except AssertionError:origins.append(sys.exc_info()[2]);raise
                return actual_equal(left,right,*args,**kwargs)
            failed=unittest.TextTestResult(io.StringIO(),True,1)
            cases=[CoreSourceProgress(PROTOCOL_METHODS[0]),CoreSourceProgress(PROTOCOL_METHODS[1]),parity]
            for case in cases:failed.startTest(case);failed.stopTest(case)
            with patch.object(parity,'assertEqual',side_effect=equal),patch.object(parity,'_assert_parity_records',side_effect=records):
                try:parity.test_runner_uses_original_discovery_and_refuses_inventory_drift()
                except AssertionError as caught:
                    self.assertIs(caught,primary)
                    trace=BaseException.__traceback__.__get__(caught);chain=[]
                    while trace:chain.append(trace);trace=trace.tb_next
                    self.assertIn(origins[0],chain)
                    failed.addFailure(parity,sys.exc_info())
                else:self.fail('actual original assertion did not fail')
            self.assertEqual(_protocol_failure_summary(failed),'CORE_PROTOCOL_V1 failures --F stage '+target+'\n')

            # The same real case is re-entered after a failure; successful completion clears it.
            parity.test_runner_uses_original_discovery_and_refuses_inventory_drift()
            self.assertIsNone(parity._parity_stage);self.assertIsNone(parity._parity_field)
        stages=('owner_import','source_shape','inventory_guard','stdlib_imports','fixture_setup',
            'import_order','execution','record','import_list','comparison_tail','count','exit',
            'refusal','import_guard','import_tail')
        self.assertEqual(PROTOCOL_STAGES,stages)
        self.assertEqual(max(len(('CORE_PROTOCOL_V1 failures --F stage '+stage+'\n').encode('ascii')) for stage in stages),52)
        parity=CoreSourceProgress(PROTOCOL_METHODS[2]);cases=[CoreSourceProgress(method) for method in PROTOCOL_METHODS[:2]]+[parity]
        def failed_stage(category='F',case=None):
            failed=unittest.TextTestResult(io.StringIO(),True,1)
            for current in cases:failed.startTest(current);failed.stopTest(current)
            (failed.failures if category=='F' else failed.errors).append((parity if case is None else case,object()))
            return failed
        for stage in stages:
            parity._parity_stage=stage
            for category in ('F','E'):
                self.assertEqual(_protocol_failure_summary(failed_stage(category)),
                    'CORE_PROTOCOL_V1 failures --'+category+' stage '+stage+'\n')
        class ForeignStage:
            def __getattribute__(self,_):raise AssertionError('foreign stage getter')
            def __eq__(self,_):raise AssertionError('foreign stage comparison')
            def __str__(self):raise AssertionError('foreign stage string')
        class ForeignStageString(str):pass
        for invalid in (None,'private-stage-canary',ForeignStageString('exit'),ForeignStage()):
            parity.__dict__['_parity_stage']=invalid
            self.assertEqual(_protocol_failure_summary(failed_stage()),'CORE_PROTOCOL_V1 failures --F\n')
            parity._parity_field='output'
            self.assertEqual(_protocol_failure_summary(failed_stage()),'CORE_PROTOCOL_V1 failures --F field output\n')
            parity._parity_field=None
        def forbidden_stage(_):raise AssertionError('foreign stage property')
        parity.__dict__.pop('_parity_stage',None)
        with patch.object(CoreSourceProgress,'_parity_stage',property(forbidden_stage),create=True):
            self.assertEqual(_protocol_failure_summary(failed_stage()),'CORE_PROTOCOL_V1 failures --F\n')
        parity._parity_stage='exit'
        self.assertEqual(_protocol_failure_summary(failed_stage(case=cases[0])),'CORE_PROTOCOL_V1 failures F--\n')
        foreign=type('ForeignCase',(CoreSourceProgress,),{})(PROTOCOL_METHODS[2]);foreign._parity_stage='exit'
        self.assertIsNone(_protocol_failure_summary(failed_stage(case=foreign)))
        self.assertIsNone(_protocol_failure_summary(failed_stage(case=unittest.case._SubTest(parity,None,{}))))
        # Only the unchanged aggregate assertion rejects a tenth tuple component.
        original=('fixed',)*9
        failed=failed_stage();failed.failures=[]
        try:parity._assert_parity_records(original+('left',),original+('right',))
        except AssertionError:failed.addFailure(parity,sys.exc_info())
        else:self.fail('original aggregate assertion lost')
        self.assertEqual(_protocol_failure_summary(failed),'CORE_PROTOCOL_V1 failures --F stage comparison_tail\n')
        parity._assert_parity_records(original,original)
        self.assertIsNone(parity._parity_stage)
        try:parity.fail('controlled later private-stage-canary')
        except AssertionError:
            later=failed_stage();later.failures=[];later.addFailure(parity,sys.exc_info())
        self.assertEqual(_protocol_failure_summary(later),'CORE_PROTOCOL_V1 failures --F\n')

    def test_runner_uses_original_discovery_and_refuses_inventory_drift(self):
        self._parity_field=None
        self._parity_stage=None
        self._parity_stage='owner_import'
        import core_source_progress as owner
        self._parity_stage='source_shape'
        source=Path(__file__).with_name('source_runner.py').read_text()
        tree=ast.parse(source)
        self.assertEqual(ast.dump(tree.body[0]),ast.dump(ast.Import(names=[ast.alias(name='sys')])))
        self.assertIsInstance(tree.body[1],ast.If)
        self.assertIn("sys.platform!='linux'",source)
        self.assertIn('unittest.main(module=None,testRunner=PassiveRunner)',source)
        self._parity_stage='inventory_guard'
        with patch.object(owner,'SOURCE_IDS',('test_fixed.Fixed.test_only',)):
            with self.assertRaisesRegex(ValueError,'^closed Core source inventory refused$'):
                owner.PassiveRunner(stream=io.StringIO()).run(unittest.TestSuite())

        # Compare actual stdlib entry and fixed script entry with a tiny discovery seam only.
        # No original fixture body is run, including when this protocol is checked on Darwin.
        self._parity_stage='stdlib_imports'
        import builtins
        import importlib
        import os
        import re
        main_module=importlib.import_module('unittest.main')
        original_main_source=Path(unittest.__file__).with_name('__main__.py').read_text()
        original_program=unittest.TestProgram
        actual_import=builtins.__import__
        root=Path(__file__).parent.resolve();saved_path=sys.path[:];saved_argv=sys.argv[:]
        outputs=[]
        for empty in (False,True):
            records=[]
            for legacy in (True,False):
                self._parity_stage='fixture_setup'
                discovered=[];imported=[];programs=[];stream=io.StringIO()
                identifiers=() if empty else owner.SOURCE_IDS[:3]
                cases=[]
                for index,identifier in enumerate(identifiers):
                    module,cls,method=identifier.split('.')
                    def body(case,index=index):
                        if index==1:case.skipTest('controlled skip')
                        if index==2:
                            with case.subTest(part='fixed'):case.fail('controlled failure')
                    cases.append(type(cls,(unittest.TestCase,),{'__module__':module,method:body})(method))
                def discover(loader,start_dir,pattern='test*.py',top_level_dir=None):
                    discovered.append((start_dir,pattern,top_level_dir,sys.argv[:],sys.path[0]))
                    if str(root) not in sys.path:sys.path.insert(0,str(root))
                    return unittest.TestSuite(cases)
                class Program(original_program):
                    def __init__(self,*args,**kwargs):
                        try:super().__init__(*args,**kwargs)
                        finally:programs.append(self)
                def importing(name,*args,**kwargs):
                    if name=='core_source_progress':
                        self._parity_stage='import_order'
                        self.assertEqual(len(discovered),1)
                        self.assertEqual(sys.path[0],str(root));imported.append(name)
                        self._parity_stage='execution'
                    return actual_import(name,*args,**kwargs)
                self._parity_stage='execution'
                try:
                    sys.path[:]=[os.getcwd() if legacy else str(root)]+saved_path[1:]
                    sys.argv[:]=[str(Path(unittest.__file__).with_name('__main__.py')),'discover','-s',
                        'scripts/observability-pilot','-p','test_*.py'] if legacy else [str(root/'source_runner.py')]
                    with patch.object(sys,'platform','linux'),patch.object(sys,'stderr',stream), \
                         patch.object(owner,'SOURCE_IDS',identifiers), \
                         patch.object(unittest.TestLoader,'discover',discover), \
                         patch.object(unittest,'main',Program),patch.object(main_module,'main',Program), \
                         patch.object(unittest.runner.time,'perf_counter',return_value=0), \
                         patch.object(builtins,'__import__',side_effect=importing):
                        try:exec(compile(original_main_source if legacy else source,
                            str(Path(unittest.__file__).with_name('__main__.py')) if legacy else str(root/'source_runner.py'),'exec'),
                            {'__name__':'__main__','__package__':'unittest' if legacy else None})
                        except SystemExit as error:code=error.code
                        else:self.fail('original TestProgram exit behavior lost')
                    self._parity_stage='record'
                    program=programs[0];result=program.result
                    output=stream.getvalue()
                    if not legacy:
                        output=re.sub(r'\nCORE_SOURCE_V1 (?:start|completed) [A-Za-z0-9_.]+\n','',output)
                    records.append((code,program.progName,program.warnings,result.testsRun,len(result.failures),
                                    len(result.errors),len(result.skipped),discovered,output))
                    self._parity_stage='import_list'
                    self.assertEqual(imported,[] if legacy else ['core_source_progress'])
                finally:sys.path[:]=saved_path;sys.argv[:]=saved_argv
            self._assert_parity_records(records[0],records[1])
            self._parity_stage='count'
            self.assertEqual(records[0][3],0 if empty else 3)
            outputs.append(records[0][0])
        self._parity_stage='exit'
        self.assertEqual(outputs[0],1)
        # Unsupported script/argv paths refuse before even importing os/unittest/progress.
        for platform,argv in (('darwin',['fixed']),('linux',['fixed','extra'])):
            self._parity_stage='refusal'
            imports=[]
            def only_sys(name,*args,**kwargs):
                imports.append(name)
                self._parity_stage='import_guard'
                self.assertEqual(name,'sys')
                self._parity_stage='refusal'
                return actual_import(name,*args,**kwargs)
            compiled=compile(source,str(root/'source_runner.py'),'exec')
            with patch.object(sys,'platform',platform),patch.object(sys,'argv',argv):
                with self.assertRaisesRegex(SystemExit,'^closed Core source runner refused$'):
                    with patch.object(builtins,'__import__',side_effect=only_sys):
                        exec(compiled,{'__name__':'__main__'})
            self._parity_stage='import_tail'
            self.assertEqual(imports,['sys'])
        self._parity_stage=None

    def _assert_parity_records(self,left,right):
        self._parity_field=None
        self._parity_stage=None
        for index,field in enumerate(PARITY_FIELDS):
            self._parity_field=field
            self.assertEqual(left[index],right[index])
            self._parity_field=None
        self._parity_stage='comparison_tail'
        self.assertEqual(left,right)
        self._parity_stage=None


PARITY_FIELDS=('exit','program','warnings','tests','failures','errors','skips','discovery','output')


PROTOCOL_STAGES=('owner_import','source_shape','inventory_guard','stdlib_imports','fixture_setup',
    'import_order','execution','record','import_list','comparison_tail','count','exit',
    'refusal','import_guard','import_tail')


PROTOCOL_METHODS=(
    'test_inventory_preserves_all_baseline_methods_and_exact_additions',
    'test_markers_preserve_first_primary_and_completed_is_not_success',
    'test_runner_uses_original_discovery_and_refuses_inventory_drift',
)


def _protocol_failure_summary(result):
    # Only stdlib-owned result/case identities are read; formatted traceback members are opaque.
    if type(result) is not unittest.TextTestResult or result.testsRun!=3:return None
    if any(type(values) is not list or values for values in
           (result.skipped,result.expectedFailures,result.unexpectedSuccesses)):return None
    vector=['-']*3;field=stage=None
    for values,category in ((result.failures,'F'),(result.errors,'E')):
        if type(values) is not list or len(values)>3:return None
        for entry in values:
            if type(entry) is not tuple or len(entry)!=2:return None
            case=entry[0]
            if type(case) is not CoreSourceProgress:return None
            own=unittest.TestCase.__dict__['__dict__'].__get__(case,CoreSourceProgress)
            if type(own) is not dict:return None
            method=own.get('_testMethodName')
            if type(method) is not str or method not in PROTOCOL_METHODS:return None
            index=PROTOCOL_METHODS.index(method)
            if index==2:
                value=own.get('_parity_field')
                if type(value) is str and value in PARITY_FIELDS:field=value
                else:
                    value=own.get('_parity_stage')
                    if type(value) is str and value in PROTOCOL_STAGES:stage=value
            if vector[index]!='-':return None
            vector[index]=category
    if vector==['-']*3:return None
    return 'CORE_PROTOCOL_V1 failures '+''.join(vector)+(' field '+field if field is not None else ' stage '+stage if stage is not None else '')+'\n'


class ProtocolRunner(unittest.TextTestRunner):
    def run(self,test):
        result=super().run(test)
        if not result.wasSuccessful():
            # The failed stdlib verdict is already authoritative; optional observation cannot replace it.
            try:
                summary=_protocol_failure_summary(result)
                if summary is not None:self.stream.write(summary);self.stream.flush()
            except BaseException:pass
        return result


if __name__=='__main__':unittest.main(testRunner=ProtocolRunner)
