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


def assert_current_source_hashes(test,root):
    """Differential fixture: the admission still hashes fresh bytes on every call."""
    (root/'nested').mkdir()
    paths=[root/'plain',root/'space and ü',root/'.hidden',root/'line\nbreak',root/'nested/../plain']
    for path in paths:path.write_bytes(str(path).encode())
    paths.append(paths[0])
    def original(selected):return {str(path.relative_to(root)):owners.sha(path.read_bytes()) for path in selected}
    with patch.object(owners,'ROOT',root):
        first=owners._source_hashes(paths)
        test.assertEqual(first,original(paths))
        test.assertEqual(list(first),list(original(paths)))
        paths[0].write_bytes(b'changed between admission calls')
        second=owners._source_hashes(paths)
        test.assertEqual(second,original(paths));test.assertNotEqual(second,first)
        for path in (root,root.parent/(root.name+'-foreign'),Path('relative'),root.parent):
            with test.subTest(path=path):
                try:original([path])
                except (ValueError,IsADirectoryError) as error:
                    with test.assertRaises(type(error)):owners._source_hashes([path])
                else:test.fail('negative inventory fixture unexpectedly admitted')


class RepresentativeOwner(unittest.TestCase):
    def test_prepare_uses_actual_fixture_and_constructor_without_native_acquisition(self):
        with tempfile.TemporaryDirectory() as fixture_directory:
            assert_current_source_hashes(self,Path(fixture_directory).resolve())
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


    def test_recovery_rejects_damaged_closed_registry_before_worker_or_native_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            path=output/'representative-owner/resources.json';original=path.read_bytes();record=json.loads(original)
            volume=next(iter(record['volumes']));network=next(iter(record['networks']));role=next(iter(record['containers']))
            changes=[('schema',True),('generation',True),('generation',-1),('unknown',1),('status','foreign'),
                ('worker',record['worker']|{'group':True}),('worker',record['worker']|{'extra':1}),
                ('phase_cuts',{'14':{'start_ms':1,'cut_ms':2}}),('phase_cuts',{'4':{'start_ms':True,'cut_ms':2}}),
                ('dispatch',{'generation':1,'status':'ready','file':None,'digest':None}),
                ('images',{}),('containers',record['containers']|{'foreign':record['containers'][role]}),
                ('containers',record['containers']|{role:record['containers'][role]|{'Id':True}}),
                ('containers',record['containers']|{role:record['containers'][role]|{'extra':1}}),
                ('volumes',record['volumes']|{volume:{'Name':record['volumes'][volume]['Name']}}),
                ('networks',record['networks']|{network:{'Name':record['networks'][network]['Name']}}),
                ('networks',record['networks']|{network:record['networks'][network]|{'Internal':1}})]
            for kind,key in (('containers',role),('volumes',volume),('networks',network)):
                row=record[kind][key]
                for field in row:
                    changes.append((kind,record[kind]|{key:{k:v for k,v in row.items() if k!=field}}))
                changes.extend([(kind,record[kind]|{key:None}),(kind,record[kind]|{'unknown':row})])
            changes.extend([('generation',1),('deadline_mono_ns',True),('deadline_mono_ns',2**63-1),('phase_cuts',[]),
                ('networks',record['networks']|{network:record['networks'][network]|{'IPAM':{'Driver':'default','Options':None,'Config':[{'foreign':True}]}}}),
                ('volumes',record['volumes']|{volume:record['volumes'][volume]|{'Mountpoint':True}})])
            image=next(iter(record['images']))
            for field,value in [('id',True),('config',{}),('relation','foreign'),('descriptor',True),('extra',1)]:
                changes.append(('images',record['images']|{image:record['images'][image]|{field:value}}))
            duplicate=copy.deepcopy(record['containers']);roles=list(duplicate);duplicate[roles[1]]=duplicate[roles[0]]
            changes.append(('containers',duplicate))
            for key,value in changes:
                with self.subTest(key=key,value=value):
                    path.write_text(json.dumps(record|{key:value}));before=list(native.calls)
                    with patch.object(owners,'_stop_worker') as stop:
                        with self.assertRaises(ValueError):owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                        stop.assert_not_called()
                    self.assertEqual(native.calls,before)
            for raw in (json.dumps(record)[:-1]+',"schema":1}',json.dumps({k:v for k,v in record.items() if k!='containers'})):
                path.write_text(raw)
                with patch.object(owners,'_stop_worker') as stop:
                    with self.assertRaises(ValueError):owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                    stop.assert_not_called()
            path.write_bytes(original)
            self.assertTrue(owner.cleanup_exact())

    def test_recovery_name_only_receipts_preserve_same_name_replacement(self):
        for kind in ('volumes','networks'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
                path=output/'representative-owner/resources.json';record=json.loads(path.read_text())
                name=next(iter(record[kind]));receipt=record[kind][name]
                native.acquired.clear()
                identity=receipt.get('Id',receipt['Name']);native.acquired.add(identity)
                native.objects[identity]['CreatedAt' if kind=='volumes' else 'Created']='replacement-birth'
                record[kind][name]={'Name':receipt['Name']};path.write_text(json.dumps(record))
                with patch.object(owners,'_stop_worker') as stop:
                    with self.assertRaises(ValueError):owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                    stop.assert_not_called()
                self.assertIn(identity,native.acquired)


    def test_recovery_partial_resource_maps_keep_complete_receipts_and_finish_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());native.fail_create=True
            original=native.inspect;count=[0]
            def inspect(kind,identity):
                if kind!='image':
                    count[0]+=1
                    if count[0]==7:raise RuntimeError('interrupted-partial-discovery')
                return original(kind,identity)
            native.inspect=inspect
            with self.assertRaisesRegex(RuntimeError,'first-create-failure'):owner.create()
            native.inspect=original
            record=json.loads((output/'representative-owner/resources.json').read_text())
            self.assertEqual(sum(len(record[k]) for k in ('containers','volumes','networks')),6)
            recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
            self.assertTrue(recovered.cleanup_exact());self.assertEqual(native.acquired,set())

    def test_full_receipt_discovery_failure_preserves_replacement_during_cleanup(self):
        for kind in ('volumes','networks'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
                record=json.loads((output/'representative-owner/resources.json').read_text())
                receipt=next(iter(record[kind].values()));identity=receipt.get('Id',receipt['Name'])
                recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                native.objects[identity]['CreatedAt' if kind=='volumes' else 'Created']='replacement-birth'
                with self.assertRaises(ValueError):recovered.cleanup_exact()
                self.assertIn(identity,native.acquired)
                self.assertFalse(any(args[-1]==identity and (args[0]=='rm' or len(args)>1 and args[1]=='rm') for args in native.calls))
                self.assertFalse(json.loads((output/'representative-owner/cleanup.json').read_text())['passed'])


    def test_expired_recovery_image_inspections_use_remaining_original_cleanup_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            deadline=native.deadline;original=native.inspect
            def inspect(kind,identity):
                if kind=='image':
                    self.assertGreater(native.deadline,owners.time.monotonic())
                    self.assertLessEqual(native.deadline,deadline+90)
                return original(kind,identity)
            native.inspect=inspect
            with patch.object(owners.time,'monotonic',return_value=deadline+1):
                recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                self.assertTrue(recovered.cleanup_exact());self.assertEqual(native.acquired,set())


    def test_active_owner_rejects_bool_schema_before_native_action(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            path=output/'representative-owner/resources.json';original=path.read_bytes();record=json.loads(original)
            path.write_text(json.dumps(record|{'schema':True}));before=list(native.calls)
            with self.assertRaises(ValueError):owner.start('sig-disk')
            self.assertEqual(native.calls,before)
            path.write_bytes(original);self.assertTrue(owner.cleanup_exact())



class DiscoveryReceiptRecovery(unittest.TestCase):
    prepare=NativeOwner.prepare

    def test_rejected_receipts_preserve_valid_prefix_for_live_and_recovered_cleanup(self):
        cases=[('containers','Image',True),('containers','Image','not-a-digest'),
            ('containers','Image','sha256:'+'e'*64),('volumes','CreatedAt',True),
            ('volumes','Mountpoint',False),('networks','Created',True),
            ('networks','IPAM',{'Driver':'default','Options':None,'Config':[{'foreign':True}]})]
        for recovery in (False,True):
            for kind,field,bad in cases:
                with self.subTest(recovery=recovery,kind=kind,field=field,bad=bad),tempfile.TemporaryDirectory() as directory:
                    output,native,owner,layout=self.prepare(Path(directory).resolve())
                    target=next(key for key,value in native.objects.items() if
                        ('Config' in value if kind=='containers' else 'Mountpoint' in value if kind=='volumes' else 'IPAM' in value)
                        and key not in {spec['image'] for spec in layout.plan['services'].values()})
                    # The source model acquired one independent safe container,
                    # its real dependencies and the unsafe target. Other producer
                    # objects exist in the plan but were never acquired.
                    container_ids={role:next(key for key,value in native.objects.items() if
                        value.get('Name')=='/'+layout.plan['name']+'-'+role+'-1') for role in layout.plan['services']}
                    safe=next(role for role,spec in layout.plan['services'].items() if container_ids[role]!=target
                        and any(m['type']=='volume' for m in owners._mounts(spec)) and spec.get('networks')
                        and not any(m['type']=='volume' and layout.plan['volumes'][m['source']]['name']==target
                            for m in owners._mounts(spec))
                        and not any(layout.plan['networks'][name]['name']==native.objects[target].get('Name')
                            for name in spec.get('networks',[])))
                    safe_id=container_ids[safe]
                    acquired={target,safe_id}
                    for identity in tuple(acquired):
                        value=native.objects[identity]
                        if 'Config' in value:
                            acquired.update(m['Name'] for m in value['Mounts'] if m['Type']=='volume')
                            acquired.update(n['NetworkID'] for n in value['NetworkSettings']['Networks'].values())
                    original=native.call
                    def call(args,timeout=10):
                        result=original(args,timeout)
                        if args[0]=='compose':native.acquired.intersection_update(acquired)
                        # Model an interrupted acquisition with one object not yet
                        # visible. Every observed receipt is real producer state.
                        if args[0]=='ps' or len(args)>1 and args[1]=='ls':
                            return '\n'.join(row for row in result.splitlines() if row!=target)
                        return result
                    native.call=call
                    with self.assertRaisesRegex(ValueError,'acquisition_incomplete'):owner.create()
                    self.assertEqual(native.acquired,acquired)
                    path=output/'representative-owner/resources.json';prefix=path.read_bytes();record=json.loads(prefix)
                    prefix_ids={value['Name'] if resource=='volumes' else value['Id'] for resource in ('containers','volumes','networks') for value in record[resource].values()}
                    self.assertEqual(prefix_ids,acquired-{target})
                    self.assertEqual(set(record['containers']),{safe})
                    self.assertTrue(record['containers'] and record['volumes'] and record['networks'])
                    if recovery:owner=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                    native.call=original;native.objects[target][field]=bad
                    with self.assertRaises(ValueError) as rejected:owner.discover()
                    self.assertEqual(path.read_bytes(),prefix)
                    safe=next(role for role in record['containers'] if
                        not any(m['type']=='volume' and layout.plan['volumes'][m['source']]['name']==target
                            for m in owners._mounts(layout.plan['services'][role]))
                        and not any(layout.plan['networks'][name]['name']==native.objects[target].get('Name')
                            for name in layout.plan['services'][role].get('networks',[])))
                    safe_id=record['containers'][safe]['Id']
                    # Public validation must still use the previously valid memory
                    # and durable authority after the proposed receipt is refused.
                    validation_error=None
                    try:self.assertEqual(owner.validate(safe)['Id'],safe_id)
                    except ValueError as error:validation_error=error
                    with self.assertRaises(ValueError) as cleanup:
                        try:owner.cleanup_exact()
                        except ValueError as error:
                            saved_tb=error.__traceback__;raise
                    self.assertNotIn(safe_id,native.acquired)
                    self.assertIsNone(validation_error)
                    self.assertEqual(str(cleanup.exception),str(rejected.exception))
                    frames=[];tb=saved_tb
                    while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                    self.assertIn('discover',frames);self.assertIn('_registry',frames)
                    self.assertIn(target,native.acquired);self.assertNotIn(safe_id,native.acquired)
                    self.assertEqual(native.acquired,{target})
                    self.assertFalse(any(args[-1]==target and (args[0]=='rm' or len(args)>1 and args[1]=='rm') for args in native.calls))
                    final=json.loads(path.read_text());self.assertEqual(final['status'],'cleanup_failed')
                    receipt=json.loads((path.parent/'cleanup.json').read_text())
                    self.assertFalse(receipt['passed']);self.assertEqual(receipt['failed_operations'][0],'discover')
                    self.assertTrue(any(label.startswith('residue:') for label in receipt['failed_operations']))


class DeadlineAwareRecovery(unittest.TestCase):
    prepare=NativeOwner.prepare

    def test_expired_identify_uses_actual_raw_only_with_remaining_original_tail(self):
        import threading
        import sys
        life=fullstack.core_layout.signoz_lifecycle()
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            original_deadline=native.deadline
            # SOURCE-MODEL adapter at the native identify boundary. The unchanged
            # Engine.raw executes only an owned benign child, never Docker. The
            # private FIFO keeps it alive until its physical group is recorded;
            # the child's five-second bound also applies if registration fails.
            barrier=Path(directory)/'registered.fifo';os.mkfifo(barrier,0o600)
            release=os.open(barrier,os.O_RDWR|os.O_NONBLOCK);self.addCleanup(os.close,release)
            native.run=output;native.invocation=Path(directory)/'registered-child'
            native.invocation.write_text('#!'+sys.executable+'\n'
                'import os, select, sys\n'
                'descriptor=os.open('+repr(str(barrier))+',os.O_RDONLY|os.O_NONBLOCK)\n'
                'ready=select.select([descriptor],[],[],5)[0]\n'
                'sys.exit(0 if ready and os.read(descriptor,1)==b"1" else 1)\n')
            native.invocation.chmod(0o700)
            native.cli=native.invocation.resolve(strict=True);info=native.invocation.lstat()
            native.invocation_identity=(info.st_dev,info.st_ino,info.st_mode,str(native.cli))
            children=[];test=self
            def reap(process):
                if process.poll() is None:process.kill()
                process.wait(timeout=1)
                for stream in (process.stdout,process.stderr):stream.close()
            class RegisteredChildren(set):
                def add(self,process):
                    # raw's own finally starts after registration. Own cleanup
                    # first so a failed registration cannot leave this child.
                    test.addCleanup(reap,process)
                    test.assertIsNone(process.poll())
                    children.append({'pid':process.pid,'group':os.getpgid(process.pid),'reaped_exit':None})
                    super().add(process)
                    test.assertEqual(os.write(release,b'1'),1)
                def discard(self,process):
                    next(row for row in children if row['pid']==process.pid)['reaped_exit']=process.returncode
                    super().discard(process)
            native.plugin=None;native.lock=threading.RLock();native.child=RegisteredChildren();native.child_threads={}
            native.cancel_requested=set();native.cancel_requested_at={}
            observed=[]
            def identify():
                observed.append(native.deadline)
                life.Engine.raw(native,[])
                return dict(native.identity)
            native.identify=identify
            with patch.object(owners.time,'monotonic',return_value=original_deadline+1):
                with self.assertRaisesRegex(life.Refusal,'global_deadline'):native.identify()
                observed.clear()
                recovered=owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                self.assertTrue(observed)
                self.assertTrue(all(original_deadline+1<end<=original_deadline+90 for end in observed))
                # Cleanup guards also enter actual raw under the same tail.
                self.assertTrue(recovered.cleanup_exact());self.assertEqual(native.acquired,set())
                self.assertTrue(all(original_deadline+1<end<=original_deadline+90 for end in observed))
                self.assertLessEqual(native.deadline,original_deadline+90)
            self.assertEqual(native.child,set());self.assertEqual(native.child_threads,{})
            self.assertTrue(children);self.assertTrue(all(row['pid']==row['group'] and row['reaped_exit']==0 for row in children))
            print('SOURCE-MODEL actual Engine.raw children reaped: '+json.dumps(children))

    def test_invalid_original_budget_refuses_before_identify_worker_or_native_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create()
            path=output/'representative-owner/resources.json';original=path.read_bytes();record=json.loads(original)
            deadline=native.deadline;now=owners.time.monotonic()
            for bad in (True,0,2**63-1,int((now-91)*10**9),int((now+601)*10**9)):
                with self.subTest(deadline=bad):
                    path.write_text(json.dumps(record|{'deadline_mono_ns':bad}))
                    before=list(native.calls)
                    with patch.object(owners.time,'monotonic',return_value=now),patch.object(native,'identify',side_effect=AssertionError('native authority before valid budget')) as identify,patch.object(owners,'_stop_worker') as stop:
                        with self.assertRaises(ValueError):owners.CompositeOwner.recover(native,output,BINDINGS,pins())
                        identify.assert_not_called();stop.assert_not_called()
                    self.assertEqual(native.calls,before);self.assertEqual(native.deadline,deadline)
            path.write_bytes(original);self.assertTrue(owner.cleanup_exact())

if __name__=='__main__':unittest.main()


class NativeCommands(unittest.TestCase):
    prepare=NativeOwner.prepare
    def test_no_generic_exec_interface_and_literal_reader_claim_releases_owner_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            self.assertFalse(hasattr(owner,'exec'));self.assertFalse(hasattr(owner,'run'))
            import representative_scope as scopes
            from test_representative_scope import MODEL
            from test_signoz_queries import START,CUT
            import threading
            entered=threading.Event();release=threading.Event();failures=[]
            original=native.call
            def call(args,timeout=10):
                if args[0]!='exec':return original(args,timeout)
                entered.set();release.wait(3)
                doc=json.loads((output/'signoz/private/representative-scope/current.json').read_text())
                return json.dumps({'read_verified':True,'generation':doc['generation'],'digest':args[-1],'reads':10})
            native.call=call
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with scopes.mint(owner,4,START,CUT) as dispatch:
                    def invoke():
                        try:dispatch.read()
                        except BaseException as error:failures.append(error)
                    worker=threading.Thread(target=invoke);worker.start();self.assertTrue(entered.wait(3))
                    # Real owner validation can proceed while the native call is
                    # waiting for the agent. No owner RLock is held by that call.
                    checked=threading.Event()
                    check=threading.Thread(target=lambda:(owner.validate('sig-disk'),checked.set()));check.start()
                    try:self.assertTrue(checked.wait(1))
                    finally:release.set();worker.join(3);check.join(3)
                    self.assertEqual(failures,[])
            self.assertTrue(owner.cleanup_exact())


class ClosedSession(unittest.TestCase):
    """Actual source/hash files plus an Engine boundary double, never native SDK proof."""
    prepare=NativeOwner.prepare
    def prepare_session(self,root):
        output,native,owner,layout=self.prepare(root)
        (output/'signoz').mkdir(mode=0o700)
        for name in ('private','agent-driver','agent-admission'):(output/'signoz'/name).mkdir(mode=0o700)
        (output/'signoz/agent-driver/agent_probe.py').write_bytes((owners.ROOT/'scripts/observability-signoz/agent_probe.py').read_bytes())
        (output/'signoz/agent-driver/agent_probe.py').chmod(0o600)
        owner.create();owner.start('sig-disk','sig-agent')
        model=root/'source-model';model.mkdir(mode=0o700)
        for name in owners._SOURCE:
            target=model/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((owners.ROOT/name).read_bytes())
        names=('apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js',
            'apps/backend/dist/infrastructure/observability/technical-telemetry.js',
            'apps/backend/dist/infrastructure/object-storage/s3-object-storage.js',
            'apps/backend/dist/infrastructure/object-storage/s3-request-observation.js')
        modules={}
        for name in names:
            target=model/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('// SOURCE-MODEL only\n')
            modules[name]=hashlib.sha256(target.read_bytes()).hexdigest()
        observed={'schema':2,'trace_id':'a'*32,'root_id':'b'*16,'provider_requests':1,'body_read':'passed','runtime_modules':modules}
        return output,native,owner,model,observed
    def test_fixed_noargv_bootstrap_does_not_hold_owner_lock_and_replay_refuses(self):
        from test_representative_scope import MODEL
        import representative_scope as scopes
        import threading
        with tempfile.TemporaryDirectory() as temporary:
            output,native,owner,model,observed=self.prepare_session(Path(temporary).resolve())
            entered=threading.Event();release=threading.Event();results=[];calls=[];original=native.call
            def call(args,timeout=10):
                if args[0]!='exec':return original(args,timeout)
                calls.append((args,timeout));entered.set();release.wait(3)
                return json.dumps({'bootstrap':True,'viewer_admin_denied':True,'viewer_revoked_denied':True,'reads':10,
                    'sdk':{'sdk_span_semantics':'passed','sdk_metric_semantics':'passed','stored_spans':3,'logical_series':67,
                        'unknown_fields':['metric.exemplars'],'full_privacy':'unknown','original_vm_oracle':'not_applicable','native_probe_cases':['zero','latest_zero','future']}})
            native.call=call
            with patch.object(owners,'ROOT',model),patch.object(scopes,'_process_receipt',return_value=MODEL):
                owner.prepare_native_session(observed)
                control=threading.Thread(target=lambda:results.append(owner.bootstrap()),name='representative-control');control.start()
                try:
                    self.assertTrue(entered.wait(3));self.assertTrue(owner.validate('sig-disk')['State']['Running'])
                finally:release.set();control.join(3)
                self.assertFalse(control.is_alive());self.assertEqual(len(results),1)
                self.assertEqual(calls[0][0][2:],['python','-I','-B','/driver/scripts/observability-fullstack/representative_reader.py'])
                self.assertLessEqual(calls[0][1],600)
                with self.assertRaisesRegex(ValueError,'replay'):owner.bootstrap()
                self.assertTrue(owner.cleanup_exact())
    def test_bootstrap_failure_is_same_object_for_waiting_agent_and_no_agent_query_runs(self):
        from test_representative_scope import MODEL
        import representative_scope as scopes
        with tempfile.TemporaryDirectory() as temporary:
            output,native,owner,model,observed=self.prepare_session(Path(temporary).resolve());first=RuntimeError('first-engine')
            original=native.call;calls=[]
            def call(args,timeout=10):
                if args[0]!='exec':return original(args,timeout)
                calls.append(args);raise first
            native.call=call
            with patch.object(owners,'ROOT',model),patch.object(scopes,'_process_receipt',return_value=MODEL):
                owner.prepare_native_session(observed)
                with self.assertRaises(RuntimeError) as error:owner.bootstrap()
                self.assertIs(error.exception,first)
                with self.assertRaises(RuntimeError) as error:owner.prepare_agent()
                self.assertIs(error.exception,first);self.assertEqual(len(calls),1)
                self.assertTrue(owner.cleanup_exact())
