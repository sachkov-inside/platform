"""Fixed source-only progress, never a claim that completed tests passed."""
import hashlib
import io
import json
import sys
from pathlib import Path
import unittest
import source_progress


class SourceProgress(unittest.TestCase):
    def test_discovery_matches_fixed_inventory_and_original_methods_once(self):
        suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
        source_progress.verify_inventory(suite)
        added={
            'test_warm_matching.WarmMatching.test_held_waits_for_next_scraped_frame_without_spending_snapshot_cap',
            'test_mcp_snapshot.MCPObservation.test_ready_session_is_one_pair_only_and_original_stale_frames_remain_stale',
            'test_mcp_snapshot.MCPObservation.test_shared_ten_second_query_budget_includes_final_oracle_validation',
            'test_warm_matching.WarmMatching.test_partition_prepares_native_before_selecting_current_canonical_sample',
            'test_warm_matching.WarmMatching.test_ready_native_session_precedes_held_body_and_exact_canonical_acquisition',
            'test_acquisition_budget.AcquisitionBudget.test_127_performs_one_query_then_refuses_next_without_more_work',
            'test_acquisition_budget.AcquisitionBudget.test_actual_snapshot_128_and_129_refuse_before_any_acquisition_work',
            'test_acquisition_budget.AcquisitionBudget.test_classification_never_reads_foreign_metadata_or_matches_text',
            'test_acquisition_budget.AcquisitionBudget.test_worker_actual_scenario_cap_preserves_primary_first_failure_and_cleanup',
            'test_source_progress.SourceProgress.test_discovery_matches_fixed_inventory_and_original_methods_once',
            'test_source_progress.SourceProgress.test_emitters_use_inventory_literals_and_completed_does_not_claim_success',
            'test_source_progress.SourceProgress.test_emitter_faults_do_not_replace_original_outcome'}
        self.assertEqual(len(source_progress.SOURCE_IDS),85)
        self.assertEqual(len(set(source_progress.SOURCE_IDS)),85)
        self.assertTrue(added<=set(source_progress.SOURCE_IDS))
        baseline=[name for name in source_progress.SOURCE_IDS if name not in added]
        self.assertEqual(len(baseline),73)
        self.assertEqual(hashlib.sha256(json.dumps(baseline).encode()).hexdigest(),'34a7fb8b62c29fdf4980fa775a515fe1917839dfd1bd17cfae82db0b4de1be00')
        groups=source_progress.SOURCE_GROUPS
        self.assertEqual(tuple(groups),('contracts','process-owner'))
        self.assertEqual(tuple(map(len,groups.values())),(82,3))
        combined=tuple(value for group in groups.values() for value in group)
        self.assertEqual(len(set(combined)),85)
        self.assertEqual(tuple(sorted(combined)),source_progress.SOURCE_IDS)
        for group,expected in groups.items():
            selected=source_progress.select_group(suite,group)
            self.assertEqual(tuple(test.id() for test in selected),expected)
        for group in ('unknown','__proto__',None,[],1):
            with self.assertRaisesRegex(ValueError,'^closed Caddy source inventory refused$'):
                source_progress.select_group(suite,group)
        class Case(unittest.TestCase):
            def runTest(self):pass
            def id(self):return source_progress.SOURCE_IDS[0]
        for cases in ((Case(),),(Case(),Case())):
            with self.assertRaisesRegex(ValueError,'^closed Caddy source inventory refused$'):
                source_progress.verify_inventory(unittest.TestSuite(cases))
            for group in groups:
                with self.assertRaisesRegex(ValueError,'^closed Caddy source inventory refused$'):
                    source_progress.select_group(unittest.TestSuite(cases),group)

    def test_emitters_use_inventory_literals_and_completed_does_not_claim_success(self):
        stream=io.StringIO()
        class Case(unittest.TestCase):
            def id(self):return source_progress.SOURCE_IDS[0]
            def runTest(self):raise RuntimeError('private-controlled-failure')
        result=unittest.TextTestRunner(stream=stream,resultclass=source_progress.ProgressResult).run(unittest.TestSuite([Case()]))
        self.assertFalse(result.wasSuccessful())
        markers=[line for line in stream.getvalue().splitlines() if line.startswith('CADDY_SOURCE')]
        self.assertEqual(markers,['CADDY_SOURCE_V1 start '+source_progress.SOURCE_IDS[0],
                                  'CADDY_SOURCE_V1 completed '+source_progress.SOURCE_IDS[0]])
        class Foreign(Case):
            def id(self):return 'private-controlled-id'
        stream=io.StringIO()
        unittest.TextTestRunner(stream=stream,resultclass=source_progress.ProgressResult).run(unittest.TestSuite([Foreign()]))
        self.assertNotIn('CADDY_SOURCE',stream.getvalue())

    def test_emitter_faults_do_not_replace_original_outcome(self):
        for fault,success in ((fault,success) for fault in ('start','completed','flush') for success in (True,False)):
            with self.subTest(fault=fault,success=success):
                primary=RuntimeError('private-controlled-primary');seen=[];original=[]
                class Stream(io.StringIO):
                    marker=False
                    def write(self,value):
                        self.marker='CADDY_SOURCE' in value
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
        interrupted=KeyboardInterrupt()
        class InterruptStream(io.StringIO):
            def write(self,value):
                if 'CADDY_SOURCE' in value:raise interrupted
                return super().write(value)
        class InterruptCase(unittest.TestCase):
            def id(self):return source_progress.SOURCE_IDS[0]
            def runTest(self):pass
        with self.assertRaises(KeyboardInterrupt) as caught:
            unittest.TextTestRunner(stream=InterruptStream(),resultclass=source_progress.ProgressResult).run(unittest.TestSuite([InterruptCase()]))
        self.assertIs(caught.exception,interrupted)
