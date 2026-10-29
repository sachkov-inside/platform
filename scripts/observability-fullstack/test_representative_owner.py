"""SOURCE-MODEL ownership using the real fixture producer; no Docker acquisition."""
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

import fullstack
from test_cpu_control import assemble, pins, SOURCE
import representative_owner as owners

BINDINGS={'source':{'commit':SOURCE,'tree':SOURCE},'project':'inside-observability-representative-'+'1'*12,
          'nonce':'2'*32,'uid':os.getuid(),'gid':os.getgid()}


class Engine:
    def __init__(self):
        self.identity={'daemon_id':'source-model-daemon','endpoint':'source-model'}
        self.deadline=time.monotonic()+600
        self.calls=[]
    def identify(self):return dict(self.identity)
    def call(self,args,timeout=10):
        self.calls.append(args)
        raise AssertionError('unexpected native operation')


class RepresentativeOwner(unittest.TestCase):
    def test_prepare_uses_actual_fixture_and_constructor_without_native_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'owner',control=False)
            engine=Engine()
            owner=owners.CompositeOwner.prepare(engine,output,BINDINGS,pins())
            state=owner.snapshot()
            self.assertEqual((len(state['roles']),len(state['volumes']),len(state['networks'])),(38,11,10))
            self.assertEqual(state['supervisor'],{'count':1,'deadline_seconds':600,'cleanup_seconds':90})
            self.assertEqual(engine.calls,[])
            receipt=json.loads((output/'representative-owner/resources.json').read_text())
            self.assertEqual(receipt['status'],'prepared')
            self.assertEqual(receipt['containers'],{})
            self.assertEqual(json.loads((output/'compose.json').read_text()),primary)
            primary['services']['mcp']['command']=['foreign']
            (output/'compose.json').write_text(json.dumps(primary))
            with self.assertRaises(ValueError):owner.snapshot()


# Adapter at the Docker boundary only. These inspect examples are SOURCE-MODEL,
# not claims about Linux Engine defaults. Canonical production constructors are real.
import copy
import hashlib
from unittest.mock import patch


