"""Closed resource alternatives at actual plan, owned inspect and publication boundaries."""
import copy
import hashlib
import importlib.util
import os
import signal
from types import SimpleNamespace
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import lifecycle
from evidence import read as evidence_read

BASELINE='signoz-native-4096m-v1'
CANDIDATE='signoz-native-mcp512-4480m-under8g-v1'

def owned_fixture(root,profile_id):
    lock=lifecycle.verify_packet(profile_id)
    proofs=lifecycle.image_proof.load(lifecycle.CONFIG/'oci',lock)
    plan=lifecycle.make_plan(root,lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001,profile_id=profile_id)
    class Native:
        image_proofs=proofs
        values={}
        def inspect(self,kind,identity):return copy.deepcopy(self.values[identity])
    native=Native();own=lifecycle.Owned(native,root,{},plan['name'],'b'*32,profile_id=profile_id);own.plan=plan
    own.volumes={row['name']:{} for row in plan['volumes'].values()}
    for index,(role,spec) in enumerate(plan['services'].items()):
        pin=next(r for r in lock['images'] if r['repository'].split('/')[-1]==lifecycle.ROLE_IMAGES[role]);proof=proofs[pin['pinned']]
        cid=format(index+1,'064x');own.containers[role]=cid;own.created[role]='created-'+role
        own.images[role]={'reference':pin['pinned'],'runtime_reference':proof.runtime_reference,
            'config_digest':proof.config_digest,'relation':'config_id','image_descriptor_available':False,'container_descriptor_available':False,
            'architecture':'amd64','child_manifest':pin['linux_amd64_manifest'],'image_id':proof.config_digest,
            'selected_image_id':proof.config_digest,'entrypoint':[]}
        memory=int(spec['mem_limit'][:-1])*1024**2
        value={'Id':cid,'Created':own.created[role],'Image':proof.config_digest,
            'Config':{'Image':spec['image'],'User':spec['user'],'Entrypoint':spec.get('entrypoint',[]),
                'Cmd':spec['command'],'Env':[k+'='+v for k,v in spec.get('environment',{}).items()],'Labels':spec['labels']},
            'HostConfig':{'Memory':memory,'MemorySwap':memory,'NanoCpus':round(spec['cpus']*10**9),'PidsLimit':128,
                'ReadonlyRootfs':True,'Privileged':False,'PortBindings':None,'Binds':None,'CapDrop':['ALL'],
                'CapAdd':spec.get('cap_add'),'SecurityOpt':['no-new-privileges:true'],'RestartPolicy':{'Name':'no'},'LogConfig':{'Type':'none'},
                'NetworkMode':'none' if role=='agent' else plan['name']+'_backend','PidMode':'','UTSMode':''},
            'NetworkSettings':{'Networks':{} if role=='agent' else {plan['name']+'_backend':{}}},'Mounts':[]}
        for mount in spec.get('volumes',[]):
            value['Mounts'].append({'Destination':mount['target'],'Type':mount['type'],'RW':not mount['read_only'],
                                   **({'Source':mount['source']} if mount['type']=='bind' else {'Name':plan['volumes'][mount['source']]['name']})})
        native.values[cid]=value
    return own,native


def attach_profile(root,source,profile_id):
    own,native=owned_fixture(root,profile_id)
    lifecycle.private_json(root/'compose.json',own.plan)
    lifecycle.private_json(root/'owner.json',{'profile_id':profile_id,'source_sha':source['commit'],'source_tree':source['tree'],'plan_sha256':lifecycle.digest(root/'compose.json')})
    for role in lifecycle.SERVICES:own.validate(role)
    own.record_profile(source,inspection_stage='final')
    return own



