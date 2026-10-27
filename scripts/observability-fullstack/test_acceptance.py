"""Acceptance refuses incomplete process/loss/pair evidence, regardless of configured caps."""
import unittest
import acceptance


class Acceptance(unittest.TestCase):
    def test_only_measured_complete_paired_corpus_can_pass(self):
        evidence={'complete':True,'oom':False,'enospc':False,'unexplained_loss':0,
            'query_max_seconds':1,'ingestion_lag_seconds':2,'http_p95_overhead_percent':2,
            'additional_host_cpu_fraction':.02,'minimum_host_memory_free_fraction':.3,
            'minimum_host_disk_free_fraction':.4,'peak_host_used_bytes':3*1024**3}
        result=acceptance.assess(evidence)
        self.assertEqual(result['state'],'passed')
        self.assertEqual(result['minimum_candidate_gib'],4)
        for field in evidence:
            with self.subTest(field=field):
                missing={**evidence,field:None}
                self.assertNotEqual(acceptance.assess(missing)['state'],'passed')
        for field,value in [('oom',True),('enospc',True),('unexplained_loss',1),
                ('query_max_seconds',10.01),('ingestion_lag_seconds',60.01),
                ('http_p95_overhead_percent',5.01),('additional_host_cpu_fraction',.101),
                ('minimum_host_memory_free_fraction',.249),('minimum_host_disk_free_fraction',.249)]:
            with self.subTest(field=field):
                self.assertEqual(acceptance.assess({**evidence,field:value})['state'],'failed')

    def test_zero_materials_or_one_account_cannot_reuse_sdk_only_acceptance(self):
        import json
        from pathlib import Path
        profile=json.loads((Path(__file__).resolve().parents[2]/'infra/observability/fullstack/profile.json').read_text())
        self.assertEqual(profile["accounts"],256)
        acceptance.validate_profile(profile)
        for field,value in (('materials',0),('accounts',1),('accounts',128),('accounts',257),('concurrency',1)):
            with self.subTest(field=field),self.assertRaises(ValueError):
                acceptance.validate_profile({**profile,field:value})
