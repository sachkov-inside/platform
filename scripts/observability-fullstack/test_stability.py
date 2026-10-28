"""Separate closed diagnostics never produce capacity acceptance."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import fullstack

def measurement(ordinal):
    import stability
    indices=[i for i in range(400) if i%8 in (0,1,2,3,6,7)]
    labels={0:'web_home',1:'web_material',2:'api_catalog',3:'api_account',6:'telegram_webhook',7:'logto_discovery'}
    frame={'anchor':[0,0,0],'context':dict.fromkeys(stability.CONTEXT),'context_delta':dict.fromkeys(stability.DELTA_CONTEXT),'context_resets':0,'at_seconds':0,'counter_errors':0,'services':[]}
    return {'ordinal':ordinal,'completed':True,'scheduled':400,'missed':0,'success':400,'unexpected_failures':0,
        'latency':[{'label':labels[i%8],'elapsed_ms':1} for i in indices],
        'requests':[[i,i%8,0,1] for i in indices],'phase_start':[0,0,0],'phase_end':[10000,10000,10000],'host':[frame,frame]}


class Stability(unittest.TestCase):
    def test_closed_schedule_and_original_profile_are_independent(self):
        import stability
        rows=stability.schedule()
        self.assertEqual([r['enabled'] for r in rows[::2]],[False,False,False,True,True,False])
        self.assertEqual([r['ordinal'] for r in rows],list(range(12)))
        self.assertEqual([r['measured'] for r in rows],[False,True]*6)
        self.assertTrue(all(r['definition']=={'name':'spike','seconds':10,'requests_per_second':40} for r in rows))
        self.assertEqual(hashlib.sha256(fullstack.PROFILE.read_bytes()).hexdigest(),'352676ff75a827979d50a6ec5d9e69fd5165f1837cb02644a942febdb04eff7f')
        self.assertEqual(fullstack.acceptance.LIMITS['http_p95_overhead_percent'],(5,False))

    def test_real_diagnostic_collector_refuses_forged_acceptance_and_private_fields(self):
        import stability
        source='a'*40
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);record=stability.record(source)
            self.assertEqual(record['acceptance'],{'state':'not_applicable','capacity':False,'minimum_candidate_gib':None})
            path=root/stability.NAME;path.write_text(json.dumps(record))
            self.assertEqual(stability.read(root,source),record)
            for field,value in [('acceptance',{'state':'passed','capacity':True,'minimum_candidate_gib':4}),('private','token'),('state','passed'),('source','b'*40)]:
                bad=copy.deepcopy(record);bad[field]=value;path.write_text(json.dumps(bad))
                with self.assertRaises(ValueError):stability.read(root,source)
            path.unlink();path.symlink_to(root/'foreign')
            with self.assertRaises(ValueError):stability.read(root,source)
            with self.assertRaises(ValueError),patch.object(fullstack.resource_runtime.ci,'collect',side_effect=AssertionError('normal collector reached')):
                fullstack.collect(root,root,root/'public')

    def test_worker_reuses_existing_phase_and_excludes_prewarm_from_pairs(self):
        import stability
        rows=[]
        def measure(row):
            rows.append(row);return measurement(row['ordinal'])
        result=stability.experiment('a'*40,lambda enabled:None,measure,lambda _row:None,images={role:'sha256:'+'a'*64 for role in ('backend','foundation','web','telegram','logto')})
        self.assertEqual(len(rows),12)
        self.assertEqual([r['ordinal'] for r in result['measurements']],[1,3,5,7,9,11])
        self.assertEqual(result['state'],'complete')
        self.assertEqual(result['acceptance']['state'],'not_applicable')
        self.assertIsNone(result['acceptance']['minimum_candidate_gib'])
        for bad in ({'state':'complete'},{'measurements':[{}]*12}):
            with self.assertRaises(ValueError):stability.validate(bad,'a'*40)

    def test_actual_worker_routes_twelve_existing_phase_calls_without_acceptance_evaluation(self):
        import stability
        import os
        from contextlib import nullcontext
        source='a'*40;images={role:'sha256:'+'a'*64 for role in ('backend','foundation','web','telegram','logto')}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'owned'}))
            (root/stability.MARKER).write_text(json.dumps({'schema':1,'source':source,'scope':'diagnostic_only'}))
            (root/'fullstack-source.json').write_text(json.dumps({'source':source,'images':images}))
            calls=[]
            def phase(*args,**options):
                ordinal=options['diagnostic_ordinal'];calls.append((ordinal,args[4],args[5]));m=measurement(ordinal)
                return {'load':{**m,'timing_diagnostics':{'requests':m['requests'],'phase_start':m['phase_start'],'phase_end':m['phase_end']}},'errors':[],
                    'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},'counter_clock_anchor':[0,0,0],'diagnostic_context':dict.fromkeys(stability.CONTEXT)}]*2}
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'mode'),patch.object(fullstack,'invoke',return_value=''),patch.object(fullstack,'seed'),patch.object(fullstack,'configure_mode',return_value=fullstack.APPS) as configure,patch.object(fullstack,'phase',side_effect=phase),patch.object(fullstack,'evaluate',side_effect=AssertionError('acceptance reached')):
                fullstack.worker(root)
            self.assertEqual(configure.call_count,6)
            self.assertEqual(calls,[(i,stability.MODES[i//2],i//6) for i in range(12)])
            public=stability.read(root,source,fullstack.SERVICES)
            self.assertEqual(public['state'],'complete');self.assertFalse((root/'fullstack-proof.json').exists())
            self.assertEqual(public['acceptance']['capacity'],False)

    def test_marker_privacy_missing_partial_and_incomplete_never_promote(self):
        import stability
        for body in (None,'','<!-- monitoring-stability: RUN -->','private-sentinel'):
            with self.subTest(body=body),self.assertRaises(ValueError):stability.require_marker({'pull_request':{'body':body}})
        stability.require_marker({'pull_request':{'body':'before\n<!-- monitoring-stability: run -->\nafter'}})
        invalid=stability.record('a'*40);invalid['warmup']=[{'ordinal':False,'completed':True}]
        with self.assertRaises(ValueError):stability.validate(invalid,'a'*40)
        source='a'*40;seen=[]
        def measure(row):
            value=measurement(row['ordinal']);value['completed']=False;return value
        with self.assertRaisesRegex(ValueError,'stability_load_incomplete'):
            stability.experiment(source,lambda _:None,measure,lambda value:seen.append(copy.deepcopy(value)))
        self.assertEqual(seen[-1]['state'],'incomplete');self.assertEqual(seen[-1]['acceptance']['state'],'not_applicable')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);destination=root/'public';output=root/'private';output.mkdir()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{})),patch.object(fullstack.resource_runtime.ci,'collect') as collect:
                fullstack.stability_collect(output,root,destination)
                self.assertEqual(stability.read(output,source,fullstack.SERVICES)['state'],'incomplete')
                self.assertNotIn('fullstack-proof.json',collect.call_args.kwargs['artifacts'])
                record=stability.record(source,fullstack.SERVICES);record['acceptance']['capacity']=True
                (output/stability.NAME).write_text(json.dumps(record));collect.reset_mock()
                with self.assertRaises(ValueError):fullstack.stability_collect(output,root,destination)
                collect.assert_not_called()

    def test_context_is_numeric_bounded_and_actual_reset_becomes_unknown(self):
        import stability
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'pressure').mkdir()
            (root/'stat').write_text('cpu 1 2 3 4 5 6 7 8 9 10\nctxt 42\nprocs_running 3\nprocs_blocked 1\n')
            (root/'pressure/cpu').write_text('some avg10=1 avg60=0 avg300=0 total=75\nfull avg10=0 total=0\n')
            context=stability.context(root);self.assertEqual(context['steal_ticks'],8);self.assertEqual(context['cpu_total_ticks'],36)
            self.assertEqual(context['cpu_some_total_us'],75);self.assertEqual(context['runqueue'],3)
            m=measurement(1);before={key:10 for key in stability.CONTEXT};after={key:5 for key in stability.CONTEXT}
            value={'load':{**m,'timing_diagnostics':{'requests':m['requests'],'phase_start':m['phase_start'],'phase_end':m['phase_end']}},'errors':[],
                'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},'counter_clock_anchor':[0,0,0],'diagnostic_context':context} for context in (before,after)]}
            projected=stability.project(value,1,());self.assertEqual(projected['host'][1]['context_resets'],len(stability.DELTA_CONTEXT))
            self.assertTrue(all(v is None for v in projected['host'][1]['context_delta'].values()))
            record=stability.record('a'*40);record['warmup']=[{'ordinal':0,'completed':True}];record['measurements']=[projected]
            stability.validate(record,'a'*40)
            for bad in ('private-sentinel',float('nan'),True):
                broken=copy.deepcopy(record);broken['measurements'][0]['host'][0]['context']['steal_ticks']=bad
                with self.assertRaises(ValueError):stability.validate(broken,'a'*40)

    def test_additive_workflow_does_not_change_existing_jobs_or_release_coverage(self):
        workflow=(fullstack.ROOT/'.github/workflows/observability-resource.yml').read_text();original=workflow.split('\n  stability:\n')[0]
        self.assertEqual(hashlib.sha256(original.rstrip().encode()).hexdigest(),'5f674342ab4e6ebb7e91d3696076b2b24666f36a66d9d9c19592c2e8095bc8f1')
        diagnostic=workflow.split('\n  stability:\n')[1]
        self.assertIn("contains(github.event.pull_request.body || '', '<!-- monitoring-stability: run -->')",diagnostic)
        self.assertIn('fullstack.py diagnostic-admission',diagnostic)
        self.assertIn('fullstack.py diagnostic-collect',diagnostic)
        self.assertNotIn('workflow_dispatch:',workflow);self.assertNotIn('types:',workflow);self.assertNotIn('secrets:',diagnostic)
        self.assertNotIn('stability',(fullstack.ROOT/'scripts/ci-coverage-plan.mjs').read_text())

    def test_host_context_missing_and_reset_are_unknown_not_zero(self):
        import stability
        context=stability.context(Path('/nonexistent-stability-proc'))
        self.assertIsNone(context['steal_ticks']);self.assertIsNone(context['runqueue'])
        self.assertEqual(stability.counter_delta(5,4),None)
        self.assertEqual(stability.counter_delta(None,4),None)
        self.assertEqual(stability.counter_delta(True,4),None)
        self.assertEqual(stability.counter_delta(4,5),1)

if __name__=='__main__':unittest.main()
