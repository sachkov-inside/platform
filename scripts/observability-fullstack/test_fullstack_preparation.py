"""Prepared full corpus and optional web-image lifetime use the existing owned boundary."""
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import fullstack


class Preparation(unittest.TestCase):
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

        # Actual fixed client: its HTTP timer returns a safe observation at2s, but a
        # fixture resolver handle keeps Node alive past the unchanged4s parent deadline.
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);pidfile=base/'pid';preload=base/'preload.mjs'
            preload.write_text("import fs from 'node:fs';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';\n"
                +"const read=fs.readFileSync;fs.readFileSync=(path,...args)=>read(path==='/resource/full-profile.json'?"+json.dumps(str(fullstack.PROFILE))+":path,...args);\n"
                +"fs.writeFileSync("+json.dumps(str(pidfile))+",String(process.pid));dns.lookup=(host,options,callback)=>{const done=typeof options==='function'?options:callback;setTimeout(()=>done(Object.assign(new Error('fixture'),{code:'ENOTFOUND'})),8000);};syncBuiltinESMExports();")
            node=shutil.which('node');self.assertIsNotNone(node)
            def docker_args(args):
                return [node,'--import',str(preload),str(fullstack.HERE/'client.mjs'),*args[args.index('/resource/fullstack.mjs')+1:]]
            output=io.StringIO();failure=RuntimeError('owned deadline')
            with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack.pilot,'assert_docker_identity'),patch.object(fullstack.pilot,'docker_args',side_effect=docker_args),patch.object(fullstack.pilot,'await_fact',side_effect=await_fact),redirect_stdout(output):
                with self.assertRaises(RuntimeError) as caught:fullstack.ready([], '/ready','telegram',3002)
            self.assertIs(caught.exception,failure)
            value=json.loads(output.getvalue())['fullstack_readiness']
            self.assertFalse(value['ok']);self.assertEqual(value['probe']['outcome'],'timeout')
            self.assertEqual(value['probe']['observation'],{'ok':False,'status':0,'cause':'transport_unavailable'})
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
            self.assertEqual(plan['services']['provider']['environment']['INSIDE_RESOURCE_ACCOUNT_COUNT'],'128')
            self.assertIn('postgres:5432/umami',(output/'monitoring/umami.env').read_text())
            self.assertEqual((output/'monitoring/umami.database.password').stat().st_mode&0o777,0o600)
            for enabled in (False,True):
                fullstack.mode(output,enabled)
                observed=json.loads((output/'compose.json').read_text())
                self.assertEqual(observed['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED'],str(enabled).lower())
                self.assertTrue(all(observed['services'][name]['environment']['INSIDE_OTEL_ENABLED']==str(enabled).lower() for name in fullstack.BACKENDS))

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
            with patch.object(fullstack.technical.check,'read_ready',side_effect=[(200,'{}'),(200,'{"status":"success","data":{"resultType":"scalar","result":[1,"1"]}}')]) as read,patch.object(fullstack.pilot.time,'sleep'):
                fullstack.await_collector(output)
                self.assertEqual(read.call_count,2)

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
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'write_json',side_effect=[None,OSError('ENOSPC')]),patch.object(fullstack.pilot,'worker_storage_guard',side_effect=primary):
                try:fullstack.worker(output)
                except RuntimeError as caught:self.assertIs(caught,primary)
                else:self.fail('original failure was lost')