class Profiles(unittest.TestCase):
    def test_named_trial_changes_only_mcp_memory_and_swap_while_baseline_stays_exact(self):
        lock=lifecycle.verify_packet()
        plans={name:lifecycle.make_plan(Path('/owned'),lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001,profile_id=name)
               for name in (BASELINE,CANDIDATE)}
        default=lifecycle.make_plan(Path('/owned'),lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001)
        self.assertEqual(default,plans[BASELINE])
        # Literal digest independently captured from the immutable e89 baseline plan.
        original=copy.deepcopy(default);original.pop('x-inside-resource-profile')
        for kind in ('services','volumes','networks'):
            for row in original[kind].values():row['labels'].pop('inside.monitoring.profile',None)
        self.assertEqual(hashlib.sha256(json.dumps(original,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                         '3b31d9618524ccaeb06bbe18ec40175ee6ea3d16aed08426b1f0fdb26611ae41')
        with patch.object(lifecycle,'MEM_LIMIT',8192*1024**2):
            with self.assertRaisesRegex(lifecycle.Refusal,'aggregate_memory'):lifecycle.verify_packet(BASELINE)

        for name,total,ceiling,mcp in ((BASELINE,4096,4096,128),(CANDIDATE,4480,8192,512)):
            profile=lifecycle.resource_profile(name);plan=plans[name]
            self.assertEqual(profile['aggregate_memory_bytes'],total*1024**2)
            self.assertEqual(profile['experimental_ceiling_bytes'],ceiling*1024**2)
            self.assertEqual(sum(int(s['mem_limit'][:-1]) for s in plan['services'].values()),total)
            self.assertEqual(plan['services']['mcp']['mem_limit'],str(mcp)+'m')
            self.assertEqual(plan['services']['mcp']['memswap_limit'],str(mcp)+'m')
            self.assertAlmostEqual(sum(s['cpus'] for s in plan['services'].values()),2)
            self.assertEqual((len(plan['services']),len(plan['volumes']),len(plan['networks'])),(11,7,1))
            self.assertEqual(plan['services']['mcp']['environment']['SIGNOZ_DOCS_REFRESH_INTERVAL'],'0')
            self.assertEqual(plan['services']['mcp']['environment']['SIGNOZ_DOCS_FULL_REFRESH_INTERVAL'],'0')
            for role,spec in plan['services'].items():
                self.assertEqual(spec['pids_limit'],128);self.assertEqual(spec['mem_limit'],spec['memswap_limit'])
                other=copy.deepcopy(plans[BASELINE]['services'][role]);actual=copy.deepcopy(spec)
                for row in (other,actual):row['labels'].pop('inside.monitoring.profile',None)
                if role=='mcp':actual['mem_limit']=other['mem_limit'];actual['memswap_limit']=other['memswap_limit']
                self.assertEqual(actual,other)
        self.assertEqual(sum(row[1] for row in lifecycle.BUDGETS.values()),4096)
        for invalid in (None,{},[],True,'8192','mcp1024','private-token'):
            with self.assertRaises(lifecycle.Refusal):lifecycle.resource_profile(invalid)
        with self.assertRaises(TypeError):lifecycle.resource_profile(CANDIDATE)['budgets']['mcp']=(.075,1024)

    def test_actual_owned_inspection_rejects_mixed_profiles_and_quota_mutations(self):
        for profile_id,mcp in ((BASELINE,128),(CANDIDATE,512)):
            with self.subTest(profile=profile_id),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);own,native=owned_fixture(root,profile_id)
                for role in lifecycle.SERVICES:own.validate(role)
                source={'commit':'a'*40,'tree':'b'*40,'profile_id':profile_id}
                own.record_profile(source);own.record()
                self.assertEqual(evidence_read(root/'resources.json')['profile_id'],profile_id)
                receipt=json.loads((root/'resource-profile.json').read_text())
                self.assertEqual(receipt['roles']['mcp']['memory_bytes'],mcp*1024**2)
                self.assertEqual(receipt['roles']['mcp']['memory_swap_bytes'],mcp*1024**2)
                for role,key,value in [('mcp','Memory',(512 if mcp==128 else 128)*1024**2),
                        ('mcp','MemorySwap',(mcp+1)*1024**2),('mcp','NanoCpus',100000000),
                        ('disk','Memory',128*1024**2),('server','PidsLimit',129)]:
                    row=native.values[own.containers[role]]['HostConfig'];saved=row[key];row[key]=value
                    with self.assertRaises(lifecycle.Refusal):own.validate(role)
                    row[key]=saved
                with self.assertRaises(lifecycle.Refusal):own.record_profile({**source,'profile_id':CANDIDATE if profile_id==BASELINE else BASELINE})
                own.plan['x-inside-resource-profile']=CANDIDATE if profile_id==BASELINE else BASELINE
                with self.assertRaises(lifecycle.Refusal):own.validate('mcp')

    def runtime(self):
        spec=importlib.util.spec_from_file_location('signoz_profile_runtime',Path(__file__).parent/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime);return runtime

    def test_source_owner_plan_mismatch_refuses_worker_and_recovery_before_native(self):
        runtime=self.runtime()
        for mode in ('worker','recover'):
            for broken in ('owner','source','plan','owner_source'):
                with self.subTest(mode=mode,broken=broken),tempfile.TemporaryDirectory() as directory:
                    root=Path(directory).resolve();source={'profile_id':CANDIDATE,'commit':'a'*40,'tree':'b'*40}
                    own=attach_profile(root,source,CANDIDATE)
                    lifecycle.private_json(root/'source.json',source)
                    if broken=='plan':
                        plan=copy.deepcopy(own.plan);plan['x-inside-resource-profile']=BASELINE;lifecycle.private_json(root/'compose.json',plan)
                    owner={'source_sha':'f'*40 if broken=='owner_source' else 'a'*40,'source_tree':'b'*40,
                           'profile_id':BASELINE if broken=='owner' else CANDIDATE,'cwd':str(runtime.ROOT),'daemon':{},
                           'project':own.project,'nonce':own.nonce,'plan_sha256':lifecycle.digest(root/'compose.json')}
                    if broken=='source':source['profile_id']=BASELINE;lifecycle.private_json(root/'source.json',source)
                    lifecycle.private_json(root/'owner.json',owner)
                    with patch.object(runtime,'require_native_host'),patch.object(runtime,'verify_source'),patch.object(runtime,'engine') as native:
                        with self.assertRaises((ValueError,lifecycle.Refusal)):
                            getattr(runtime,mode)(root,**{'profile_id':CANDIDATE})
                        native.assert_not_called()

    def test_external_supervisor_success_timeout_cancel_and_early_failure_keep_selected_profile(self):
        runtime=self.runtime()
        class Process:
            pid=999999
            def wait(self,timeout):return 0
        for outcome in ('success','timeout','cancel','early'):
            with self.subTest(outcome=outcome),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve()/'private';seen=[]
                def cleanup(path,deadline,*,profile_id):
                    seen.append(profile_id);return {'passed':True,'roles_healthy':True}
                def wait(process,deadline,cancelled):
                    if outcome=='cancel':signal.getsignal(signal.SIGTERM)(None,None);self.assertTrue(cancelled())
                    return 0 if outcome=='success' else 124
                with patch.object(runtime,'require_native_host'),\
                     patch.object(runtime,'source',return_value={'commit':'a'*40,'tree':'b'*40,'profile_id':CANDIDATE}),\
                     patch.object(runtime,'engine',side_effect=ValueError('controlled_native_refusal') if outcome=='early' else None,return_value=SimpleNamespace(identity={})),\
                     patch.object(lifecycle,'write_private_files'),patch.object(runtime.subprocess,'Popen',return_value=Process()) as spawned,\
                     patch.object(runtime,'process_start',return_value='owned-birth'),patch.object(runtime,'stop_worker'),\
                     patch.object(runtime.supervisor,'wait',side_effect=wait),patch.object(runtime,'recover',side_effect=cleanup):
                    if outcome=='early':
                        with self.assertRaisesRegex(ValueError,'controlled_native_refusal'):runtime.run(output,CANDIDATE)
                    else:
                        self.assertEqual(runtime.run(output,CANDIDATE),0 if outcome=='success' else 1)
                        self.assertEqual(evidence_read(output/'owner.json')['profile_id'],CANDIDATE)
                        args=spawned.call_args.args[0];self.assertEqual(args[-2:],['--profile',CANDIDATE])
                    self.assertEqual(seen,[CANDIDATE])
                    saved=evidence_read(output/'outcome.json')
                    self.assertEqual(saved['profile_id'],CANDIDATE)
                    self.assertEqual(saved['passed'],outcome=='success')

    def test_workflow_selects_same_closed_candidate_for_run_recover_and_collect(self):
        workflow=(lifecycle.ROOT/'.github/workflows/observability-signoz.yml').read_text()
        self.assertEqual(workflow.count('--profile '+CANDIDATE),3)
        self.assertIn('MCP512 4480MiB under 8GiB',workflow)
        self.assertIn('name: signoz-functional-mcp512-4480m-under8g-',workflow)
        runtime=self.runtime()
        with patch.object(runtime.sys,'argv',['runtime.py','run','--output','/unused','--profile','mcp1024']),\
             patch.object(runtime,'require_native_host') as native,patch.object(runtime,'source') as source:
            with self.assertRaises(SystemExit) as caught:runtime.main()
            self.assertEqual(caught.exception.code,2);native.assert_not_called();source.assert_not_called()

if __name__=='__main__':unittest.main()
