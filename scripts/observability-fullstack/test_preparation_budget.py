"""The larger source preparation remains one finite, Linux-only disk boundary."""
import unittest
import prepare
from storage_policy import assert_budget, StorageBudgetExceeded, GIB, IMAGE_PREPARATION_GROWTH_BYTES, GROWTH_BYTES


class PreparationBudget(unittest.TestCase):
    def test_fullstack_requires_fresh_28_gib_without_changing_existing_budgets(self):
        self.assertEqual(prepare.preparation_budget('linux',28*GIB),16*GIB)
        for platform,free in (('darwin',100*GIB),('linux',28*GIB-1)):
            with self.subTest(platform=platform,free=free), self.assertRaises(ValueError):
                prepare.preparation_budget(platform,free)
        self.assertEqual((IMAGE_PREPARATION_GROWTH_BYTES,GROWTH_BYTES),(8*GIB,4*GIB))
        assert_budget(40*GIB,31*GIB,growth_bytes=16*GIB)
        with self.assertRaises(StorageBudgetExceeded):assert_budget(40*GIB,24*GIB,growth_bytes=16*GIB)
        with self.assertRaises(StorageBudgetExceeded):assert_budget(25*GIB,10*GIB,growth_bytes=16*GIB)

    def test_preparation_evidence_keeps_one_baseline_and_closed_source_bound_failure_stage(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import preparation_evidence
        import disk_feedback
        from disk_samples import DiskSamples
        source='a'*40
        with tempfile.TemporaryDirectory() as directory:
            disk=disk_feedback.Record(source);samples=DiskSamples();samples._baseline(40*GIB)
            disk.attempt();disk.entered(samples)
            record=preparation_evidence.Record(Path(directory),source,disk)
            record.mark('build_backend')
            point=samples._point(37*GIB);samples._safe(point);record.completed()
            disk.after_backend_build();disk.first_pull();record.mark('preload_0')
            point=samples._point(24*GIB);samples._stopping(point);samples._seal()
            record.persist()
            evidence=preparation_evidence.read(Path(directory)/preparation_evidence.NAME,source)
            self.assertEqual(evidence['stage'],'preload_0')
            self.assertEqual(evidence['completed'],['build_backend'])
            self.assertEqual(evidence['disk']['baseline'],{'id':0,'free_bytes':40*GIB})
            self.assertEqual(evidence['disk']['stopping'],{'id':2,'free_bytes':24*GIB})
            self.assertEqual(evidence['checkpoints'][0]['sample'],{'id':1,'free_bytes':37*GIB})
            for invalid in ({**evidence,'source':'b'*40},{**evidence,'stage':'secret build output'},
                    {**evidence,'stdout':'secret'},{**evidence,'growth_limit_bytes':32*GIB}):
                with self.assertRaises(ValueError):preparation_evidence.validate(invalid,source)
            with patch.object(preparation_evidence.os,'open',side_effect=OSError('secondary')):
                with self.assertRaisesRegex(RuntimeError,'primary'):
                    try:raise RuntimeError('primary')
                    finally:record.persist()

    def test_preload_failure_retains_aggregate_build_growth_and_deterministic_stage(self):
        from contextlib import contextmanager
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        import tempfile
        import preparation_evidence
        from disk_samples import DiskSamples
        source='a'*40
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);images=root/'images.json';calls=[];samples=DiskSamples();samples._baseline(40*GIB)
            owned=SimpleNamespace(receipt={'token':'owned','tags':['backend','foundation','web']},pass_fds=lambda:(),capture=lambda:None,
                iidfile=lambda role:root/(role+'.iid'))
            @contextmanager
            def guard(path,**kwargs):
                calls.append(('guard',kwargs))
                try:yield samples
                finally:samples._seal()
            @contextmanager
            def acquisition(*args,**kwargs):yield owned
            def command(args,seconds,**kwargs):
                point=samples._point(40*GIB-(len(calls))*GIB);samples._safe(point)
                calls.append(('command',args))
                if args[1]=='pull':raise RuntimeError('actual pull failure')
                Path(args[args.index('--iidfile')+1]).write_text('sha256:'+'b'*64)
            identity={'storage':str(root),'endpoint':'owned'}
            with patch.object(prepare.hosted,'metadata_source',return_value=({'checkout_sha':source,'run_id':'1','run_attempt':'1'},{'ready':True})), \
                    patch.object(prepare.hosted.runtime.pilot.daemon,'identify',return_value=identity), \
                    patch.object(prepare.hosted.runtime.pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=40*GIB)), \
                    patch.object(prepare.hosted.runtime.pilot,'disk_budget',side_effect=guard), \
                    patch.object(prepare.preparation,'acquire',side_effect=acquisition), \
                    patch.object(prepare.hosted,'command',side_effect=command),patch.object(prepare.sys,'platform','linux'):
                with self.assertRaisesRegex(RuntimeError,'actual pull failure'):prepare.prepare(root,images,'consumer')
            self.assertEqual([item for item in calls if item[0]=='guard'],[('guard',{'growth_bytes':16*GIB,'observe_samples':True})])
            report=preparation_evidence.read(root/preparation_evidence.NAME,source)
            self.assertEqual(report['completed'],['build_backend','build_foundation','build_web'])
            self.assertEqual(report['stage'],'preload_0')
            self.assertEqual(report['disk']['baseline']['free_bytes'],40*GIB)
            self.assertEqual(report['disk']['latest_safe']['free_bytes'],36*GIB)
            self.assertFalse(images.exists())
