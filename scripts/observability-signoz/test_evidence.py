"""Publication boundary: private provider failures and arbitrary JSON never escape."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import evidence
import lifecycle
from test_profiles import attach_profile


class Publication(unittest.TestCase):
    def test_closed_bootstrap_substages_survive_the_actual_collector(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            engine=source/'engine-1-12345678';engine.mkdir(mode=0o700)
            for stage in ('bootstrap_key','bootstrap_identity','bootstrap_roles','bootstrap_fixed_read',
                'bootstrap_read_response','bootstrap_read_deadline','bootstrap_read_decode','bootstrap_read_object',
                'bootstrap_read_envelope','bootstrap_read_type','bootstrap_read_warning','bootstrap_read_results',
                'bootstrap_read_query','bootstrap_read_columns','bootstrap_read_rows','bootstrap_read_number',
                'bootstrap_read_number_range','bootstrap_read_count_nonzero'):
                with self.subTest(stage=stage):
                    row={'inside_failed':1,'stage':stage,'category':'ControlFailure','http_status':200,'transport':'reader_identity'}
                    lifecycle.private_json(engine/'inside-failure.json',row)
                    target=root/stage;self.assertFalse(evidence.collect(source,target,lambda _value:None))
                    report=json.loads((target/'witness.json').read_text())
                    self.assertEqual(report['inside_failures'],{'available':True,'samples':[{k:v for k,v in row.items() if k!='inside_failed'}]})
                    self.assertFalse(report['passed'])

    def test_MCP_first_refusal_stages_have_only_the_same_closed_five_field_projection(self):
        import control
        expected={'mcp_wire_admission','mcp_wire_request','mcp_wire_headers','mcp_wire_read','mcp_wire_status','mcp_wire_size',
            'mcp_wire_deadline','mcp_wire_decode','mcp_wire_close','mcp_rpc_object','mcp_rpc_version','mcp_rpc_id',
            'mcp_rpc_error','mcp_rpc_result','mcp_rpc_is_error','mcp_initialize_version','mcp_inventory_cursor',
            'mcp_inventory_tools','mcp_inventory_count','mcp_inventory_query_tool'}
        self.assertEqual(control.MCP_READ_STAGES,expected)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=root/'engine-1-12345678';engine.mkdir(mode=0o700)
            for stage in sorted(expected):
                with self.subTest(stage=stage):
                    row={'inside_failed':1,'stage':stage,'category':'ControlFailure','http_status':200,'transport':'mcp_http'}
                    lifecycle.private_json(engine/'inside-failure.json',row)
                    self.assertEqual(evidence.inside_failures(root),{'available':True,'samples':[{k:v for k,v in row.items() if k!='inside_failed'}]})

    def test_malformed_inside_failure_schema_is_not_a_valid_public_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            engine=source/'engine-1-12345678';engine.mkdir(mode=0o700)
            good={'inside_failed':1,'stage':'bootstrap_identity','category':'ControlFailure','http_status':200,'transport':'reader_identity'}
            for index,row in enumerate(({**good,'raw':'private-key-must-not-escape'},{**good,'inside_failed':True},{k:v for k,v in good.items() if k!='transport'})):
                with self.subTest(index=index):
                    lifecycle.private_json(engine/'inside-failure.json',row)
                    target=root/str(index);self.assertFalse(evidence.collect(source,target,lambda _value:None))
                    report=json.loads((target/'witness.json').read_text())
                    self.assertFalse(report['inside_failures']['available'])
                    self.assertNotIn('private-key',json.dumps(report))

    def test_unknown_or_unhashable_inside_values_never_leak_or_create_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            engine=source/'engine-1-12345678';engine.mkdir(mode=0o700)
            good={'inside_failed':1,'stage':'bootstrap_identity','category':'ControlFailure','http_status':200,'transport':'reader_identity'}
            values=(None,[],{'private':'private-key'},True,5,'private-key','private-key'*1000,float('nan'),float('inf'))
            for index,value in enumerate(values):
                with self.subTest(index=index):
                    row={**good,'stage':value,'category':value,'transport':value}
                    path=engine/'inside-failure.json';path.write_text(json.dumps(row));path.chmod(0o600)
                    target=root/str(index);self.assertFalse(evidence.collect(source,target,lambda _value:None))
                    report=json.loads((target/'witness.json').read_text())
                    self.assertEqual(report['inside_failures']['samples'],[{'stage':'unavailable','category':'unavailable','http_status':200,'transport':'unavailable'}])
                    self.assertNotIn('private-key',json.dumps(report));self.assertFalse(report['passed'])
            for index,status in enumerate((True,-1,600,1.5,float('nan'),float('inf'),'private-key',None)):
                path=engine/'inside-failure.json';path.write_text(json.dumps({**good,'http_status':status}));path.chmod(0o600)
                target=root/('status-'+str(index));self.assertFalse(evidence.collect(source,target,lambda _value:None))
                report=json.loads((target/'witness.json').read_text())
                self.assertFalse(report['inside_failures']['available']);self.assertNotIn('private-key',json.dumps(report))

    def test_first_inner_command_is_closed_and_malformed_context_stays_unavailable(self):
        good={'command_class':'disk_exec','timeout_seconds':3,'elapsed_seconds':3.01,'native_exit':None,'alive_before_reap':True}
        variants=[None,{},[],{**good,'secret':'private-key-URL'},
                  {**good,'command_class':'private-key-URL'},{**good,'command_class':'x'*2000},
                  {**good,'timeout_seconds':True},{**good,'timeout_seconds':0},{**good,'timeout_seconds':691},
                  {**good,'elapsed_seconds':-1},{**good,'elapsed_seconds':float('nan')},
                  {**good,'elapsed_seconds':float('inf')},{**good,'elapsed_seconds':691},
                  {**good,'native_exit':True},{**good,'native_exit':1.5},{**good,'native_exit':256},
                  {**good,'alive_before_reap':1},{**good,'native_exit':0}]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            for index,context in enumerate([good,*variants]):
                # Malformed floats are deliberately written as untrusted input;
                # collect either refuses the file or publishes unavailable context.
                record={'monitor_failed':True,'failure':[{'stage':'vm_sample','reason':'command_deadline','inner_command':context}],
                        'monitor_reaped':True,'finalization_stage':'complete'}
                path=source/'disk-last.json';path.write_text(json.dumps(record));path.chmod(0o600)
                public=root/str(index);self.assertFalse(evidence.collect(source,public,lambda _value:None))
                result=json.loads((public/'witness.json').read_text());self.assertFalse(result['passed'])
                monitor=result['storage_monitor']
                if index==0:self.assertEqual(monitor['first_inner_command'],{'available':True,**good})
                else:self.assertFalse(monitor.get('first_inner_command',{'available':False})['available'])
                self.assertNotIn('private-key-URL',json.dumps(result))
            record['monitor_failed']=False;record['failure']=[]
            lifecycle.private_json(path,record)
            self.assertEqual(evidence.storage_monitor(record)['first_inner_command'],{'available':False})

    def test_disk_stage_projection_preserves_legacy_unknown_and_hides_invalid_private_values(self):
        original={'command_class':'disk_exec','timeout_seconds':3,'elapsed_seconds':3.01,'native_exit':None,'alive_before_reap':True}
        self.assertEqual(evidence.inner_command(original),{'available':True,**original})
        for stage in ('entered','imports_complete','syscalls_complete','unknown'):
            self.assertEqual(evidence.inner_command({**original,'disk_helper_stage':stage}),
                             {'available':True,**original,'disk_helper_stage':stage})
        for stage in ('not_entered','private-key-email-URL',[],{},None,True,5,float('nan'),'x'*2000):
            public=evidence.inner_command({**original,'disk_helper_stage':stage})
            self.assertEqual(public,{'available':True,**original,'disk_helper_stage':'unknown'})
            self.assertNotIn('private-',json.dumps(public))
        self.assertEqual(evidence.inner_command({**original,'command_class':'daemon_info','disk_helper_stage':'entered'}),{'available':False})
        self.assertEqual(evidence.inner_command({**original,'disk_helper_stage':'entered','private-key':'secret'}),{'available':False})

    def test_complete_closed_functional_receipt_remains_explicitly_not_capacity(self):
        for profile_id in (lifecycle.BASELINE_PROFILE,lifecycle.MCP512_PROFILE):
            with self.subTest(profile=profile_id):self.complete_profile(profile_id)

    def complete_profile(self,profile_id):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            lock=lifecycle.verify_packet();pins={r['repository'].split('/')[-1]:r for r in lock['images']}
            images={}
            for role,name in lifecycle.ROLE_IMAGES.items():
                row=pins[name];config=lock['image_config_metadata'][row['repository']]['amd64']['config_digest']
                images[role]={'reference':row['pinned'],'runtime_reference':lifecycle.image_proof.runtime_reference(row),
                    'config_digest':config,'relation':'config_id','image_descriptor_available':False,'container_descriptor_available':False,
                    'architecture':'amd64','child_manifest':row['linux_amd64_manifest'],'image_id':config,'selected_image_id':config}
            records={'source':{'commit':'a'*40,'tree':'b'*40,'profile_id':profile_id},'images':images,
                'outcome':{'profile_id':profile_id,'passed':True,'worker_exit':0,'worker_seconds':30,'runtime_limit_seconds':600,'cleanup':{'passed':True},'full_workload':False,'capacity_acceptance':False},
                'cleanup':{'passed':True,'failed_operations':[],'exact_containers':11,'exact_volumes':7,'exact_networks':1},
                'functional':{**{k:1 for k in evidence.FACTS},'query_seconds':.2,'empty_fixture_span_count':0,'full_workload_acceptance':0,'capacity_acceptance':0},
                'postgres':{'available':True,'counts':{'applied_migrations':1,'migration_lock_rows':1}},
                'states':{r:{'running':r not in ('volume-init','histogram-init','migrator'),'oom_killed':False,'exit_code':0,'restart_count':0} for r in lifecycle.SERVICES},
                'isolation':{'schema':1,'network_mode':'none','namespace_inode':111,'host_namespace_inode':112,'backend_namespace_inode':113,
                    'socket_identity':{'device':12,'inode':34,'uid':1001,'gid':1001,'mode':0o600,'links':1}},
                'agent':{'schema':1,'nonce':'a'*32,'reads':4,'gateway_denials':9,'backend_denials':10,'filesystem_isolated':1,'namespace_inode':111,
                    'socket_inode':34,'socket_device':12,'dns_noname':0,'dns_unavailable':1,'dns_resolved':0},
                'disk-admission':{'host':{'filesystems':{'123':{'total_bytes':100000000000,'free_bytes':90000000000}}},
                    'vm':{'fsid':1,'device':2,'block':4096,'blocks':10000000,'available':9000000,'files':0,'free_files':0}}}
            for name,value in records.items():lifecycle.private_json(source/(name+'.json'),value)
            attach_profile(source,records['source'],profile_id)
            engine=source/'engine-1-12345678';engine.mkdir(mode=0o700)
            lifecycle.private_json(engine/'identity.json',{k:'sha256:'+'a'*64 for k in ('cli_sha256','compose_sha256','daemon_sha256','endpoint_sha256')})
            def verified(value):self.assertEqual(value,records['source'])
            public=root/'public';self.assertTrue(evidence.collect(source,public,verified,profile_id=profile_id))
            result=json.loads((public/'witness.json').read_text())
            self.assertTrue(result['passed']);self.assertTrue(result['functional_only']);self.assertFalse(result['capacity_acceptance'])
            self.assertEqual(result['profile_id'],profile_id)
            self.assertEqual(result['aggregate_memory_bytes'],(4096 if profile_id==lifecycle.BASELINE_PROFILE else 4480)*1024**2)
            self.assertEqual(result['experimental_ceiling_memory_bytes'],(4096 if profile_id==lifecycle.BASELINE_PROFILE else 8192)*1024**2)
            self.assertTrue(result['resource_profile']['available'])
            bad_states=[{}, {k:v for k,v in records['states'].items() if k!='server'}]
            for field,value in [('running',False),('oom_killed',True),('restart_count',1),('exit_code',1)]:
                bad_states.append({**records['states'],'server':{**records['states']['server'],field:value}})
            for index,bad in enumerate(bad_states):
                lifecycle.private_json(source/'states.json',bad)
                self.assertFalse(evidence.collect(source,root/('bad-'+str(index)),verified,profile_id=profile_id))
            lifecycle.private_json(source/'states.json',records['states'])
            for index,(name,bad) in enumerate([
                ('agent',{**records['agent'],'namespace_inode':999}),
                ('agent',{**records['agent'],'socket_inode':999}),
                ('agent',{**records['agent'],'backend_denials':0}),
                ('isolation',{**records['isolation'],'network_mode':'bridge'}),
                ('isolation',{**records['isolation'],'namespace_inode':112}),
                ('cleanup',{**records['cleanup'],'exact_volumes':6}),
                ('outcome',{**records['outcome'],'worker_exit':1})]):
                lifecycle.private_json(source/(name+'.json'),bad)
                self.assertFalse(evidence.collect(source,root/('cross-'+str(index)),verified,profile_id=profile_id))
                lifecycle.private_json(source/(name+'.json'),records[name])
            for index,fields in enumerate([
                {'runtime_reference':pins['python']['pinned']}, {'image_id':pins['python']['index_digest']},
                {'config_digest':'sha256:'+'f'*64}, {'relation':'unknown'}, {'image_descriptor_available':None}, {'container_descriptor_available':None},
                {'relation':'child_id','image_id':pins['python']['linux_amd64_manifest'],
                 'selected_image_id':pins['python']['linux_amd64_manifest'],'image_descriptor_available':True,'container_descriptor_available':False}]):
                lifecycle.private_json(source/'images.json',{**records['images'],'disk':{**records['images']['disk'],**fields}})
                self.assertFalse(evidence.collect(source,root/('image-'+str(index)),verified,profile_id=profile_id))
            lifecycle.private_json(source/'images.json',records['images'])
            # Every original positive fact is still present. A forged green outcome
            # cannot compensate for mixed source/profile or actual inspection limits.
            observed=evidence.read(source/'resource-profile.json')
            wrong=lifecycle.MCP512_PROFILE if profile_id==lifecycle.BASELINE_PROFILE else lifecycle.BASELINE_PROFILE
            bads=[{**observed,'profile_id':wrong},{**observed,'source_sha':'f'*40},
                  {**observed,'source_tree':'f'*40},{**observed,'schema':True},{**observed,'inspection_stage':'private-token'},{**observed,'raw':'private-token'}]
            for role,key,value in [('mcp','memory_bytes',128*1024**2 if profile_id==lifecycle.MCP512_PROFILE else 512*1024**2),
                    ('mcp','memory_swap_bytes',1024*1024**2),('mcp','nano_cpus',100000000),
                    ('server','memory_bytes',128*1024**2),('agent','pids_limit',129),('disk','memory_bytes',float('nan'))]:
                bad=copy.deepcopy(observed);bad['roles'][role][key]=value;bads.append(bad)
            bads.append({**observed,'roles':{k:v for k,v in observed['roles'].items() if k!='agent'}})
            for index,bad in enumerate(bads):
                path=source/'resource-profile.json';path.write_text(json.dumps(bad));path.chmod(0o600)
                target=root/('profile-'+str(index))
                self.assertFalse(evidence.collect(source,target,verified,profile_id=profile_id))
                self.assertFalse(json.loads((target/'witness.json').read_text())['resource_profile']['available'])
            lifecycle.private_json(source/'resource-profile.json',{**observed,'inspection_stage':'admission'})
            self.assertFalse(evidence.collect(source,root/'admission-only',verified,profile_id=profile_id))
            admission=json.loads((root/'admission-only/witness.json').read_text())
            self.assertTrue(admission['resource_profile']['available'])
            self.assertEqual(admission['resource_profile']['inspection_stage'],'admission')
            lifecycle.private_json(source/'resource-profile.json',observed)
            owner=evidence.read(source/'owner.json');plan=evidence.read(source/'compose.json')
            cases=[('owner',{**owner,'profile_id':wrong}),('source',{**records['source'],'profile_id':wrong}),
                   ('compose',{**plan,'x-inside-resource-profile':wrong}),
                   ('outcome',{**records['outcome'],'profile_id':wrong}),
                   ('outcome',{**records['outcome'],'capacity_acceptance':True}),
                   ('functional',{**records['functional'],'native_mcp':0})]
            for index,(name,value) in enumerate(cases):
                path=source/(name+'.json');original=evidence.read(path);lifecycle.private_json(path,value)
                self.assertFalse(evidence.collect(source,root/('mixed-'+str(index)),verified,profile_id=profile_id))
                lifecycle.private_json(path,original)
            for index,(kind,role) in enumerate((('services','mcp'),('volumes','probe'),('networks','backend'))):
                mixed=copy.deepcopy(plan);mixed[kind][role]['labels']['inside.monitoring.profile']=wrong
                lifecycle.private_json(source/'compose.json',mixed)
                lifecycle.private_json(source/'owner.json',{**owner,'plan_sha256':lifecycle.digest(source/'compose.json')})
                self.assertFalse(evidence.collect(source,root/('label-'+str(index)),verified,profile_id=profile_id))
            lifecycle.private_json(source/'compose.json',plan);lifecycle.private_json(source/'owner.json',owner)
            self.assertTrue(evidence.collect(source,root/'restored',verified,profile_id=profile_id))

    def test_early_failure_still_produces_closed_unavailable_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'absent'
            public = Path(tmp) / 'public'
            self.assertFalse(evidence.collect(source, public, lambda _v: None))
            result = json.loads((public / 'witness.json').read_text())
            self.assertFalse(result['passed'])
            self.assertFalse(result['functional']['available'])
            self.assertNotIn('counts', result['postgres'])

    def test_untrusted_fields_and_symlinks_are_never_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'private'; source.mkdir(mode=0o700)
            secret = 'private-key-email-DSN-query-must-never-escape'
            lifecycle.private_json(source / 'functional.json', {'bootstrap': 1, 'query_seconds': secret})
            lifecycle.private_json(source / 'failure.json', {'phase': 'functional', 'category': secret, 'reason': secret})
            lifecycle.private_json(source / 'states.json', {'server': {'running': True, 'oom_killed': False, 'exit_code': 0, 'restart_count': 0, 'raw_log': secret}})
            (source / 'outcome.json').symlink_to(source / 'failure.json')
            (source / 'secret.private').write_text(secret)
            public = root / 'public'
            self.assertFalse(evidence.collect(source, public, lambda _v: (_ for _ in ()).throw(ValueError())))
            encoded = ''.join(path.read_text() for path in public.iterdir())
            self.assertNotIn(secret, encoded)
            self.assertEqual({p.name for p in public.iterdir()}, {'witness.json'})


if __name__ == '__main__': unittest.main()
