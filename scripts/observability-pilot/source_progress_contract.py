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

    def test_runner_uses_original_discovery_and_refuses_inventory_drift(self):
        import core_source_progress as owner
        source=Path(__file__).with_name('source_runner.py').read_text()
        tree=ast.parse(source)
        self.assertEqual(ast.dump(tree.body[0]),ast.dump(ast.Import(names=[ast.alias(name='sys')])))
        self.assertIsInstance(tree.body[1],ast.If)
        self.assertIn("sys.platform!='linux'",source)
        self.assertIn('unittest.main(module=None,testRunner=PassiveRunner)',source)
        with patch.object(owner,'SOURCE_IDS',('test_fixed.Fixed.test_only',)):
            with self.assertRaisesRegex(ValueError,'^closed Core source inventory refused$'):
                owner.PassiveRunner(stream=io.StringIO()).run(unittest.TestSuite())

        # Compare actual stdlib entry and fixed script entry with a tiny discovery seam only.
        # No original fixture body is run, including when this protocol is checked on Darwin.
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
                        self.assertEqual(len(discovered),1)
                        self.assertEqual(sys.path[0],str(root));imported.append(name)
                    return actual_import(name,*args,**kwargs)
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
                    program=programs[0];result=program.result
                    output=stream.getvalue()
                    if not legacy:
                        output=re.sub(r'\nCORE_SOURCE_V1 (?:start|completed) [A-Za-z0-9_.]+\n','',output)
                    records.append((code,program.progName,program.warnings,result.testsRun,len(result.failures),
                                    len(result.errors),len(result.skipped),discovered,output))
                    self.assertEqual(imported,[] if legacy else ['core_source_progress'])
                finally:sys.path[:]=saved_path;sys.argv[:]=saved_argv
            self.assertEqual(records[0],records[1])
            self.assertEqual(records[0][3],0 if empty else 3)
            outputs.append(records[0][0])
        self.assertEqual(outputs[0],1)
        # Unsupported script/argv paths refuse before even importing os/unittest/progress.
        for platform,argv in (('darwin',['fixed']),('linux',['fixed','extra'])):
            imports=[]
            def only_sys(name,*args,**kwargs):
                imports.append(name)
                self.assertEqual(name,'sys')
                return actual_import(name,*args,**kwargs)
            with patch.object(sys,'platform',platform),patch.object(sys,'argv',argv), \
                 patch.object(builtins,'__import__',side_effect=only_sys):
                with self.assertRaisesRegex(SystemExit,'^closed Core source runner refused$'):
                    exec(compile(source,str(root/'source_runner.py'),'exec'),{'__name__':'__main__'})
            self.assertEqual(imports,['sys'])


if __name__=='__main__':unittest.main()