class Native(Engine):
    def __init__(self,plan):
        super().__init__();self.plan=plan;self.objects={};self.acquired=set();self.fail_create=False;self.fail_rm=None
        life=fullstack.core_layout.signoz_lifecycle()
        proofs=life.image_proof.load(life.CONFIG/'oci',life.verify_packet())
        self.proofs={p.runtime_reference:p for p in proofs.values()}
        for ref in {v['image'] for v in plan['services'].values()}:
            proof=self.proofs.get(ref)
            if proof:
                self.objects[ref]={'Id':proof.config_digest,'Os':'linux','Architecture':'amd64','Config':copy.deepcopy(proof.config),
                    'RootFS':{'Type':'layers','Layers':list(proof.diff_ids)},'RepoDigests':[ref],'Descriptor':proof.descriptor}
            else:self.objects[ref]={'Id':ref if ref.startswith('sha256:') else 'sha256:'+hashlib.sha256(ref.encode()).hexdigest(),
                'Os':'linux','Architecture':'amd64','Config':{'User':'image-user','WorkingDir':'/image','Cmd':['image-command'],
                'Entrypoint':['image-entry'],'Env':['IMAGE_DEFAULT=yes']},'RepoDigests':[ref]}
        for index,(name,spec) in enumerate(plan['volumes'].items()):
            self.objects[spec['name']]={'Name':spec['name'],'CreatedAt':'volume-birth-'+str(index),'Mountpoint':'/model/volumes/'+name,
                'Driver':'local','Options':None,'Labels':spec['labels']}
        for index,(name,spec) in enumerate(plan['networks'].items()):
            identity=format(1000+index,'064x')
            self.objects[identity]={'Id':identity,'Name':spec['name'],'Created':'network-birth-'+str(index),'Driver':'bridge',
                'Internal':spec.get('internal',False),'EnableIPv6':False,'Attachable':False,'Ingress':False,'Options':{},
                'IPAM':{'Driver':'default','Options':None,'Config':[{'Subnet':'172.30.'+str(index)+'.0/24'}]},'Labels':spec['labels'],'Containers':{}}
        for index,(role,spec) in enumerate(plan['services'].items()):
            cid=format(index+1,'064x');image=self.objects[spec['image']];default=image['Config']
            env={entry.split('=',1)[0]:entry.split('=',1)[1] for entry in default.get('Env',[])}
            for path in spec.get('env_file',[]):
                for line in Path(path).read_text().splitlines():
                    if line and not line.startswith('#'):
                        key,value=line.split('=',1);env[key]=value
            env.update(spec.get('environment',{}))
            memory=int(spec['mem_limit'][:-1])*(1024**3 if spec['mem_limit'].endswith('g') else 1024**2)
            host={'Memory':memory,'MemorySwap':memory*(1 if 'memswap_limit' in spec else 2),'NanoCpus':round(float(spec['cpus'])*10**9),
                'PidsLimit':spec['pids_limit'],'ReadonlyRootfs':spec.get('read_only',False),'Privileged':spec.get('privileged',False),
                'PidMode':'','IpcMode':'private','UTSMode':'','CgroupnsMode':'private','RestartPolicy':{'Name':spec.get('restart','no'),'MaximumRetryCount':0},
                'LogConfig':{'Type':spec['logging']['driver'],'Config':spec['logging'].get('options',{})},'Init':spec.get('init',False),
                'CapAdd':spec.get('cap_add'),'CapDrop':spec.get('cap_drop'),'SecurityOpt':spec.get('security_opt'),
                'Tmpfs':dict(entry.split(':',1) for entry in spec.get('tmpfs',[])),'Dns':spec.get('dns',[]),'PortBindings':{}}
            for entry in spec.get('ports',[]):
                address,external,internal=entry.split(':');host['PortBindings'][internal+'/tcp']=[{'HostIp':address,'HostPort':external}]
            attachments={};native_name=plan['name']+'-'+role+'-1'
            for name in spec.get('networks',[]):
                net=next(v for v in self.objects.values() if v.get('Name')==plan['networks'][name]['name'])
                options=spec['networks'][name] if type(spec['networks']) is dict else {}
                attachments[net['Name']]={'NetworkID':net['Id'],'Aliases':[native_name,role,*options.get('aliases',[])]}
            host['NetworkMode']='none' if spec.get('network_mode')=='none' else next(iter(attachments))
            mounts=[]
            for mount in spec.get('volumes',[]):
                if type(mount) is str:
                    source,target,*flags=mount.split(':');options=flags[0].split(',') if flags else []
                    mount={'type':'bind' if source.startswith('/') else 'volume','source':source,'target':target,'read_only':'ro' in options,
                        'propagation':'rslave' if 'rslave' in options else 'rprivate'}
                source=mount['source'];native={'Type':mount['type'],'Destination':mount['target'],'RW':not mount.get('read_only',False)}
                if mount['type']=='bind':native.update(Source=source,Propagation=mount.get('propagation','rprivate'))
                else:
                    real=plan['volumes'][source]['name'];native.update(Name=real,Source=self.objects[real]['Mountpoint'])
                mounts.append(native)
            self.objects[cid]={'Id':cid,'Created':'container-birth-'+str(index),'Image':image['Id'],'Name':'/'+native_name,
                'Config':{'StopSignal':spec.get('stop_signal',default.get('StopSignal','')),'Hostname':spec.get('hostname',cid[:12]),'Domainname':'','StopTimeout':int(spec['stop_grace_period'][:-1]) if 'stop_grace_period' in spec else None,
                    'Healthcheck':dict(default.get('Healthcheck') or {})|{
                        {'test':'Test','interval':'Interval','timeout':'Timeout','retries':'Retries','start_period':'StartPeriod'}[key]:
                        int(value[:-1])*10**9 if key in ('interval','timeout','start_period') else value
                        for key,value in spec.get('healthcheck',{}).items()},
                    'Image':spec['image'],'Labels':spec['labels'],'User':spec.get('user',default.get('User','')),
                    'WorkingDir':spec.get('working_dir',default.get('WorkingDir','')),'Cmd':spec.get('command',default.get('Cmd')),
                    'Entrypoint':spec.get('entrypoint',default.get('Entrypoint')),'Env':[key+'='+value for key,value in env.items()]},
                'HostConfig':host,'Mounts':mounts,'NetworkSettings':{'Networks':attachments},'RestartCount':0,
                'State':{'Running':False,'OOMKilled':False,'ExitCode':0,'Status':'created','Pid':0,'Paused':False,'Restarting':False,'Dead':False,'Error':''}}
            if spec['image'] in self.proofs:self.objects[cid]['ImageManifestDescriptor']=copy.deepcopy(self.proofs[spec['image']].descriptor)
    def inspect(self,kind,identity):return copy.deepcopy(self.objects[identity])
    def call(self,args,timeout=10):
        self.calls.append(list(args))
        if args[0]=='compose':
            self.acquired={k for k in self.objects if not k.startswith(('sha256:','docker.io/','grafana/','ghcr.io/')) and (len(k)==64 or k.startswith(self.plan['name']))}
            if self.fail_create:raise RuntimeError('first-create-failure')
            return ''
        if args[0]=='ps':return '\n'.join(k for k in self.acquired if 'Config' in self.objects[k])
        if len(args)>1 and args[1]=='ls':
            rows=[k for k in self.acquired if ('Mountpoint' in self.objects[k])==(args[0]=='volume') and 'Config' not in self.objects[k]]
            selectors=[a.removeprefix('name=^').removesuffix('$') for a in args if a.startswith('name=^')]
            return '\n'.join(k for k in rows if not selectors or self.objects[k]['Name']==selectors[0])
        if args[0]=='rm' or len(args)>1 and args[1]=='rm':
            target=args[-1]
            if target==self.fail_rm:raise RuntimeError('first-remove-failure')
            self.acquired.discard(target)
            for value in self.objects.values():
                if 'Containers' in value:value['Containers'].pop(target,None)
            return ''
        if args[0]=='start':
            for cid in args[1:]:
                self.objects[cid]['State'].update(Running=True,Status='running',Pid=12345)
                for entry in self.objects[cid]['NetworkSettings']['Networks'].values():
                    self.objects[entry['NetworkID']]['Containers'][cid]={'Name':self.objects[cid]['Name'][1:]}
            return ''
        raise AssertionError('unexpected native boundary '+args[0])


