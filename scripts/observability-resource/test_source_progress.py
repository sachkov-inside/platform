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
        self.assertEqual(len(source_progress.SOURCE_IDS),111)
        self.assertEqual(len(set(source_progress.SOURCE_IDS)),111)
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
