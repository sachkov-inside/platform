"""Prepared full corpus and optional web-image lifetime use the existing owned boundary."""
import importlib.util
import json
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
        for projected in ({'ok':False,'status':503,'cause':'membership_unavailable'},
                          {'ok':False,'status':503,'cause':'private-sentinel'}):
            failure=RuntimeError('owned deadline')
            def await_fact(read,predicate,**options):
                self.assertFalse(predicate(read()))
                raise failure
            output=io.StringIO()
            with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack,'invoke',return_value=json.dumps(projected)),patch.object(fullstack.pilot,'await_fact',side_effect=await_fact),redirect_stdout(output):
                with self.assertRaises(RuntimeError) as caught:fullstack.ready([], '/ready','telegram',3002)
            self.assertIs(caught.exception,failure)
            self.assertNotIn('private-sentinel',output.getvalue())
            value=json.loads(output.getvalue())['fullstack_readiness']
            self.assertEqual(value['target'],'telegram')
            self.assertEqual(value['cause'],'membership_unavailable' if projected['cause']=='membership_unavailable' else 'observation_unavailable')

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
