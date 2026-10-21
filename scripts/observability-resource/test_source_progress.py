"""Fixed source-only witness; stopped methods are not acceptance evidence."""
import hashlib
import io
import json
import sys
import runpy
from unittest.mock import patch, mock_open
from pathlib import Path
import unittest
import source_progress


class SourceProgress(unittest.TestCase):
    def test_discovery_matches_fixed_inventory_and_original_methods_once(self):
        suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
        source_progress.verify_inventory(suite)
        added={
            'test_source_progress.SourceProgress.test_discovery_matches_fixed_inventory_and_original_methods_once',
            'test_source_progress.SourceProgress.test_emitters_use_inventory_literals_and_completed_does_not_claim_success',
            'test_source_progress.SourceProgress.test_emitter_faults_do_not_replace_original_outcome'}
        added.update(name for name in source_progress.SOURCE_IDS if name.startswith('test_preparation.'))
        self.assertEqual(len(source_progress.SOURCE_IDS),112)
        self.assertEqual(len(set(source_progress.SOURCE_IDS)),112)
        self.assertTrue(added<=set(source_progress.SOURCE_IDS))
        baseline=[name for name in source_progress.SOURCE_IDS if name not in added]
        self.assertEqual(len(baseline),95)
        self.assertEqual(hashlib.sha256(json.dumps(baseline).encode()).hexdigest(),'01011598cfc95e45efef06161ad0283212bc6c1c2b20eb8bc1cd184ccbfaa948')
        class Case(unittest.TestCase):
            def runTest(self):pass
            def id(self):return source_progress.SOURCE_IDS[0]
        for cases in ((Case(),),(Case(),Case())):
            with self.assertRaisesRegex(ValueError,'^closed Resource source inventory refused$'):
                source_progress.verify_inventory(unittest.TestSuite(cases))

        self.assertIs(type(source_progress.SOURCE_IDS),tuple)
        raw_cases=(b'{}',b'null',b'["private-id"]',b'[1]',b'NaN',b'['+b' '*32768,
                   json.dumps([source_progress.SOURCE_IDS[0]]*2).encode(),
                   json.dumps(list(reversed(source_progress.SOURCE_IDS))).encode(),
                   json.dumps(['test_'+('x'*193)+'.Case.test_case']).encode(),
                   json.dumps(['test_mod.Case.test_case']*257).encode())
        for raw in raw_cases:
            with self.subTest(raw_size=len(raw)),patch('pathlib.Path.open',mock_open(read_data=raw)):
                with self.assertRaisesRegex(ValueError,'^closed Resource source inventory refused$'):
                    runpy.run_path(source_progress.__file__)
        class ForeignCase(Case):
            def id(self):return 'private-invalid-id'
        for cases in ((ForeignCase(),),tuple(Case() for _ in range(99))):
            with self.assertRaises(ValueError):source_progress.verify_inventory(unittest.TestSuite(cases))

        # The internal runner switch does not activate timing during direct discovery/import.
        runner=runpy.run_path(str(Path(__file__).with_name('source_runner.py')))
        calls=[];stream=io.StringIO()
        def clock():calls.append('clock');raise AssertionError('off clock read')
        for switch in (None,'','0','true',1,object()):
            self.assertIsNone(runner['_timing_begin'](environment={'RESOURCE_TEST_TIMING_V1':switch},clock=clock,stream=stream))
        self.assertEqual(calls,[]);self.assertEqual(stream.getvalue(),'')

    def test_emitters_use_inventory_literals_and_completed_does_not_claim_success(self):
        for success in (True,False):
            stream=io.StringIO()
            class Case(unittest.TestCase):
                def id(self):return source_progress.SOURCE_IDS[0]
                def runTest(self):
                    if not success:raise RuntimeError('private-controlled-failure')
            result=unittest.TextTestRunner(stream=stream,resultclass=source_progress.ProgressResult).run(unittest.TestSuite([Case()]))
            self.assertIs(result.wasSuccessful(),success)
            markers=[line for line in stream.getvalue().splitlines() if line.startswith('RESOURCE_SOURCE')]
            self.assertEqual(markers,['RESOURCE_SOURCE_V1 start '+source_progress.SOURCE_IDS[0],
                                      'RESOURCE_SOURCE_V1 completed '+source_progress.SOURCE_IDS[0]])
        class Foreign(Case):
            def id(self):return 'private-controlled-id'
        stream=io.StringIO()
        unittest.TextTestRunner(stream=stream,resultclass=source_progress.ProgressResult).run(unittest.TestSuite([Foreign()]))
        self.assertNotIn('RESOURCE_SOURCE',stream.getvalue())

        # Pure synthetic source callbacks, never the real112 bodies or item84 process modes.
        runner=runpy.run_path(str(Path(__file__).with_name('source_runner.py')))
        stream=io.StringIO();origin=1_000_000_000
        ticks=iter([origin]+[origin+value for value in range(100,241,10)])
        seed=runner['_timing_begin'](environment={'RESOURCE_TEST_TIMING_V1':'1'},clock=lambda:next(ticks),stream=stream)
        with patch.object(source_progress,'_timing',None):
            source_progress.initialize_timing(seed)
            class Synthetic(unittest.TestCase):
                def __init__(self,index):super().__init__();self.index=index
                def id(self):return source_progress.SOURCE_IDS[self.index]
                def runTest(self):
                    if self.index==83:
                        for mode in ('success','failure','timeout','sigterm','sigkill','descendant'):
                            source_progress.timing_event('begin',mode)
                            with self.subTest(mode=mode):
                                if mode=='failure':self.fail('private-synthetic-subtest')
                            source_progress.timing_event('end',mode)
            observed=unittest.TextTestRunner(stream=stream,resultclass=source_progress.ProgressResult).run(
                unittest.TestSuite([Synthetic(index) for index in range(112)]))
            source_progress.timing_event('end','runner')
            self.assertFalse(observed.wasSuccessful())
            markers=[line for line in stream.getvalue().splitlines() if line.startswith('RESOURCE_TIMING')]
            expected=['RESOURCE_TIMING_V1 begin runner 0','RESOURCE_TIMING_V1 begin item84 100']
            for index,mode in enumerate(('success','failure','timeout','sigterm','sigkill','descendant')):
                expected.extend(['RESOURCE_TIMING_V1 begin '+mode+' '+str(110+index*20),
                    'RESOURCE_TIMING_V1 end '+mode+' '+str(120+index*20)])
            expected.extend(['RESOURCE_TIMING_V1 end item84 230','RESOURCE_TIMING_V1 end runner 240'])
            self.assertEqual(markers,expected)
            lines=stream.getvalue().splitlines()
            self.assertLess(lines.index('RESOURCE_SOURCE_V1 start '+source_progress.SOURCE_IDS[83]),
                lines.index('RESOURCE_TIMING_V1 begin item84 100'))
            self.assertLess(lines.index('RESOURCE_SOURCE_V1 completed '+source_progress.SOURCE_IDS[83]),
                lines.index('RESOURCE_TIMING_V1 end item84 230'))
            before=stream.getvalue();source_progress.timing_event('end','runner')
            self.assertEqual(stream.getvalue(),before)
        # Direct import does not consult the switch or allocate an active clock/state.
        with patch.dict('os.environ',{'RESOURCE_TEST_TIMING_V1':'1'}):
            fresh=runpy.run_path(source_progress.__file__)
            self.assertIsNone(fresh['_timing'])

    def test_emitter_faults_do_not_replace_original_outcome(self):
        for fault,success in ((fault,success) for fault in ('start','completed','flush') for success in (True,False)):
            with self.subTest(fault=fault,success=success):
                primary=RuntimeError('private-controlled-primary');seen=[];original=[]
                class Stream(io.StringIO):
                    marker=False
                    def write(self,value):
                        self.marker='RESOURCE_SOURCE' in value
                        if self.marker and (' '+fault+' ') in value:raise OSError('private-controlled-write')
                        return super().write(value)
                    def flush(self):
                        if self.marker and fault=='flush':raise OSError('private-controlled-flush')
                        return super().flush()
                class Result(source_progress.ProgressResult):
                    def addError(self,test,error):seen.append(error);super().addError(test,error)
                class Case(unittest.TestCase):
                    def id(self):return source_progress.SOURCE_IDS[0]
                    def runTest(self):
                        if not success:
                            try:raise primary
                            except BaseException:
                                original.append(sys.exc_info()[2]);raise
                result=unittest.TextTestRunner(stream=Stream(),resultclass=Result).run(unittest.TestSuite([Case()]))
                self.assertIs(result.wasSuccessful(),success)
                if not success:
                    self.assertIs(seen[0][1],primary)
                    chain=[];tb=seen[0][2]
                    while tb:chain.append(tb);tb=tb.tb_next
                    self.assertIn(original[0],chain)
        for interrupted in (KeyboardInterrupt(),SystemExit(17)):
            class InterruptStream(io.StringIO):
                def write(self,value):
                    if 'RESOURCE_SOURCE' in value:raise interrupted
                    return super().write(value)
            class InterruptCase(unittest.TestCase):
                def id(self):return source_progress.SOURCE_IDS[0]
                def runTest(self):pass
            with self.assertRaises(type(interrupted)) as caught:
                unittest.TextTestRunner(stream=InterruptStream(),resultclass=source_progress.ProgressResult).run(unittest.TestSuite([InterruptCase()]))
            self.assertIs(caught.exception,interrupted)

        # New timing leaves return before all observer/state access while a primary unwinds.
        runner=runpy.run_path(str(Path(__file__).with_name('source_runner.py')))
        for primary in (RuntimeError('private-primary'),KeyboardInterrupt(),SystemExit(19)):
            for secondary in (primary,OSError('private-observer')):
                calls=[]
                def forbidden(*args,**kwargs):calls.append('observer');raise secondary
                class Environment:
                    get=forbidden
                class Stream:
                    write=forbidden
                    flush=forbidden
                class ForeignResult:
                    @property
                    def _source_index(self):return forbidden()
                state={'origin':0,'clock':forbidden,'stream':Stream(),'last':0,'count':1,'bytes':33}
                with patch.object(source_progress,'_timing',state):
                    try:
                        try:raise primary
                        except BaseException:
                            original=sys.exc_info()[2];context=primary.__context__
                            self.assertIsNone(runner['_timing_begin'](environment=Environment(),clock=forbidden,stream=Stream()))
                            source_progress.initialize_timing(object())
                            source_progress.timing_event('begin','success')
                            source_progress._timing_source(ForeignResult(),'start')
                            # Actual old stopTest/super/source emitter still run; only the new timing leaf is inert.
                            result=source_progress.ProgressResult(io.StringIO(),False,0)
                            result._source_index=83;result._source_active=source_progress.SOURCE_IDS[83]
                            class Case(unittest.TestCase):
                                def id(self):return source_progress.SOURCE_IDS[83]
                            result.stopTest(Case())
                            self.assertEqual(result._source_index,84)
                            self.assertIs(source_progress._timing,state)
                            self.assertEqual(state['count'],1)
                            self.assertEqual(calls,[])
                            self.assertIs(primary.__context__,context)
                            self.assertIs(sys.exc_info()[2],original)
                            raise
                    except BaseException as caught:
                        self.assertIs(caught,primary)
                        chain=[];tb=caught.__traceback__
                        while tb:chain.append(tb);tb=tb.tb_next
                        self.assertIn(original,chain)
        for fault in ('clock','write','flush'):
            for secondary in (OSError('private-ordinary'),KeyboardInterrupt(),SystemExit(21)):
                calls=[]
                def clock():
                    calls.append('clock')
                    if fault=='clock':raise secondary
                    return 10
                class Stream:
                    def write(self,value):
                        calls.append('write')
                        if fault=='write':raise secondary
                    def flush(self):
                        calls.append('flush')
                        if fault=='flush':raise secondary
                state={'origin':0,'clock':clock,'stream':Stream(),'last':0,'count':1,'bytes':33}
                with patch.object(source_progress,'_timing',state):
                    if isinstance(secondary,Exception):
                        source_progress.timing_event('begin','success')
                        self.assertIsNone(source_progress._timing)
                        before=list(calls);source_progress.timing_event('end','success')
                        self.assertEqual(calls,before)
                    else:
                        with self.assertRaises(type(secondary)) as caught:source_progress.timing_event('begin','success')
                        self.assertIs(caught.exception,secondary)

        for secondary in (OSError('private-origin'),KeyboardInterrupt(),SystemExit(23)):
            def fail_clock():raise secondary
            if isinstance(secondary,Exception):
                self.assertIsNone(runner['_timing_begin'](environment={'RESOURCE_TEST_TIMING_V1':'1'},clock=fail_clock,stream=io.StringIO()))
            else:
                with self.assertRaises(type(secondary)) as caught:
                    runner['_timing_begin'](environment={'RESOURCE_TEST_TIMING_V1':'1'},clock=fail_clock,stream=io.StringIO())
                self.assertIs(caught.exception,secondary)
