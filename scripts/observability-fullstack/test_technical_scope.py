"""Fixed technical corpus uses the existing runner without analytics authority."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import acceptance
import fullstack
import prepare
import storage


class TechnicalScope(unittest.TestCase):
    def test_fixed_profile_preserves_original_schedule_and_thresholds(self):
        original=json.loads(fullstack.PROFILE.read_text())
        technical=fullstack.profile('technical')
        self.assertEqual(technical['name'],'platform-technical-v1')
        self.assertEqual(technical['operations'],['web_home','web_material','api_catalog','api_account','mcp_discovery','analytics_disabled','telegram_webhook','logto_discovery'])
        for key in ('pairs','phases','concurrency','request_timeout_ms','sample_interval_seconds','sample_ratio','thresholds','candidate_memory_gib','accounts','materials'):
            self.assertEqual(technical[key],original[key])
        self.assertEqual(fullstack.profile(),original)
        for invalid in ('unknown',True,None,'../technical'):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):fullstack.profile(invalid)
        for key,value in (('name','platform-representative-v1'),('request_timeout_ms',3000),('sample_interval_seconds',3),('sample_ratio',.5),('concurrency',9)):
            with self.subTest(key=key),self.assertRaises(ValueError):acceptance.validate_profile({**technical,key:value},scope='technical')

    def test_technical_preloads_remove_only_umami_keep_python_reader(self):
        full=set(prepare.preload_inventory())
        pins=json.loads((fullstack.ROOT/'infra/observability/umami/inputs.lock.json').read_text())['images']
        technical=set(prepare.preload_inventory(scope='technical'))
        self.assertEqual(technical,full-{pins['umami']})
        self.assertIn(pins['python'],technical)
        for invalid in ('unknown',False):
            with self.assertRaises(ValueError):prepare.preload_inventory(scope=invalid)

    def test_technical_database_observation_proves_umami_absence(self):
        volumes={name:{key:1 for key in storage.FIELDS} for name in storage.VOLUMES}
        databases={'inside':8192,'logto':8192,'inside_telegram':8192}
        seen=[]
        def sql(*args,**kwargs):
            seen.append(args[1]);return json.dumps(databases)
        result=storage.observe([],lambda *args,**kwargs:json.dumps(volumes),sql,scope='technical')
        self.assertEqual(result['database_bytes'],databases)
        self.assertIn("'umami'",seen[0])
        self.assertEqual(result['absent_databases'],['umami'])
        databases['umami']=8192
        with self.assertRaises(ValueError):storage.observe([],lambda *args,**kwargs:json.dumps(volumes),sql,scope='technical')

    def test_modes_omit_all_analytics_roles_and_keep_application_mcp(self):
        for enabled in (False,True):
            with self.subTest(enabled=enabled),tempfile.TemporaryDirectory() as directory:
                output=Path(directory)
                with patch.object(fullstack,'prepared_scope',return_value='technical'),patch.object(fullstack,'mode'),patch.object(fullstack,'invoke') as invoke,patch.object(fullstack.resource_runtime,'wait_ready'),patch.object(fullstack,'await_startup_role'),patch.object(fullstack,'ready'),patch.object(fullstack.extra,'warmup'),patch.object(fullstack,'initialize_web_http'),patch.object(fullstack,'prove_web_http'),patch.object(fullstack,'await_sources'):
                    active=fullstack.configure_mode([],output,enabled)
                self.assertIn('mcp',active)
                self.assertFalse(set(active)&{'umami','umami-ingest','umami-query'})
                self.assertNotIn('umami',repr(invoke.call_args_list))
                self.assertEqual(set(fullstack.SERVICES)-set(fullstack.services('technical')),{'umami','umami-ingest','umami-query'})

    def technical_report(self):
        settings=fullstack.profile('technical')
        phases=[]
        for pair,modes in enumerate(settings['pairs']):
            for mode in modes:
                for definition in settings['phases']:
                    count=0 if definition['name']=='idle' else 400
                    phases.append({'pair':pair,'mode':mode,'name':definition['name'],'scope_binding':{'nonce':'a'*64},
                        'process_roles':[name for name in fullstack.services('technical') if name not in ('migrations','broker-config','telegram-migrations','logto-migrations','volume-reader') and (mode=='on' or name not in fullstack.CORE)],
                        'storage_samples':[{'volumes':{name:{key:1 for key in storage.FIELDS} for name in storage.VOLUMES},'database_bytes':{'inside':8192,'logto':8192,'inside_telegram':8192},'absent_databases':['umami']} for _ in range(2)],
                        'load':{'scope':'technical','scheduled':count,'success':count,'missed':0,'completed':True,'disabled_operations':count//8,
                            'http_operations':{label:{'attempted':count//8,'completed':count//8,'successful':count//8} for label in ('web_home','web_material','api_catalog','api_account','mcp_discovery','telegram_webhook','logto_discovery')},
                            'attempted_probe_points':count if mode=='on' else 0,'acknowledged_probe_points':count if mode=='on' else 0,
                            'monitoring_http':{'attempted':20 if mode=='on' else 0,'completed':20 if mode=='on' else 0}}})
        return {'scope':'technical','profile':settings,'phases':phases,'full_spec_acceptance':'deferred','scope_binding':{'nonce':'a'*64}}

    def test_technical_closure_refuses_mixed_topology_database_and_invented_counts_before_assess(self):
        report=self.technical_report()
        summary=fullstack.technical_closure(report)
        self.assertEqual(summary['scheduled_slots'],3200)
        self.assertEqual(summary['disabled_slots'],400)
        self.assertEqual(summary['application_http_attempted'],2800)
        self.assertEqual(summary['application_http_completed'],2800)
        self.assertEqual(summary['otlp_probe_attempted'],1600)
        self.assertEqual(summary['per_lane'],{label:{'attempted':400,'completed':400,'successful':400} for label in report['phases'][1]['load']['http_operations']})
        for mutation in ('profile','order','analytics_role','missing_mcp','database','absence','count','bool','probe','scope','missing_phase','nonce'):
            value=copy.deepcopy(report);row=value['phases'][1]
            if mutation=='profile':value['profile']['name']='platform-representative-v1'
            if mutation=='order':value['phases'].reverse()
            if mutation=='analytics_role':row['process_roles'].append('umami')
            if mutation=='missing_mcp':row['process_roles'].remove('mcp')
            if mutation=='database':row['storage_samples'][0]['database_bytes']['umami']=8192
            if mutation=='absence':del row['storage_samples'][0]['absent_databases']
            if mutation=='count':row['load']['http_operations']['mcp_discovery']['completed']=0
            if mutation=='bool':row['load']['disabled_operations']=True
            if mutation=='probe':row['load']['attempted_probe_points']=400
            if mutation=='scope':row['load']['scope']='full'
            if mutation=='missing_phase':value['phases'].pop()
            if mutation=='nonce':row['scope_binding']['nonce']='b'*64
            with self.subTest(mutation=mutation),patch.object(fullstack.acceptance,'assess') as assess:
                with self.assertRaises(ValueError):fullstack.evaluate(value)
                assess.assert_not_called()

    def test_technical_seed_keeps_actors_contacts_materials_and_source_authority_without_umami(self):
        from contextlib import nullcontext
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);(output/'runtime/rabbitmq').mkdir(parents=True);(output/'provider').mkdir()
            (output/'compose.json').write_text(json.dumps({'services':{'grafana':{'user':'1000:1000'}}}))
            commands=[];queries=[]
            def native(compose,args,**options):
                commands.append(args)
                if args[-1]=='establish':return json.dumps({'created':256,'accounts':[f'{i:08x}-0000-0000-0000-000000000000' for i in range(256)]})
                return '{}'
            def sql(compose,query,**options):
                queries.append(query)
                return '{"accounts":256,"materials":512,"public_materials":512}' if 'public_materials' in query else ''
            with patch.object(fullstack,'prepared_scope',return_value='technical'),patch.object(fullstack.contact_job,'start',return_value=nullcontext(SimpleNamespace(wait=lambda:None))) as contacts,patch.object(fullstack,'invoke',side_effect=native),patch.object(fullstack,'sql',side_effect=sql),patch.object(fullstack.resource_runtime,'wait_ready'),patch.object(fullstack,'ready'),patch.object(fullstack.extra,'initialize'),patch.object(fullstack.telegram,'initialize'),patch.object(fullstack.source_cache,'select_caddy_server',return_value='srv0'),patch.object(fullstack.source_guard,'prove',return_value={'observed':True}) as source_guard,patch.object(fullstack.horizon_build,'verify'),patch.object(fullstack.pilot,'install_plugin'):
                self.assertEqual(fullstack.seed([],output),{'observed':True})
            contacts.assert_called_once();source_guard.assert_called_once()
            self.assertIn('SELECT pg_stat_reset();',queries)
            self.assertNotIn('umami',repr(commands)+repr(queries))
            self.assertEqual(len(json.loads((output/'provider/accounts.json').read_text())),256)
            self.assertFalse(list(output.rglob('umami*')))

    def prepare_inputs(self,base):
        import subprocess
        output=base/'owned';images=base/'images.json'
        pins={'schema':3,'source':'a'*40,'owner':'inside-platform-production-smoke-cache-full','scope':'technical',
            'backend':'sha256:'+'b'*64,'foundation':'sha256:'+'c'*64,'web':'sha256:'+'d'*64,'telegram':'sha256:'+'e'*64,'logto':'sha256:'+'f'*64}
        images.write_text(json.dumps(pins))
        def command(args,**kwargs):
            if args[0]=='git':return pins['source']
            if args[0]=='bash':return subprocess.run(args,capture_output=True,text=True,check=True,timeout=15).stdout
            if '-foundation:local' in ' '.join(args):return pins['foundation']
            for role in ('web','telegram','logto'):
                if '-'+role+':v1' in ' '.join(args):return pins[role]
            return pins['backend']
        from collections import namedtuple
        usage=namedtuple('usage','total used free')
        with patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot,'assert_docker_identity'),patch.object(fullstack.pilot,'install_horizon'),patch.object(fullstack.pilot.shutil,'disk_usage',return_value=usage(128*1024**3,64*1024**3,64*1024**3)):
            fullstack.inputs(output,images,scope='technical')
        return output,pins

    def test_generated_technical_inputs_bind_source_scope_profile_nonce_topology_and_no_analytics(self):
        with tempfile.TemporaryDirectory() as directory:
            output,pins=self.prepare_inputs(Path(directory).resolve())
            plan=json.loads((output/'compose.json').read_text())
            self.assertEqual(set(plan['services']),set(fullstack.services('technical')))
            self.assertEqual(set(plan['volumes']),set(storage.VOLUMES))
            self.assertIn('mcp',plan['services']);self.assertIn('host-agent',plan['services'])
            self.assertFalse(list((output/'monitoring').glob('umami*')))
            self.assertFalse((output/'provider/umami.json').exists())
            self.assertEqual(fullstack.prepared_scope(output,expected='technical',source=pins['source']),'technical')
            prepared=json.loads((output/'fullstack-source.json').read_text())
            for mutation in ('source','scope','nonce','profile','roles','databases','output','images'):
                changed=copy.deepcopy(prepared)
                if mutation=='source':changed['source']='d'*40
                if mutation=='scope':changed['scope']='full'
                if mutation=='nonce':changed['scope_binding']['nonce']='invalid'
                if mutation=='profile':changed['profile']['concurrency']=9
                if mutation=='roles':changed['scope_binding']['services'].append('umami')
                if mutation=='databases':changed['scope_binding']['databases'].append('umami')
                if mutation=='output':changed['scope_binding']['output_sha256']='0'*64
                if mutation=='images':del changed['images']['scope']
                (output/'fullstack-source.json').write_text(json.dumps(changed))
                with self.subTest(mutation=mutation),self.assertRaises(ValueError):fullstack.prepared_scope(output,expected='technical',source=pins['source'])
            (output/'fullstack-source.json').write_text(json.dumps(prepared))
            plan['services']['umami']={};(output/'compose.json').write_text(json.dumps(plan))
            with self.assertRaises(ValueError):fullstack.prepared_scope(output,expected='technical')
            del plan['services']['umami'];(output/'compose.json').write_text(json.dumps(plan))
            monitor=output/'monitoring/inputs.json';record=json.loads(monitor.read_text());record['scope']='full';monitor.write_text(json.dumps(record))
            with self.assertRaises(ValueError):fullstack.prepared_scope(output,expected='technical')

    def test_technical_image_scope_mismatch_refuses_before_acquiring_any_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);images=base/'images.json';images.write_text(json.dumps({'schema':3,'scope':'full'}))
            with patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack.fixture,'prepare') as fixture:
                with self.assertRaises(ValueError):fullstack.inputs(base/'output',images,scope='technical')
                fixture.assert_not_called()

    def test_collector_rejects_cross_scope_source_and_nonce_before_bounded_copying(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();output,pins=self.prepare_inputs(base)
            prepared=json.loads((output/'fullstack-source.json').read_text())
            proof={'schema':1,'state':'failed','scope':'technical','scope_binding':prepared['scope_binding'],
                'profile':prepared['profile'],'full_spec_acceptance':'deferred','phases':[]}
            (output/'fullstack-proof.json').write_text(json.dumps(proof))
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':pins['source']},{})),patch.object(fullstack.resource_runtime.ci,'collect') as collect:
                fullstack.collect(output,base/'metadata',base/'public',scope='technical')
                collect.assert_called_once()
            for mutation in ('legacy_scope','legacy_profile','nonce','source','oversized','symlink'):
                value=copy.deepcopy(proof)
                if mutation=='legacy_scope':value['scope']='full'
                if mutation=='legacy_profile':value['profile']=fullstack.profile()
                if mutation=='nonce':value['scope_binding']['nonce']='b'*64
                if mutation=='source':value['scope_binding']['source']='b'*40
                if mutation=='oversized':value['untrusted']='x'*4_194_304
                path=output/'fullstack-proof.json';path.write_text(json.dumps(value))
                if mutation=='symlink':
                    target=output/'saved-proof.json';path.rename(target);path.symlink_to(target)
                with self.subTest(mutation=mutation),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':pins['source']},{})),patch.object(fullstack.resource_runtime.ci,'collect') as collect:
                    with self.assertRaises((ValueError,OSError)):fullstack.collect(output,base/'metadata',base/'public',scope='technical')
                    collect.assert_not_called()
                if path.is_symlink():path.unlink()
            (output/'fullstack-proof.json').write_text(json.dumps(proof))
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':pins['source']},{})),patch.object(fullstack.resource_runtime.ci,'collect') as collect:
                with self.assertRaises(ValueError):fullstack.collect(output,base/'metadata',base/'public')
                collect.assert_not_called()

    def test_technical_preparation_only_failures_publish_bounded_nonacceptance_without_runtime(self):
        import disk_feedback
        import preparation_evidence
        for checkpoint in ('admission','not_started','build_backend','preload_0'):
            with self.subTest(checkpoint=checkpoint),tempfile.TemporaryDirectory() as directory:
                base=Path(directory).resolve();output=base/'never-created';metadata=base/'metadata';metadata.mkdir();public=base/'public'
                source='a'*40
                (metadata/'source.json').write_text(json.dumps({'checkout_sha':source}))
                (metadata/'admission.json').write_text(json.dumps({'ready':checkpoint!='admission'}))
                if checkpoint!='admission':
                    record=preparation_evidence.Record(metadata,source,disk_feedback.Record(source));record.mark(checkpoint)
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{'ready':checkpoint!='admission'})):
                    fullstack.collect(output,metadata,public,scope='technical')
                self.assertFalse(output.exists())
                self.assertEqual(json.loads((public/'source.json').read_text())['checkout_sha'],source)
                proof=json.loads((public/'fullstack-proof.json').read_text())
                self.assertEqual(proof['state'],'preparation_only')
                self.assertEqual(proof['scope'],'technical')
                self.assertEqual(proof['source'],source)
                self.assertEqual(proof['profile'],fullstack.profile('technical'))
                self.assertEqual(proof['measured_linux_acceptance'],{'state':'incomplete'})
                self.assertEqual(proof['full_spec_acceptance'],'deferred')
                self.assertEqual(proof['phases'],[])
                self.assertNotIn('scope_binding',proof)
                self.assertEqual((public/preparation_evidence.NAME).exists(),checkpoint!='admission')

    def test_technical_collector_refuses_lost_runtime_binding_and_invalid_preparation_before_publication(self):
        import disk_feedback
        import preparation_evidence
        for fault in ('lost_runtime','wrong_source','invalid_preparation'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                base=Path(directory).resolve();output=base/'output';metadata=base/'metadata';metadata.mkdir()
                if fault=='lost_runtime':
                    output,pins=self.prepare_inputs(base)
                    (output/'fullstack-source.json').unlink()
                else:
                    record=preparation_evidence.Record(metadata,'b'*40 if fault=='wrong_source' else 'a'*40,disk_feedback.Record('b'*40 if fault=='wrong_source' else 'a'*40));record.persist()
                    if fault=='invalid_preparation':(metadata/preparation_evidence.NAME).write_text('{"stage":"private"}')
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})),patch.object(fullstack.resource_runtime.ci,'collect') as collect:
                    with self.assertRaises(ValueError):fullstack.collect(output,metadata,base/'public',scope='technical')
                    collect.assert_not_called()
                    self.assertFalse((base/'public').exists())

    def test_recovery_refuses_surviving_technical_inputs_before_cleanup_or_image_release(self):
        from contextlib import nullcontext
        from types import SimpleNamespace
        for marker in ('selected','monitoring','topology'):
            for scope in ('full','technical'):
                for registered in (False,True):
                    with self.subTest(marker=marker,scope=scope,registered=registered),tempfile.TemporaryDirectory() as directory:
                        base=Path(directory);output=base/'output';output.mkdir();images=base/'images.json';images.write_text('{}')
                        if registered:(output/'owner.json').write_text('{}')
                        if marker=='selected':(output/'selected-profile.json').write_text(json.dumps(fullstack.profile('technical')))
                        if marker=='monitoring':
                            (output/'monitoring').mkdir();(output/'monitoring/inputs.json').write_text('{"scope":"technical"}')
                        if marker=='topology':(output/'compose.json').write_text(json.dumps({'services':dict.fromkeys(fullstack.services('technical'),{})}))
                        stage=SimpleNamespace(in_use=lambda:nullcontext(),release=lambda *args,**kwargs:self.fail('image release before scope validation'))
                        with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope',scope,'--output',str(output),'--images',str(images)]),patch.object(fullstack.preparation,'directory',return_value=base),patch.object(fullstack.preparation,'recover_stage',return_value=stage) as acquire,patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                            with self.assertRaisesRegex(ValueError,'fullstack_scope_binding'):fullstack.main()
                            recover.assert_not_called();acquire.assert_not_called()

    def test_recovery_preserves_no_project_preparation_only_and_legacy_full_paths(self):
        from contextlib import nullcontext
        from types import SimpleNamespace
        for scope in ('full','technical'):
            for images_acquired in (False,True):
                with self.subTest(scope=scope,images=images_acquired),tempfile.TemporaryDirectory() as directory:
                    base=Path(directory);output=base/'absent';images=base/'images.json';images.write_text('{}')
                    releases=[]
                    stage=SimpleNamespace(in_use=lambda:nullcontext(),release=lambda *args,**kwargs:releases.append((args,kwargs)))
                    argv=['fullstack.py','recover','--scope',scope,'--output',str(output)]+(['--images',str(images)] if images_acquired else [])
                    with patch.object(fullstack.sys,'argv',argv),patch.object(fullstack.preparation,'directory',return_value=base),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.resource_runtime.ci,'recover',return_value={'state':'no registered project acquired'}) as recover:
                        fullstack.main()
                        self.assertEqual(recover.call_count,0 if images_acquired else 1)
                        self.assertEqual(len(releases),1 if images_acquired else 0)
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);(output/'owner.json').write_text('{}');(output/'compose.json').write_text(json.dumps({'services':dict.fromkeys(fullstack.services(),{})}))
            with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--output',str(output)]),patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                fullstack.main();recover.assert_called_once_with(output,project_prefix=fullstack.PREFIX,services=fullstack.SERVICES)

    def test_worker_and_contacts_refuse_deleted_scope_record_or_swapped_profile_before_runtime_mutation(self):
        import os
        from types import SimpleNamespace
        for fault in ('missing','missing_selected','swapped_profile'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                output,pins=self.prepare_inputs(Path(directory).resolve())
                (output/'owner.json').write_text(json.dumps({'project':'owned','supervisor_pid':os.getppid()}))
                if fault.startswith('missing'):(output/'fullstack-source.json').unlink()
                if fault=='missing_selected':(output/'selected-profile.json').unlink()
                if fault=='swapped_profile':(output/'selected-profile.json').write_text(json.dumps(fullstack.profile()))
                with patch.object(fullstack,'sys',SimpleNamespace(platform='linux')),patch.object(fullstack.pilot,'command',return_value=pins['source']),patch.object(fullstack,'invoke') as invoke,patch.object(fullstack.pilot,'restore_daemon') as restore,patch.object(fullstack.contact_job,'verify',return_value=pins['source']):
                    with self.assertRaises(ValueError):fullstack.worker(output)
                    with self.assertRaises(ValueError):fullstack.contacts_worker(output,'owned-token')
                    invoke.assert_not_called();restore.assert_not_called()
                    self.assertFalse((output/'fullstack-proof.json').exists())

    def test_unlabelled_worker_cannot_fall_back_to_full_after_losing_technical_source(self):
        import os
        from types import SimpleNamespace
        for marker in ('selected','monitoring','topology'):
            with self.subTest(marker=marker),tempfile.TemporaryDirectory() as directory:
                output=Path(directory)
                (output/'owner.json').write_text(json.dumps({'project':'owned','supervisor_pid':os.getppid()}))
                if marker=='selected':(output/'selected-profile.json').write_text(json.dumps(fullstack.profile('technical')))
                if marker=='monitoring':
                    (output/'monitoring').mkdir();(output/'monitoring/inputs.json').write_text('{"scope":"technical"}')
                if marker=='topology':(output/'compose.json').write_text(json.dumps({'services':dict.fromkeys(fullstack.services('technical'),{})}))
                with patch.object(fullstack,'sys',SimpleNamespace(platform='linux')),patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack,'invoke') as invoke,patch.object(fullstack.pilot,'restore_daemon') as restore,patch.object(fullstack.contact_job,'verify',return_value='a'*40):
                    with self.assertRaises(ValueError):fullstack.worker(output)
                    with self.assertRaises(ValueError):fullstack.contacts_worker(output,'owned-token')
                    invoke.assert_not_called();restore.assert_not_called()
                    self.assertFalse((output/'fullstack-proof.json').exists())

    def test_technical_image_preparation_keeps_five_image_lease_and_guard_binds_scope(self):
        from contextlib import contextmanager,ExitStack
        from types import SimpleNamespace
        from disk_samples import DiskSamples
        gib=1024**3;calls=[];samples=DiskSamples();samples._baseline(40*gib)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);images=root/'images.json'
            stage=SimpleNamespace(receipt={'token':'owned','tags':['backend','foundation','web','telegram','logto']},
                pass_fds=lambda:(77,),capture=lambda:None,iidfile=lambda role:root/(role+'.iid'))
            @contextmanager
            def guard(path,**kwargs):
                calls.append(('guard',kwargs))
                try:yield samples
                finally:samples._seal()
            @contextmanager
            def acquire(*args,**kwargs):
                calls.append(('acquire',args,kwargs));yield stage
            def command(argv,seconds,**kwargs):
                self.assertEqual(kwargs,{'pass_fds':(77,)})
                calls.append(('command',argv,seconds))
                if argv[1]=='build':Path(argv[argv.index('--iidfile')+1]).write_text('sha256:'+'b'*64)
            with ExitStack() as patches:
                for target,name,options in (
                    (prepare.hosted,'metadata_source',{'return_value':({'checkout_sha':'a'*40,'run_id':'1','run_attempt':'1'},{'ready':True})}),
                    (prepare.hosted.runtime.pilot.daemon,'identify',{'return_value':{'storage':str(root),'endpoint':'owned'}}),
                    (prepare.hosted.runtime.pilot,'FROZEN_DOCKER_ENDPOINT',{}),(prepare.hosted.runtime.pilot,'FROZEN_DOCKER_IDENTITY',{}),
                    (prepare.hosted.runtime.pilot.shutil,'disk_usage',{'return_value':SimpleNamespace(free=40*gib)}),
                    (prepare.hosted.runtime.pilot,'disk_budget',{'side_effect':guard}),
                    (prepare.preparation,'acquire',{'side_effect':acquire}),(prepare.hosted,'command',{'side_effect':command})):
                    patches.enter_context(patch.object(target,name,**options))
                patches.enter_context(patch.object(prepare.sys,'platform','linux'))
                prepare.prepare(root,images,'technical-consumer',scope='technical')
            value=json.loads(images.read_text());self.assertEqual(value['scope'],'technical');self.assertEqual(value['source'],'a'*40)
            acquired=next(row for row in calls if row[0]=='acquire')
            self.assertEqual(acquired[1][-1],'technical-consumer');self.assertEqual(acquired[2],{'web':True,'applications':True})
            self.assertEqual([row for row in calls if row[0]=='guard'],[('guard',{'growth_bytes':16*gib,'observe_samples':True})])
            commands=[row for row in calls if row[0]=='command'];builds=[row for row in commands if row[1][1]=='build'];pulls=[row for row in commands if row[1][1]=='pull']
            self.assertEqual(len(builds),5);self.assertEqual(len(pulls),9)
            self.assertEqual({row[1][-1] for row in pulls},set(prepare.preload_inventory(scope='technical')))
            self.assertTrue(all(row[2]==90 for row in pulls));self.assertFalse(any('--platform' in row[1] for row in pulls))
