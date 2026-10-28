"""Prepared full corpus and optional web-image lifetime use the existing owned boundary."""
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import fullstack


class Preparation(unittest.TestCase):
    def source_phase(self, *, missing_delivery=False):
        # Real phase thread, source projections and atomic tempfile publication;
        # Engine/SQL/wget/load effects are controlled wire boundaries, not Linux proof.
        from test_source_cache import pg,wire
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();(output/'watchdog-fixture').mkdir(mode=0o700)
            (output/'caddy-source.json').write_text('{"server":"srv0"}')
            sampled=threading.Event();original=fullstack.source_cache.sample
            def sample(*args,**options):
                if missing_delivery:options['observer']=lambda row:None
                return original(*args,**options)
            def capture(states):
                value={'at_seconds':time.monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
                if threading.current_thread() is not threading.main_thread():sampled.set()
                return value
            def invoke(compose,args,**options):
                if args[:3]==['exec','-T','caddy']:return (wire()+b'process_start_time_seconds 10\n').decode()
                self.assertTrue(sampled.wait(15),'source sampling must commit before the load fixture completes')
                return json.dumps({'telegram_acknowledged':0,'completed':True})
            def awaited(read,predicate,**options):
                value=read();self.assertTrue(predicate(value));return value
            states={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
            with patch.object(fullstack.time,'time',return_value=100),patch.object(fullstack.technical,'owned',return_value=states),patch.object(fullstack.technical,'capture',side_effect=capture),patch.object(fullstack,'host',return_value={}),patch.object(fullstack.storage,'observe',return_value={}),patch.object(fullstack,'sql',return_value=pg().decode()),patch.object(fullstack,'invoke',side_effect=invoke),patch.object(fullstack.telegram,'processed',return_value={'accepted':0}),patch.object(fullstack.pilot,'await_fact',side_effect=awaited),patch.object(fullstack.source_cache,'sample',side_effect=sample):
                value=fullstack.phase([], 'owned', {'name':'spike','seconds':10,'requests_per_second':40}, ('loadgen',), True, 0, output)
            files={path.name:path.read_text() for path in (output/'watchdog-fixture').iterdir()}
            return value,files

    def test_phase_retains_actual_source_publication_rows_and_unchanged_source_statuses(self):
        value,files=self.source_phase();diagnostic=value['source_publication_timing']
        self.assertEqual(diagnostic['state'],'complete');self.assertEqual(diagnostic['cycles'],1)
        self.assertEqual(diagnostic['invalid_rows'],0);self.assertEqual(diagnostic['overflow_rows'],0)
        self.assertEqual(value['source_cache_samples'],[{'postgresql':'observed','caddy':'observed'}])
        self.assertTrue(value['load']['completed']);self.assertEqual(value['errors'],[])
        self.assertEqual([r['source'] for r in diagnostic['rows']],['postgresql','caddy'])
        for row in diagnostic['rows']:
            self.assertEqual(row['cycle'],0)
            before,epoch,after=row['clock_anchor'];self.assertLessEqual(before,after);self.assertGreater(epoch,0)
            self.assertLessEqual(row['publish_end_monotonic_ms'],before)
            self.assertIn('} '+str(row['observed_at_seconds'])+'\n',files[row['source']+'-source.prom'])

    def test_missing_observer_delivery_is_unknown_without_changing_the_actual_phase(self):
        value,files=self.source_phase(missing_delivery=True)
        self.assertTrue(value['load']['completed']);self.assertEqual(value['errors'],[])
        self.assertEqual(value['source_cache_samples'],[{'postgresql':'observed','caddy':'observed'}])
        diagnostic=value['source_publication_timing']
        self.assertEqual(diagnostic['state'],'invalid');self.assertEqual(diagnostic['invalid_rows'],2)
        self.assertEqual(diagnostic['cycles'],1);self.assertEqual(diagnostic['rows'],[])
        self.assertEqual(set(files),{'postgresql-source.prom','caddy-source.prom'})

    def test_source_publication_ledger_caps_actual_format_and_marks_overflow(self):
        value,_=self.source_phase();ledger=fullstack.SourcePublicationTiming(True)
        templates=[{k:v for k,v in row.items() if k not in ('cycle','clock_anchor')} for row in value['source_publication_timing']['rows']]
        for cycle in range(64):
            ledger.begin(cycle)
            for row in templates:ledger.observe(row)
            ledger.end()
        self.assertEqual(ledger.value['state'],'complete');self.assertEqual(len(ledger.value['rows']),128)
        self.assertEqual(ledger.value['cycles'],64)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'phase.json';fullstack.pilot.write_json(path,{'source_publication_timing':ledger.value})
            self.assertLess(path.stat().st_size,1_048_576)
            self.assertEqual(json.loads(path.read_text())['source_publication_timing'],ledger.value)
        ledger.begin(64)
        for row in templates:ledger.observe(row)
        ledger.end()
        self.assertEqual(ledger.value['state'],'overflow');self.assertEqual(ledger.value['overflow_rows'],2)
        self.assertEqual(len(ledger.value['rows']),128);self.assertEqual(ledger.value['cycles'],64)

    def test_source_publication_ledger_refuses_malformed_private_or_impossible_rows(self):
        value,_=self.source_phase();base={k:v for k,v in value['source_publication_timing']['rows'][0].items() if k not in ('cycle','clock_anchor')}
        mutations=[{'source':'private-sentinel'},{'private-sentinel':'private-sentinel'},
            {'read_outcome':'private-sentinel'},{'publication_outcome':'private-sentinel'},
            {'projection_state':'private-sentinel'},{'read_start_monotonic_ms':True},
            {'observed_at_seconds':float('inf')},{'read_end_monotonic_ms':float('nan')},
            {'publish_end_monotonic_ms':-1},{'observed_at_seconds':2**53},
            {'read_start_monotonic_ms':base['read_end_monotonic_ms']+1},
            {'projection_state':'unknown'},{'publication_outcome':'not_attempted'},
            {'read_outcome':'failed'}]
        for mutation in mutations:
            with self.subTest(keys=tuple(mutation)):
                ledger=fullstack.SourcePublicationTiming(True);ledger.begin(0);ledger.observe({**base,**mutation});ledger.end()
                self.assertEqual(ledger.value['state'],'invalid');self.assertEqual(ledger.value['rows'],[])
                self.assertNotIn('private-sentinel',json.dumps(ledger.value))
        ledger=fullstack.SourcePublicationTiming(True);ledger.begin(0);ledger.observe(base);ledger.observe(base);ledger.end()
        self.assertEqual(ledger.value['state'],'invalid');self.assertEqual(len(ledger.value['rows']),1)
        # Unknown timing is explicit null, with original finite source facts retained.
        for unknown in ('read_start_monotonic_ms','publish_end_monotonic_ms'):
            ledger=fullstack.SourcePublicationTiming(True);ledger.begin(0);ledger.observe({**base,unknown:None});ledger.end()
            self.assertEqual(ledger.value['state'],'invalid');self.assertIsNone(ledger.value['rows'][0][unknown])
        for invalid in (float('nan'),float('inf'),-1,True,'private-sentinel',RuntimeError('private-sentinel')):
            ledger=fullstack.SourcePublicationTiming(True);ledger.begin(0)
            def epoch():
                if isinstance(invalid,Exception):raise invalid
                return invalid
            with patch.object(fullstack.time,'time',side_effect=epoch):ledger.observe(base)
            ledger.end();self.assertIsNone(ledger.value['rows'][0]['clock_anchor']);self.assertEqual(ledger.value['state'],'invalid')
        off=fullstack.SourcePublicationTiming(False)
        self.assertEqual(off.value,{'schema':1,'state':'off','cycles':0,'invalid_rows':0,'overflow_rows':0,'rows':[]})

    def test_real_worker_writes_source_publications_only_to_raw_phase_before_summary(self):
        # Real worker serialization path, controlled external runtime boundaries.
        from contextlib import ExitStack,nullcontext
        from types import SimpleNamespace
        stop=RuntimeError('stop_after_saved_phase')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            (output/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'owned'}))
            (output/'compose.json').write_text(json.dumps({'services':{'grafana':{'user':'1:1'}}}))
            diagnostic={'schema':1,'state':'complete','cycles':1,'rows':[{'source':'postgresql'}]}
            measured={'samples':[{'host':{},'counters':{'errors':{}}}],'load':{'timing_diagnostics':{}},'errors':[],'source_publication_timing':diagnostic}
            profile={'pairs':[['on']],'phases':[{'name':'idle','seconds':10,'requests_per_second':0}]}
            with ExitStack() as patches:
                patches.enter_context(patch.object(fullstack,'sys',SimpleNamespace(platform='linux')))
                patches.enter_context(patch.object(fullstack.acceptance,'validate_profile',return_value=profile))
                patches.enter_context(patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()))
                patches.enter_context(patch.object(fullstack.production.pilot,'install_horizon'))
                patches.enter_context(patch.object(fullstack.production.pilot,'install_plugin'))
                patches.enter_context(patch.object(fullstack.resource_runtime,'wait_ready'))
                patches.enter_context(patch.object(fullstack.extra,'warmup'))
                for name in ('mode','ready','await_sources'):
                    patches.enter_context(patch.object(fullstack,name))
                def runtime(compose,args,**options):
                    if 'loss' in args:raise stop
                    return ''
                patches.enter_context(patch.object(fullstack,'invoke',side_effect=runtime))
                patches.enter_context(patch.object(fullstack,'seed',return_value={}))
                patches.enter_context(patch.object(fullstack,'initialize_web_http',return_value={'state':'observed'}))
                patches.enter_context(patch.object(fullstack,'prove_web_http',return_value={'state':'observed'}))
                patches.enter_context(patch.object(fullstack,'phase',return_value=measured))
                patches.enter_context(patch.object(fullstack.technical,'summarize',return_value={}))
                patches.enter_context(patch.object(fullstack,'await_collector',side_effect=stop))
                with self.assertRaises(RuntimeError) as caught:fullstack.worker(output)
                self.assertIs(caught.exception,stop)
            raw=json.loads((output/'fullstack-phase-0.json').read_text());summary=json.loads((output/'fullstack-proof.json').read_text())
            self.assertEqual(raw['source_publication_timing'],diagnostic)
            self.assertNotIn('source_publication_timing',summary['phases'][0])
            self.assertNotIn('timing_diagnostics',summary['phases'][0]['load'])

    def test_readiness_failure_keeps_only_the_last_closed_observation_and_original_failure(self):
        import io
        from contextlib import redirect_stdout
        for projected,outcome,output_kind in (
                ({'ok':False,'status':503,'cause':'membership_unavailable'},'completed','valid'),
                ({'ok':False,'status':503,'cause':'private-sentinel'},'completed','invalid_projection'),
                ('private-sentinel','completed','invalid_json'),
                (RuntimeError('private-sentinel'),'command_failed','empty'),
                (subprocess.TimeoutExpired('private-sentinel',4,output=b'{"ok":true,"status":200,"cause":"ready"}'),'timeout','valid')):
            failure=RuntimeError('owned deadline')
            def await_fact(read,predicate,**options):
                self.assertFalse(predicate(read()))
                raise failure
            output=io.StringIO()
            options={'side_effect':projected} if isinstance(projected,BaseException) else {'return_value':json.dumps(projected) if type(projected) is dict else projected}
            with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack,'invoke',**options),patch.object(fullstack.pilot,'await_fact',side_effect=await_fact),redirect_stdout(output):
                with self.assertRaises(RuntimeError) as caught:fullstack.ready([], '/ready','telegram',3002)
            self.assertIs(caught.exception,failure)
            self.assertNotIn('private-sentinel',output.getvalue())
            value=json.loads(output.getvalue())['fullstack_readiness']
            self.assertEqual(value['target'],'telegram');self.assertFalse(value['ok'])
            self.assertEqual(value['probe']['outcome'],outcome)
            self.assertEqual(value['probe']['output'],output_kind)
            self.assertEqual(value['containers'],{name:{'state':'unavailable'} for name in ('loadgen','telegram','bot-provider')})
            # A valid ready prefix in a timed-out child is diagnostic evidence only.
            if outcome=='timeout':self.assertTrue(value['probe']['observation']['ok'])

        compose=['docker','compose','-p',fullstack.PREFIX+'a'*12,'-f','/owned/compose.json']
        ids=['a'*64,'b'*64,'c'*64]
        rows=[{'id':identity,'project':compose[3],'service':name,'state':'exited' if name=='telegram' else 'running',
               'running':name!='telegram','oom':name=='telegram','exit_code':137 if name=='telegram' else 0,'restarts':0}
              for identity,name in zip(ids,('loadgen','telegram','bot-provider'))]
        for fault in (None,'foreign','duplicate','invalid','missing'):
            current=json.loads(json.dumps(rows))
            if fault=='foreign':current[1]['project']='private-sentinel'
            if fault=='duplicate':current[1]['service']='loadgen'
            if fault=='invalid':current[1]['exit_code']=True
            if fault=='missing':current=current[:-1]
            returned_ids=ids[:-1] if fault=='missing' else ids
            with patch.object(fullstack,'invoke',side_effect=['\n'.join(returned_ids),'\n'.join(json.dumps(row) for row in current)]) as read:
                states=fullstack.readiness_containers(compose)
            self.assertEqual(read.call_count,2)
            self.assertTrue(all(0<call.kwargs['timeout']<=4 for call in read.call_args_list))
            self.assertNotIn('private-sentinel',json.dumps(states));self.assertNotIn(ids[0],json.dumps(states))
            if fault in ('foreign','duplicate','invalid'):
                self.assertTrue(all(value=={'state':'unavailable'} for value in states.values()))
            else:
                self.assertEqual(states['telegram'],{'state':'exited','running':False,'oom':True,'exit_code':137,'restarts':0})
                if fault=='missing':self.assertEqual(states['bot-provider'],{'state':'missing'})
        # Diagnostic lookup failure and print failure must not replace the original deadline.
        for broken in ('inspect','print'):
            output=io.StringIO();failure=RuntimeError('owned deadline')
            with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack,'invoke',side_effect=RuntimeError('private-sentinel')),patch.object(fullstack.pilot,'await_fact',side_effect=await_fact),patch.object(fullstack,'readiness_containers',side_effect=KeyboardInterrupt() if broken=='inspect' else None,return_value={name:{'state':'unavailable'} for name in fullstack.READINESS_ROLES}),patch('builtins.print',side_effect=OSError('private-sentinel') if broken=='print' else None),redirect_stdout(output):
                with self.assertRaises(RuntimeError) as caught:fullstack.ready([], '/ready','telegram',3002)
            self.assertIs(caught.exception,failure)

        # Actual fixed client must terminate its own one-shot process after its2s
        # HTTP outcome, even while an unrelated resolver handle remains pending.
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);pidfile=base/'pid';preload=base/'preload.mjs'
            preload.write_text("import fs from 'node:fs';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';\n"
                +"const read=fs.readFileSync;fs.readFileSync=(path,...args)=>read(path==='/resource/full-profile.json'?"+json.dumps(str(fullstack.PROFILE))+":path,...args);\n"
                +"fs.writeFileSync("+json.dumps(str(pidfile))+",String(process.pid));dns.lookup=(host,options,callback)=>{const done=typeof options==='function'?options:callback;setTimeout(()=>done(Object.assign(new Error('fixture'),{code:'ENOTFOUND'})),8000);};syncBuiltinESMExports();")
            node=shutil.which('node');self.assertIsNotNone(node)
            # Keep the original timeout-prefix proof through a separately owned
            # deliberately nonfinishing probe, rather than preserving the client bug.
            nonfinishing=base/'nonfinishing.mjs'
            nonfinishing.write_text('process.stdout.write(JSON.stringify({ok:true,status:200,cause:"ready"})+"\\n");setTimeout(()=>{},8000);')
            for program,expected,observation in (
                    (fullstack.HERE/'client.mjs','completed',{'ok':False,'status':0,'cause':'transport_unavailable'}),
                    (nonfinishing,'timeout',{'ok':True,'status':200,'cause':'ready'})):
                def docker_args(args):
                    return [node,'--import',str(preload),str(program),*args[args.index('/resource/fullstack.mjs')+1:]]
                output=io.StringIO();failure=RuntimeError('owned deadline')
                with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack.pilot,'assert_docker_identity'),patch.object(fullstack.pilot,'docker_args',side_effect=docker_args),patch.object(fullstack.pilot,'await_fact',side_effect=await_fact),redirect_stdout(output):
                    with self.assertRaises(RuntimeError) as caught:fullstack.ready([], '/ready','telegram',3002)
                self.assertIs(caught.exception,failure)
                value=json.loads(output.getvalue())['fullstack_readiness']
                self.assertFalse(value['ok']);self.assertEqual(value['probe']['outcome'],expected)
                self.assertEqual(value['probe']['observation'],observation)
                with self.assertRaises(ProcessLookupError):os.kill(int(pidfile.read_text()),0)

    def test_complete_generated_corpus_has_private_shared_pg_and_no_production_ingress(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();output=base/'owned';images=base/'images.json'
            pins={'schema':3,'source':'a'*40,'owner':'inside-platform-production-smoke-cache-full',
                'backend':'sha256:'+'b'*64,'foundation':'sha256:'+'c'*64,'web':'sha256:'+'d'*64,'telegram':'sha256:'+'e'*64,'logto':'sha256:'+'f'*64}
            images.write_text(json.dumps(pins))
            def command(args,**kwargs):
                if args[0]=='git':return pins['source']
                if args[0]=='bash':
                    completed=subprocess.run(args,capture_output=True,text=True,check=True,timeout=15)
                    return completed.stdout
                if '-foundation:local' in ' '.join(args):return pins['foundation']
                for role in ('web','telegram','logto'):
                    if '-'+role+':v1' in ' '.join(args):return pins[role]
                return pins['backend']
            with patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot,'assert_docker_identity'):
                fullstack.inputs(output,images)
            plan=json.loads((output/'compose.json').read_text())
            self.assertEqual(set(plan['services']),set(fullstack.SERVICES))
            self.assertEqual(plan['networks']['pilot'],{'internal':True})
            secret=(output/'monitoring/grafana.password').stat()
            self.assertEqual(plan['services']['grafana']['user'],f'{secret.st_uid}:{secret.st_gid}')
            self.assertEqual(secret.st_mode&0o777,0o600)
            self.assertIn('storage',plan['services']['loadgen']['networks'])
            self.assertEqual(plan['services']['loadgen']['cpus'],2)
            self.assertEqual(plan['services']['loadgen']['mem_limit'],'96m')
            self.assertIn(str(fullstack.HERE/'phase-timing.mjs')+':/resource/phase-timing.mjs:ro',plan['services']['loadgen']['volumes'])
            self.assertEqual(plan['services']['provider']['cpus'],'0.25')
            self.assertNotIn('profiles',plan['services']['host-agent'])
            for name in fullstack.APPS:
                self.assertNotIn('ports',plan['services'][name])
                self.assertEqual(plan['services'][name]['pull_policy'],'never')
            self.assertEqual(plan['services']['bot-provider']['networks'],{'pilot':{'aliases':['api.telegram.org']}})
            self.assertEqual(plan['services']['telegram']['image'],pins['telegram'])
            self.assertIn('logto',plan['services'])
            self.assertEqual(plan['services']['web']['networks']['telemetry']['aliases'],['inside-web-http'])
            self.assertEqual(plan['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED'],'false')
            seeder=plan['services']['migrations']
            self.assertIn('/app/dist/development:size=1m,mode=1777',seeder['tmpfs'])
            self.assertEqual(len(seeder['volumes']),3)
            self.assertTrue(all(mount.endswith(':ro') for mount in seeder['volumes']))
            self.assertNotIn('/app/dist/development:size=1m,mode=1777',plan['services']['api']['tmpfs'])
            self.assertEqual(len(plan['services']['volume-reader']['volumes']),9)
            self.assertEqual(plan['services']['provider']['environment']['INSIDE_RESOURCE_ACCOUNT_COUNT'],'256')
            self.assertIn('postgres:5432/umami',(output/'monitoring/umami.env').read_text())
            self.assertEqual((output/'monitoring/umami.database.password').stat().st_mode&0o777,0o600)
            for enabled in (False,True):
                fullstack.mode(output,enabled)
                observed=json.loads((output/'compose.json').read_text())
                self.assertEqual(observed['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED'],str(enabled).lower())
                self.assertEqual(observed['services']['loadgen']['cpus'],2)
                self.assertEqual(observed['services']['loadgen']['mem_limit'],'96m')
                self.assertEqual(observed['services']['provider']['cpus'],'0.25')
                self.assertTrue(all(observed['services'][name]['environment']['INSIDE_OTEL_ENABLED']==str(enabled).lower() for name in fullstack.BACKENDS))

    def test_mode_witness_cannot_expire_stored_source_readiness_before_first_phase(self):
        # Pure worker unit: all Docker, native, storage and host effects are replaced.
        # This never executes a Linux command or claims a Linux host measurement.
        from contextlib import ExitStack, nullcontext
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'owner.json').write_text(json.dumps({'supervisor_pid':os.getppid(),'project':'owned'}))
            (output/'compose.json').write_text(json.dumps({'services':{'grafana':{'user':'1:1'}}}))
            clock={'now':0,'stored':None,'seeded':False,'visible':False,'queries':0}
            stop=RuntimeError('controlled_stop_after_first_phase')
            def stored(*args,**options):clock['stored']=clock['now']
            def witness(*args):
                self.assertTrue(clock['seeded'],'a fresh request proof requires the finite cohorts to exist first')
                self.assertTrue(clock['visible'],'initial ingestion must be visible before the NEW witness')
                clock['now']+=11;return {'state':'observed'}
            def runtime(compose,args,**options):
                if 'web-http-seed' in args:clock['seeded']=True;return '{"ok":true}'
                if 'web-http-initial-ready' in args:
                    clock['queries']+=1;clock['visible']=clock['queries']>=2
                    return json.dumps({'ok':clock['visible']})
                return ''
            def phase(*args,**options):
                self.assertIsNotNone(clock['stored'])
                self.assertLessEqual(clock['now']-clock['stored'],10,'the bounded witness must precede the stored freshness barrier')
                raise stop
            profile={'pairs':[['on']],'phases':[{'name':'idle','seconds':10,'requests_per_second':0}]}
            with ExitStack() as patches:
                patches.enter_context(patch.object(fullstack,'sys',SimpleNamespace(platform='linux')))
                patches.enter_context(patch.object(fullstack.acceptance,'validate_profile',return_value=profile))
                patches.enter_context(patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()))
                patches.enter_context(patch.object(fullstack.pilot,'write_json'))
                patches.enter_context(patch.object(fullstack.production.pilot,'install_horizon'))
                patches.enter_context(patch.object(fullstack.production.pilot,'install_plugin'))
                patches.enter_context(patch.object(fullstack.resource_runtime,'wait_ready'))
                patches.enter_context(patch.object(fullstack.extra,'warmup'))
                for name in ('mode','ready'):
                    patches.enter_context(patch.object(fullstack,name))
                patches.enter_context(patch.object(fullstack,'invoke',side_effect=runtime))
                patches.enter_context(patch.object(fullstack.pilot.time,'sleep'))
                patches.enter_context(patch.object(fullstack,'seed',return_value={}))
                patches.enter_context(patch.object(fullstack,'prove_web_http',side_effect=witness))
                patches.enter_context(patch.object(fullstack,'await_sources',side_effect=stored))
                patches.enter_context(patch.object(fullstack,'phase',side_effect=phase))
                with self.assertRaisesRegex(RuntimeError,'controlled_stop_after_first_phase') as caught:
                    fullstack.worker(output)
                self.assertIs(caught.exception,stop)

    def test_web_iid_is_owned_only_when_registered_before_acquisition(self):
        # Same stable Docker boundary fake as the preparation lifecycle tests.
        spec=importlib.util.spec_from_file_location('resource_lifetime_tests',fullstack.HERE.parent/'observability-resource/test_preparation.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        docker=module.Docker()
        with tempfile.TemporaryDirectory() as directory:
            stage=fullstack.preparation.begin(Path(directory)/'images.json',module.SOURCE,module.OWNER,module.DAEMON,'consumer',
                docker=docker,identify=lambda:module.DAEMON,web=True)
            image='sha256:'+'f'*64
            docker.images[image]={'Id':image,'RepoTags':[module.OWNER+'-web:v1'],'RepoDigests':[],
                'Config':{'Labels':{fullstack.preparation.LABEL:stage.receipt['token']}}}
            stage.iidfile('web').write_text(image)
            stage.capture()
            reopened=fullstack.preparation.open_stage(Path(directory)/'images.json',docker=docker,identify=lambda:module.DAEMON)
            result=reopened.release('consumer',cleanup_ok=True)
            self.assertEqual(result['state'],'retired');self.assertEqual(docker.removed,[image])


    def test_collector_recovery_uses_real_query_body_predicate_before_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);(output/'monitoring').mkdir();(output/'monitoring/reader.key').write_text('a'*32)
            with patch.object(fullstack.technical.check,'read_ready',side_effect=[(200,'{}'),(200,'{"status":"success","data":{"resultType":"scalar","result":[1,"1"]}}')]) as read,patch.object(fullstack.pilot,'request',side_effect=[(503,''),(200,'{}'),(200,'{}')]) as receiver,patch.object(fullstack.pilot.time,'sleep'):
                fullstack.await_collector(output)
                self.assertEqual(read.call_count,2)
                self.assertEqual(receiver.call_count,3)
                receiver.assert_called_with('/v1/traces',body={'resourceSpans':[]},method='POST',port=14318)
            with patch.object(fullstack.technical.check,'read_ready',return_value=(200,'{"status":"success","data":{"resultType":"scalar","result":[1,"1"]}}')) as read,patch.object(fullstack.pilot,'request',side_effect=[(503,''),(200,'{}')]) as receiver,patch.object(fullstack.pilot.time,'sleep'):
                fullstack.await_collector(output)
                self.assertEqual(receiver.call_count,2)
                self.assertEqual(read.call_count,1)
            with patch.object(fullstack.pilot.time,'monotonic',side_effect=[0,0,0,60,60]),patch.object(fullstack.pilot.time,'sleep'),patch.object(fullstack.pilot,'request',return_value=(200,'{}')),patch.object(fullstack.technical.check,'read_ready') as read:
                with self.assertRaises(RuntimeError):fullstack.await_collector(output)
                read.assert_not_called()

    def test_telegram_and_logto_image_ownership_is_registered_before_build_and_recovers(self):
        spec=importlib.util.spec_from_file_location('resource_lifetime_extensions',fullstack.HERE.parent/'observability-resource/test_preparation.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);docker=module.Docker()
        with tempfile.TemporaryDirectory() as directory:
            images=Path(directory)/'images.json'
            stage=fullstack.preparation.begin(images,module.SOURCE,module.OWNER,module.DAEMON,'consumer',docker=docker,identify=lambda:module.DAEMON,web=True,applications=True)
            expected=[module.OWNER+'-telegram:v1',module.OWNER+'-logto:v1']
            self.assertEqual(stage.receipt['tags'][-2:],expected)
            for index,role in enumerate(('telegram','logto'),1):
                image='sha256:'+str(index)*64
                docker.images[image]={'Id':image,'RepoTags':[expected[index-1]],'RepoDigests':[],'Config':{'Labels':{fullstack.preparation.LABEL:stage.receipt['token']}}}
                stage.iidfile(role).write_text(image)
                stage.capture()
            reopened=fullstack.preparation.open_stage(images,docker=docker,identify=lambda:module.DAEMON)
            self.assertEqual(reopened.release('consumer',cleanup_ok=True)['state'],'retired')
            self.assertEqual(set(docker.removed),{'sha256:'+'1'*64,'sha256:'+'2'*64})

    def test_source_read_callbacks_keep_sql_role_scope_loopback_target_and_body_caps(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'caddy-source.json').write_text('{"server":"srv0"}')
            def source(path,**callbacks):
                self.assertEqual(path,output/'watchdog-fixture')
                self.assertEqual(callbacks['postgres_read']('fixed source SQL'),b'owned PG')
                self.assertEqual(callbacks['caddy_read'](),b'owned Caddy')
                return {'postgresql':'observed','caddy':'observed'}
            with patch.object(fullstack,'sql',return_value='owned PG') as sql,patch.object(fullstack,'invoke',return_value='owned Caddy') as invoke,patch.object(fullstack.source_cache,'sample',side_effect=source):
                self.assertEqual(fullstack.sample_sources(['owned'],output),{'postgresql':'observed','caddy':'observed'})
                self.assertEqual(sql.call_args.kwargs,{'role':'postgres_source_reader','database':'inside','timeout':3})
                self.assertEqual(invoke.call_args.args[1],['exec','-T','caddy','wget','-Y','off','-q','-T','2','-O','-','http://127.0.0.1:9091/metrics'])
            def oversize(path,**callbacks):
                with self.assertRaises(ValueError):callbacks['postgres_read']('fixed source SQL')
                with self.assertRaises(ValueError):callbacks['caddy_read']()
                return {'postgresql':'unavailable','caddy':'unavailable'}
            with patch.object(fullstack,'sql',return_value='x'*4097),patch.object(fullstack,'invoke',return_value='x'*65537),patch.object(fullstack.source_cache,'sample',side_effect=oversize):
                self.assertEqual(set(fullstack.sample_sources(['owned'],output).values()),{'unavailable'})

    def test_failure_record_cannot_replace_primary_owned_runtime_error(self):
        primary=RuntimeError('private original SQL failure')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'owner.json').write_text(json.dumps({'supervisor_pid':fullstack.os.getppid(),'project':'owned-project'}))
            (output/'evidence.json').write_text(json.dumps({'source':'a'*40}))
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'write_json',side_effect=[None,OSError('ENOSPC')]),patch.object(fullstack.pilot,'worker_storage_guard',side_effect=primary):
                try:fullstack.worker(output)
                except RuntimeError as caught:self.assertIs(caught,primary)
                else:self.fail('original failure was lost')
            retained=fullstack.stage_timing.read(output,'a'*40)
            self.assertEqual(retained['state'],'failed')
            self.assertNotIn('private',json.dumps(retained))

    def test_both_modes_prefill_once_and_only_on_requires_fresh_stored_sources(self):
        observed={'postgresql':'observed','caddy':'observed'}
        for enabled in (False,True):
            def available(read,predicate,**options):
                self.assertEqual(options,{'budget':10,'probe':'source_cache_stored_ready'})
                self.assertTrue(predicate(read()))
            with patch.object(fullstack,'sample_sources',return_value=observed) as sample,patch.object(fullstack,'invoke',return_value='{"ok":true}') as invoke,patch.object(fullstack.pilot,'await_fact',side_effect=available) as wait:
                fullstack.await_sources(['owned'],Path('/owned'),enabled=enabled)
                sample.assert_called_once_with(['owned'],Path('/owned'))
                self.assertEqual(wait.call_count,int(enabled));self.assertEqual(invoke.call_count,int(enabled))
        for value in ({},{'postgresql':'observed','caddy':'unavailable'},{'postgresql':'unavailable','caddy':'observed'}):
            for enabled in (False,True):
                with patch.object(fullstack,'sample_sources',return_value=value),patch.object(fullstack,'invoke') as invoke,patch.object(fullstack.pilot,'await_fact') as wait:
                    with self.assertRaisesRegex(ValueError,'source_cache_native_unavailable'):
                        fullstack.await_sources([],Path('/owned'),enabled=enabled)
                    invoke.assert_not_called();wait.assert_not_called()

    def test_stored_source_deadline_caps_last_child_and_rejects_late_success(self):
        now=[0.0]
        def wait(read,predicate,**options):
            now[0]=9.0
            self.assertTrue(predicate(read()))
        def response(*args,**options):
            self.assertEqual(options['timeout'],1.0)
            return '{"ok":true}'
        with patch.object(fullstack,'sample_sources',return_value={'postgresql':'observed','caddy':'observed'}),patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot,'await_fact',side_effect=wait),patch.object(fullstack,'invoke',side_effect=response):
            fullstack.await_sources([],Path('/owned'))
        def late(*args,**options):
            now[0]=10.01
            return '{"ok":true}'
        now[0]=0.0
        with patch.object(fullstack,'sample_sources',return_value={'postgresql':'observed','caddy':'observed'}),patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot,'await_fact',side_effect=wait),patch.object(fullstack,'invoke',side_effect=late):
            with self.assertRaisesRegex(TimeoutError,'source_cache_stored_deadline'):
                fullstack.await_sources([],Path('/owned'))
