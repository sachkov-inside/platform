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
            self.assertEqual(len(plan['services']['volume-reader']['volumes']),9)
            self.assertEqual(plan['services']['provider']['environment']['INSIDE_RESOURCE_ACCOUNT_COUNT'],'128')
            self.assertIn('postgres:5432/umami',(output/'monitoring/umami.env').read_text())
            self.assertEqual((output/'monitoring/umami.database.password').stat().st_mode&0o777,0o600)
            for enabled in (False,True):
                fullstack.mode(output,enabled)
                observed=json.loads((output/'compose.json').read_text())
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