class NativeOwner(unittest.TestCase):
    def prepare(self,root):
        output,primary=assemble(root,'owner',control=False)
        layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,images=pins(),**BINDINGS)
        native=Native(layout.plan)
        # Explicit SOURCE-MODEL registration. No native process/session claim.
        path=output/'worker.json';path.write_text(json.dumps({'pid':999999,'group':999999,'start_ticks':'123456'}));path.chmod(0o600)
        return output,native,owners.CompositeOwner.prepare(native,output,BINDINGS,pins()),layout

    def test_actual_catalogue_admits_every_native_form_and_rejects_changed_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            self.assertEqual(len(json.loads((output/'representative-owner/resources.json').read_text())['containers']),38)
            for role in layout.plan['services']:owner.validate(role)
            for role,section,key,bad in [('api','HostConfig','LogConfig',{'Type':'none','Config':{}}),
                ('host-agent','HostConfig','Privileged',False),('sig-agent','HostConfig','NetworkMode','host'),
                ('sig-mcp','HostConfig','Memory',128*1024**2),('sig-volume-init','HostConfig','CapAdd',[]),
                ('web','Config','Env',['FOREIGN=yes']),('sig-server','Config','User','1001:1001')]:
                cid=next(k for k,v in native.objects.items() if v.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')==role)
                previous=native.objects[cid][section][key];native.objects[cid][section][key]=bad
                with self.subTest(role=role,key=key),self.assertRaises(ValueError):owner.validate(role)
                native.objects[cid][section][key]=previous
            owner.start('web');self.assertTrue(owner.validate('web')['State']['Running'])
            self.assertTrue(owner.cleanup_exact());self.assertEqual(native.acquired,set())

    def test_partial_create_durably_discovers_then_cleanup_continues_preserving_first_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());native.fail_create=True
            with self.assertRaisesRegex(RuntimeError,'first-create-failure'):owner.create()
            receipt=json.loads((output/'representative-owner/resources.json').read_text())
            self.assertEqual(receipt['status'],'acquiring');self.assertEqual(len(receipt['containers']),38)
            native.fail_rm=format(1,'064x')
            with self.assertRaisesRegex(RuntimeError,'first-remove-failure'):owner.cleanup_exact()
            self.assertEqual(native.acquired,{format(1,'064x')})
            self.assertTrue((output/'representative-owner/states.json').is_file())
            self.assertFalse(json.loads((output/'representative-owner/cleanup.json').read_text())['passed'])

    def test_recovery_and_replacement_refusal_preserve_foreign_resources_and_changed_env(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
            cid=next(k for k,v in native.objects.items() if v.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')=='sig-disk')
            native.objects[cid]['Created']='replacement'
            with self.assertRaisesRegex(ValueError,'replaced'):recovered.validate('sig-disk')
            with self.assertRaises(ValueError):recovered.cleanup_exact()
            self.assertIn(cid,native.acquired)
            env=output/'runtime/web.env';env.write_text(env.read_text()+'\nFOREIGN=value\n')
            with self.assertRaises(ValueError):owner.snapshot()

    def test_partial_discovery_registers_each_identity_before_next_inspection_failure(self):
        for limit in (1,7,38,39,49):
            with self.subTest(limit=limit),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());native.fail_create=True
                original=native.inspect;count=[0]
                def inspect(kind,identity):
                    if kind!='image':
                        count[0]+=1
                        if count[0]==limit:raise RuntimeError('discovery-interrupted')
                    return original(kind,identity)
                native.inspect=inspect
                with self.assertRaisesRegex(RuntimeError,'first-create-failure'):owner.create()
                record=json.loads((output/'representative-owner/resources.json').read_text())
                self.assertEqual(sum(len(record[k]) for k in ('containers','volumes','networks')),limit-1)
                native.inspect=original
                self.assertTrue(owner.cleanup_exact());self.assertEqual(native.acquired,set())

    def test_duplicate_roles_foreign_network_members_and_replaced_registry_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            cid=format(1,'064x');foreign='e'*64
            native.objects[foreign]=copy.deepcopy(native.objects[cid]);native.objects[foreign]['Id']=foreign
            native.objects[foreign]['Created']='foreign-birth';native.acquired.add(foreign)
            with self.assertRaisesRegex(ValueError,'replaced_container'):owner.discover()
            native.acquired.remove(foreign)
            owner.start('web')
            web=next(v for v in native.objects.values() if v.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')=='web')
            net=next(iter(web['NetworkSettings']['Networks'].values()))['NetworkID']
            native.objects[net]['Containers'][foreign]={'Name':'foreign'}
            with self.assertRaisesRegex(ValueError,'foreign_network_member'):owner.validate('web')
            native.objects[net]['Containers'].pop(foreign)
            target=output/'representative-owner/resources.json';data=target.read_bytes();backup=target.with_name('receipt-backup')
            target.rename(backup);target.write_bytes(data);target.chmod(0o600)
            with self.assertRaisesRegex(ValueError,'registry_replaced'):owner.snapshot()
            target.unlink();backup.rename(target)
            self.assertTrue(owner.cleanup_exact())

    def test_snapshot_distinguishes_one_shot_success_from_created_and_live_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            self.assertFalse(owner.snapshot()['roles_healthy'])
            shots=set(layout.manifest['one_shot_roles'])
            live=[role for role in layout.plan['services'] if role not in shots]
            owner.start(*live)
            for value in native.objects.values():
                role=value.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')
                if role in shots:value['State'].update(Status='exited')
            self.assertTrue(owner.snapshot()['roles_healthy'])
            for role in shots:owner.wait(role)
            self.assertTrue(owner.cleanup_exact())
            self.assertTrue(json.loads((output/'representative-owner/cleanup.json').read_text())['roles_healthy'])

    def test_original_deadline_is_not_extended_by_recovery_and_missing_worker_refuses_before_create(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve())
            (output/'worker.json').unlink()
            with self.assertRaises(FileNotFoundError):owner.create()
            self.assertFalse(any(row[0]=='compose' for row in native.calls))
            native.deadline+=1
            with self.assertRaisesRegex(ValueError,'engine_deadline_changed'):owner.snapshot()



    def test_canonical_hostname_healthcheck_stop_defaults_and_live_state_are_attested(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            for role,section,key,bad in [('rabbitmq','Config','Hostname','foreign'),('mcp','Config','Healthcheck',{'Test':['CMD','foreign']}),
                ('alloy','Config','StopTimeout',1),('web','State','Paused',True),('web','State','Pid',True),
                ('web','State','Status','dead')]:
                cid=next(k for k,v in native.objects.items() if v.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')==role)
                previous=copy.deepcopy(native.objects[cid][section][key]);native.objects[cid][section][key]=bad
                with self.subTest(role=role,key=key),self.assertRaises(ValueError):owner.validate(role)
                native.objects[cid][section][key]=previous
            self.assertTrue(owner.cleanup_exact())


class RecoveryOwner(unittest.TestCase):
    prepare=NativeOwner.prepare

    def test_recovery_uses_remaining_original_cleanup_tail_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            original_deadline=native.deadline
            with patch.object(owners.time,'monotonic',return_value=original_deadline+1):
                recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                self.assertLessEqual(native.deadline,original_deadline+90)
                self.assertTrue(recovered.cleanup_exact());self.assertEqual(native.acquired,set())
                again=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                self.assertTrue(again.cleanup_exact());self.assertEqual(native.acquired,set())
                self.assertEqual(len(json.loads((output/'representative-owner/states.json').read_text())),38)


if __name__=='__main__':unittest.main()
