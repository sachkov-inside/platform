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
        'slot_refusal':{'schema':1,'state':'not_refused'},'requests':[[i,i%8,0,1] for i in indices],'phase_start':[0,0,0],'phase_end':[10000,10000,10000],'host':[frame,frame]}


def verify_actual_client_refusal(path,ordinal):
    """Actual source CLI output crosses the public collection seam, never a copied scheduler."""
    import stability
    captured=json.loads(Path(path).read_text());source='a'*40
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory);metadata=root/'metadata';metadata.mkdir();output=root/'private';output.mkdir()
        (metadata/'source.json').write_text(json.dumps({'checkout_sha':source}))
        with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{})):
            if ordinal=='normal':
                fullstack.pilot.write_json(output/'fullstack-phase-5.json',{'load':captured,'mode':'on','pair':0,'name':'spike'})
                fullstack.collect(output,metadata,root/'public')
                leaf=json.loads((root/'public/fullstack-phase-5.json').read_text())['load'].get('slot_refusal')
            else:
                def measure(row):
                    value={'load':captured,'errors':[],
                        'loadgen_cpu_pressure':{'state':'unthrottled'},'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},
                        'counter_clock_anchor':[0,0,0],'diagnostic_context':dict.fromkeys(stability.CONTEXT)} for _ in range(2)]}
                    return stability.project(value,row['ordinal'],fullstack.SERVICES)
                try:stability.experiment(source,lambda _:None,measure,lambda v:fullstack.pilot.write_json(output/stability.NAME,v),fullstack.SERVICES)
                except ValueError as error:assert str(error)=='stability_load_incomplete'
                fullstack.stability_collect(output,metadata,root/'public')
                public=json.loads((root/'public'/stability.NAME).read_text())
                assert public['acceptance']==stability.ACCEPTANCE and not public['measurements']
                leaf=public['warmup'][0].get('slot_refusal')
            assert type(leaf) is dict and leaf.get('state')=='captured','actual client first-refusal signal lost before public artifact'
            assert len(leaf['slots'])==8 and all(row[1]==(0 if ordinal=='normal' else 1) for row in leaf['slots'])


class Stability(unittest.TestCase):
    def test_slot_refusal_both_collectors_refuse_corruption_and_current_downgrade(self):
        import slot_refusal
        import stability
        good={'schema':1,'state':'captured','phase':5,'mode':'on','decision_us':200000,
              'slots':[[kind,0,kind*25000,kind*25000,200000-kind*25000,200000-kind*25000] for kind in range(8)]}
        self.assertEqual(slot_refusal.validate(good,5,True,1),good)
        bads=[]
        for key,value in [('schema',True),('phase',4),('mode','off'),('decision_us',float('nan')),('raw','private-sentinel')]:
            bad=copy.deepcopy(good);bad[key]=value;bads.append(bad)
        for index,value in [(0,True),(1,3),(2,-1),(3,300000),(4,0),(5,float('inf'))]:
            bad=copy.deepcopy(good);bad['slots'][0][index]=value;bads.append(bad)
        bads += [None,{'schema':1,'state':'not_refused'}, {**good,'slots':good['slots'][:7]},
                 {**good,'slots':good['slots']+[good['slots'][0]]}, {**good,'raw':'x'*4097}]
        for bad in bads:
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(ValueError,'closed_slot_refusal'):slot_refusal.validate(bad,5,True,1)
                self.assertEqual(slot_refusal.project({'slot_refusal':bad,'missed':1},5,True),{'schema':1,'state':'unavailable','reason':'capture'})
        with self.assertRaises(ValueError):slot_refusal.validate({**good,'phase':0,'mode':'off'},0,False,1)
        self.assertEqual(slot_refusal.project({},0,False),{'schema':1,'state':'unavailable','reason':'capture'})
        source='a'*40
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';output.mkdir();metadata=root/'metadata';metadata.mkdir()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{})):
                for bad in bads:
                    load={'missed':1,'slot_refusal':bad}
                    (output/'fullstack-phase-5.json').write_text(json.dumps({'load':load}))
                    with self.assertRaises(ValueError),patch.object(fullstack.resource_runtime.ci,'collect',side_effect=AssertionError('copy reached')):fullstack.collect(output,metadata,root/'public')
                fullstack.pilot.write_json(output/'fullstack-phase-5.json',{'load':{'missed':1}})
                with self.assertRaises(ValueError):fullstack.collect(output,metadata,root/'public')
                fullstack.pilot.write_json(output/'fullstack-phase-5.json',{'load':{'missed':1,'completed':True,'slot_refusal':good}})
                with self.assertRaises(ValueError):fullstack.collect(output,metadata,root/'public')
                (output/'fullstack-phase-5.json').unlink()
                warm_good={**good,'phase':0,'mode':'off','slots':[[r[0],1,*r[2:]] for r in good['slots']]}
                record=stability.record(source);record['warmup']=[{'ordinal':0,'completed':False,'quality':{'available':False},'slot_refusal':warm_good}]
                stability.validate(record,source)
                contradictory=copy.deepcopy(record);contradictory['warmup'][0]['completed']=True
                with self.assertRaises(ValueError):stability.validate(contradictory,source)
                for field,value in [('schema',2),('phase',1),('mode','on'),('slots',warm_good['slots'][:7]),('raw','private-sentinel')]:
                    broken=copy.deepcopy(record);broken['warmup'][0]['slot_refusal'][field]=value
                    (output/stability.NAME).write_text(json.dumps(broken))
                    with self.assertRaises(ValueError),patch.object(fullstack.resource_runtime.ci,'collect',side_effect=AssertionError('copy reached')):fullstack.stability_collect(output,metadata,root/'public')
                broken=copy.deepcopy(record);broken['warmup'][0].pop('slot_refusal')
                (output/stability.NAME).write_text(json.dumps(broken))
                with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,root/'public')
                for version in (1,2,True):
                    record=stability.record(source);record['schema']=version
                    (output/stability.NAME).write_text(json.dumps(record))
                    with self.assertRaises(ValueError),patch.object(fullstack.resource_runtime.ci,'collect',side_effect=AssertionError('copy reached')):fullstack.stability_collect(output,metadata,root/'public')
        # Max-width legal leaf stays inside both compact and pretty budgets.
        maximum={**good,'decision_us':600000000,'slots':[[7,2,0,0,600000000,600000000] for _ in range(8)]}
        slot_refusal.validate(maximum,5,True,400)
        self.assertLessEqual(len(json.dumps(maximum,indent=2).encode()),4096)
        bounded=stability.experiment(source,lambda _:None,lambda row:measurement(row['ordinal']),lambda _:None,
            images={role:'sha256:'+'a'*64 for role in ('backend','foundation','web','telegram','logto')})
        self.assertLess(len(json.dumps(bounded,indent=2).encode())+12*4096,stability.MAX_BYTES)
        oversized=copy.deepcopy(bounded);oversized['measurements'][0]['latency'][0]['raw']='x'*stability.MAX_BYTES
        with self.assertRaises(ValueError):stability.validate(oversized,source)


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

    def test_actual_warmup_failure_branches_survive_closed_collector_without_comparisons(self):
        import stability
        from test_hosted import metadata
        images={role:'sha256:'+'a'*64 for role in ('backend','foundation','web','telegram','logto')}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);admitted=metadata(root)
            source=json.loads((admitted/'source.json').read_text())['checkout_sha']
            flags={'phase':['sampler_failed'],'process':['process_replaced_or_oom'],
                   'cpu_throttled':['fixture_loadgen_cpu_throttled'],'cpu_unavailable':['fixture_loadgen_cpu_unavailable']}
            for branch in ('client','phase','counter','process','cpu_throttled','cpu_unavailable','counter_missing','normal'):
                with self.subTest(branch=branch):
                    output=root/branch;output.mkdir()
                    def measure(row):
                        original=measurement(row['ordinal'])
                        value={'load':{**original,'timing_diagnostics':{'requests':original['requests'],
                            'phase_start':original['phase_start'],'phase_end':original['phase_end']},
                            'private_error':'private-key-url-env-payload'},'errors':[],
                            'loadgen_cpu_pressure':{'state':'unthrottled'},
                            'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},
                                'counter_clock_anchor':[0,0,0],'diagnostic_context':dict.fromkeys(stability.CONTEXT)} for _ in range(2)]}
                        if branch=='client':value['load'].update(completed=False,missed=1,success=399)
                        elif branch in flags:
                            value['errors']=flags[branch]
                            if branch.startswith('cpu_'):value['loadgen_cpu_pressure']['state']=branch.removeprefix('cpu_')
                        elif branch in ('counter','counter_missing'):
                            value['samples'][0]['counters']['errors']={'api':'engine_read_failed' if branch=='counter' else 'required_counter_unavailable'}
                        return stability.project(value,row['ordinal'],fullstack.SERVICES)
                    def run():
                        return stability.experiment(source,lambda _enabled:None,measure,
                            lambda value:fullstack.pilot.write_json(output/stability.NAME,value),fullstack.SERVICES,images)
                    if branch=='normal':run()
                    else:
                        with self.assertRaisesRegex(ValueError,'^stability_load_incomplete$'):run()
                    public=root/(branch+'-public')
                    fullstack.stability_collect(output,admitted,public)
                    record=stability.read(public,source,fullstack.SERVICES)
                    quality=record['warmup'][0]['quality']
                    self.assertEqual(quality,{'available':True,'client_completed':branch!='client',
                        'scheduled':400,'missed':1 if branch=='client' else 0,'success':399 if branch=='client' else 400,
                        'unexpected_failures':0,'phase_errors':flags.get(branch,[]),
                        'counter_samples':2,'counter_errors':{'engine_read_failed':1 if branch=='counter' else 0,
                            'required_counter_unavailable':1 if branch=='counter_missing' else 0},
                        'loadgen_cpu_pressure':branch.removeprefix('cpu_') if branch.startswith('cpu_') else 'unthrottled'})
                    self.assertEqual(record['warmup'][0]['completed'],branch=='normal')
                    self.assertEqual(len(record['measurements']),6 if branch=='normal' else 0)
                    self.assertEqual(record['state'],'complete' if branch=='normal' else 'incomplete')
                    self.assertEqual(record['acceptance'],{'state':'not_applicable','capacity':False,'minimum_candidate_gib':None})
                    self.assertEqual(set(record['warmup'][0]),{'ordinal','completed','quality','slot_refusal'})
                    self.assertNotIn('private-key-url-env-payload',json.dumps(record))
                    self.assertTrue(all('quality' not in row for row in record['measurements']))

    def test_warmup_unknowns_and_forged_quality_are_closed_before_publication(self):
        import stability
        from test_hosted import metadata
        def phase():
            m=measurement(0)
            return {'load':{**m,'completed':False,'missed':1,'success':399,
                'timing_diagnostics':{'requests':m['requests'],'phase_start':m['phase_start'],'phase_end':m['phase_end']}},
                'errors':[],'loadgen_cpu_pressure':{'state':'unthrottled'},
                'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},'counter_clock_anchor':[0,0,0],
                    'diagnostic_context':dict.fromkeys(stability.CONTEXT)} for _ in range(2)]}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);admitted=metadata(root)
            source=json.loads((admitted/'source.json').read_text())['checkout_sha']
            for index,mutation in enumerate(('pressure_missing','private_phase','private_counter','private_role','bool_count','missing_sample')):
                value=phase()
                if mutation=='pressure_missing':value.pop('loadgen_cpu_pressure')
                elif mutation=='private_phase':value['errors']=['private-key-url-env-payload']
                elif mutation=='private_counter':value['samples'][0]['counters']['errors']={'api':'private-key-url-env-payload'}
                elif mutation=='private_role':value['samples'][0]['counters']['errors']={'private-CID':'engine_read_failed'}
                elif mutation=='bool_count':value['load']['scheduled']=True
                else:value['samples']=value['samples'][:1]
                projected=stability.project(value,0,fullstack.SERVICES)
                self.assertFalse(projected['completed']);self.assertEqual(projected['quality'],{'available':False})
                record=stability.record(source,fullstack.SERVICES)
                record['warmup']=[{k:projected[k] for k in ('ordinal','completed','quality','slot_refusal')}]
                output=root/('unknown-'+str(index));output.mkdir();fullstack.pilot.write_json(output/stability.NAME,record)
                public=root/('unknown-public-'+str(index));fullstack.stability_collect(output,admitted,public)
                self.assertNotIn('private-key-url-env-payload',json.dumps(stability.read(public,source,fullstack.SERVICES)))
            # A missing diagnostic observation cannot veto an otherwise successful body.
            value=phase();value['load'].update(completed=True,missed=0,success=400);value.pop('loadgen_cpu_pressure')
            projected=stability.project(value,0,fullstack.SERVICES)
            self.assertTrue(projected['completed']);self.assertEqual(projected['quality'],{'available':False})
            base=stability.record(source,fullstack.SERVICES)
            projected=stability.project(phase(),0,fullstack.SERVICES)
            base['warmup']=[{k:projected[k] for k in ('ordinal','completed','quality','slot_refusal')}]
            invalid=[]
            for field,bad in [('available',1),('private','private-key-url-env-payload'),('scheduled',401),('missed',-1),
                              ('success',True),('unexpected_failures',float('nan')),('counter_samples',1),
                              ('counter_errors',{'engine_read_failed':67,'required_counter_unavailable':0}),
                              ('counter_errors',{'private-key-url-env-payload':1}),('phase_errors',['private-key-url-env-payload']),
                              ('phase_errors',['sampler_failed','sampler_failed']),('loadgen_cpu_pressure','private-key-url-env-payload'),
                              ('loadgen_cpu_pressure','throttled')]:
                broken=copy.deepcopy(base);broken['warmup'][0]['quality'][field]=bad;invalid.append(broken)
            for bad in ({'available':False,'client_completed':False},{'available':False,'private':'private-key-url-env-payload'},None):
                broken=copy.deepcopy(base);broken['warmup'][0]['quality']=bad;invalid.append(broken)
            broken=copy.deepcopy(base);broken['warmup'][0].pop('quality');invalid.append(broken)
            broken=copy.deepcopy(base);broken['warmup'][0]['completed']=True;invalid.append(broken)
            broken=copy.deepcopy(base);broken['acceptance']['capacity']=True;invalid.append(broken)
            broken=copy.deepcopy(base);broken['schema']=1;invalid.append(broken)
            for index,record in enumerate(invalid):
                output=root/('forged-'+str(index));output.mkdir();(output/stability.NAME).write_text(json.dumps(record))
                public=root/('forged-public-'+str(index))
                with self.subTest(forgery=index),self.assertRaises(ValueError):fullstack.stability_collect(output,admitted,public)
                self.assertFalse(public.exists())
            output=root/'duplicate';output.mkdir()
            raw=json.dumps(base).replace('"available": true','"available": false,"available": true',1)
            (output/stability.NAME).write_text(raw)
            with self.assertRaises(ValueError):fullstack.stability_collect(output,admitted,root/'duplicate-public')
            self.assertFalse((root/'duplicate-public').exists())

    def test_warmup_quality_counts_cannot_exceed_scheduled_slots(self):
        import stability
        from test_hosted import metadata
        def phase(scheduled,success,missed):
            m=measurement(0)
            return {'load':{**m,'completed':False,'scheduled':scheduled,'success':success,'missed':missed,
                'unexpected_failures':3,'timing_diagnostics':{'requests':m['requests'],
                    'phase_start':m['phase_start'],'phase_end':m['phase_end']}},
                'errors':[],'loadgen_cpu_pressure':{'state':'unthrottled'},
                'samples':[{'counters':{'at_seconds':0,'services':{},'errors':{}},'counter_clock_anchor':[0,0,0],
                    'diagnostic_context':dict.fromkeys(stability.CONTEXT)} for _ in range(2)]}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);admitted=metadata(root)
            source=json.loads((admitted/'source.json').read_text())['checkout_sha']
            valid=stability.project(phase(4,2,1),0,fullstack.SERVICES)
            self.assertTrue(valid['quality']['available']);self.assertFalse(valid['completed'])
            base=stability.record(source,fullstack.SERVICES)
            base['warmup']=[{k:valid[k] for k in ('ordinal','completed','quality','slot_refusal')}]
            output=root/'valid-partial';output.mkdir();fullstack.pilot.write_json(output/stability.NAME,base)
            fullstack.stability_collect(output,admitted,root/'valid-public')
            collected=stability.read(root/'valid-public',source,fullstack.SERVICES)
            self.assertEqual(collected['warmup'][0]['quality']['unexpected_failures'],3)
            self.assertEqual(collected['state'],'incomplete');self.assertFalse(collected['acceptance']['capacity'])
            # No equality requirement: two success plus one missed leaves one unfinished.
            # Additional probe failures are deliberately outside this slot inequality.
            for index,(scheduled,success,missed) in enumerate(((0,400,0),(1,0,2),(4,3,2))):
                with self.subTest(public_counts=index):
                    bad=copy.deepcopy(base);bad['warmup'][0]['quality'].update(scheduled=scheduled,success=success,missed=missed)
                    output=root/('impossible-'+str(index));output.mkdir();fullstack.pilot.write_json(output/stability.NAME,bad)
                    public=root/('impossible-public-'+str(index))
                    try:fullstack.stability_collect(output,admitted,public)
                    except ValueError:pass
                    else:
                        published=stability.read(public,source,fullstack.SERVICES)['warmup'][0]['quality']
                        self.fail('collector published impossible counts: '+json.dumps(
                            {k:published[k] for k in ('scheduled','success','missed')}))
                    self.assertFalse(public.exists())
                with self.subTest(raw_counts=index):
                    projected=stability.project(phase(scheduled,success,missed),0,fullstack.SERVICES)
                    self.assertFalse(projected['completed']);self.assertEqual(projected['quality'],{'available':False})

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
            record=stability.record('a'*40);record['warmup']=[{'ordinal':0,'completed':True,'quality':{'available':False},'slot_refusal':{'schema':1,'state':'not_refused'}}];record['measurements']=[projected]
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
