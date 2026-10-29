"""Fixed representative ownership preparation. No CLI or runtime activation.

Only the trusted controller may use this module. A Layout snapshot alone is not
constructor authority. The old eleven-role lifecycle remains a separate contract.
"""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import threading
import time

import core_layout

ROOT=core_layout.ROOT
BINDINGS={'source','project','nonce','uid','gid'}
DIRECTORY='representative-owner'
_SOURCE=('scripts/observability-fullstack/fullstack.py','scripts/observability-fullstack/core_layout.py',
    'scripts/observability-fullstack/representative_owner.py','scripts/observability-fullstack/signoz_ingestion.py',
    'scripts/observability-fullstack/representative_scope.py','scripts/observability-fullstack/signoz_queries.py',
    'scripts/observability-fullstack/representative_reader.py','scripts/observability-fullstack/representative_agent.py',
    'scripts/observability-fullstack/representative_stored.py','scripts/observability-fullstack/representative_witness.py',
    'scripts/observability-signoz/control.py','scripts/observability-signoz/functional_witness.py',
    'scripts/observability-signoz/gateway.py','scripts/observability-signoz/agent_probe.py',
    'scripts/observability-sdk-storage/sdk_storage.py','scripts/observability-sdk-storage/sdk_semantics.py',
    'scripts/observability-sdk-storage/emitter.mjs',
    'scripts/observability-sdk-storage/emitter_phase.py','scripts/observability-sdk-storage/emitter-phase.mjs',
    'scripts/observability-signoz/lifecycle.py','scripts/observability-signoz/image_proof.py',
    'scripts/observability-signoz/runtime.py',
    'infra/observability/fullstack/profile.json')


def need(ok,reason='representative_owner_contract'):
    if not ok:raise ValueError(reason)


def encoded(value):return core_layout.encoded(value)
def sha(raw):return hashlib.sha256(raw).hexdigest()


def _identity(info):return [info.st_dev,info.st_ino,info.st_uid]


def _read(path,maximum=4194304):
    path=Path(path)
    need(path.is_absolute() and path.parent.resolve()==path.parent,'representative_file_parent')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==os.getuid()
             and 0<=info.st_size<=maximum,'representative_file')
        raw=stream.read(maximum+1)
        need(len(raw)==info.st_size and _identity(path.lstat())==_identity(info),'representative_file_changed')
    return raw,_identity(info)


def _json(path):
    raw,identity=_read(path)
    def unique(pairs):
        result={}
        for key,value in pairs:
            need(key not in result);result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False)),[identity,sha(raw)]


def _canonical(prepared,binding,images,*,admit=False):
    # Read the actual producer's private records, not caller-crafted plan dictionaries.
    import fullstack
    need(type(prepared) is Path or isinstance(prepared,Path))
    need(prepared.is_absolute() and prepared==prepared.resolve() and prepared.is_dir())
    info=prepared.stat();need(info.st_uid==os.getuid() and not info.st_mode&0o022)
    need(type(binding) is dict and set(binding)==BINDINGS)
    primary,primary_file=_json(prepared/'compose.json')
    record,source_file=_json(prepared/'fullstack-source.json')
    need(type(record) is dict and set(record)=={'source','images','profile','capacity_scope'})
    need(record['source']==binding['source']['commit'] and record['images']==images,'representative_producer_source')
    need(record['profile']==json.loads(fullstack.PROFILE.read_text()),'representative_producer_profile')
    resource,resource_file=_json(prepared/'resource-source.json')
    selected,images_file=_json(prepared/'resource-images.json')
    need(type(resource) is dict and set(resource)=={'schema','commit','tree','inputs','scope'}
         and type(resource['schema']) is int and resource['schema']==1
         and {key:resource[key] for key in ('commit','tree')}==binding['source'],'representative_prepared_source')
    need(selected=={key:images[key] for key in ('source','backend','foundation')},'representative_prepared_images')
    if admit:
        expected={str(path.relative_to(ROOT)):sha(path.read_bytes()) for path in fullstack.fixture.binding.inputs()}
        need(resource['inputs']==expected,'representative_prepared_inputs')
    layout=fullstack.assemble_core(primary,core_layout.SIGNOZ,run=prepared,images=images,**binding)
    manifest=layout.manifest
    need((len(manifest['roles']),len(manifest['volumes']),len(manifest['networks']))==(38,11,10))
    source={name:sha((ROOT/name).read_bytes()) for name in _SOURCE}
    source.update(manifest['generator_inputs'])
    environments={}
    for service in layout.plan['services'].values():
        for name in service.get('env_file',[]):
            raw,identity=_read(Path(name));environments[name]=[identity,sha(raw)]
    bind_files={}
    for service in layout.plan['services'].values():
        for mount in _mounts(service):
            path=Path(mount['source'])
            if mount['type']=='bind' and path.is_file():
                raw,identity=_read(path);bind_files[str(path)]=[identity,sha(raw)]
    return layout,{'primary':primary_file,'producer':source_file,'resource_source':resource_file,
        'resource_images':images_file,'source':source,'environments':environments,'bind_files':bind_files}


def _validated_layout(layout):
    """Host-only Layout reads now require their original prepared producer records."""
    need(type(layout) is core_layout.Layout,'representative_layout_type')
    manifest=layout.manifest
    record,_=_json(Path(manifest['root'])/'fullstack-source.json')
    binding={key:manifest[key] for key in BINDINGS}
    actual,_=_canonical(Path(manifest['root']),binding,record['images'],admit=True)
    need(layout._plan==actual._plan and layout._manifest==actual._manifest and layout._files==actual._files,
         'representative_layout_provenance')
    return actual.manifest


class CompositeOwner:
    """One closed catalogue and durable registry under the existing 600+90 owner.

    No Layout/plan/engine handle is exposed. Copies returned by snapshot are observations,
    never ownership or a way to construct a helper scope.
    """
    __slots__=('__engine','__run','__binding','__images','__layout','__inputs','__registry',
               '__directory','__files','__lock','__deadline','__cleanup_end','__cleanup_started','__present','__scope_failure','__session','__native_calls','__native_threads','__native_failure')

    @classmethod
    def prepare(cls,engine,prepared_primary,fixed_bindings,checked_images):
        need(type(engine.identity) is dict and engine.identity==engine.identify(),'representative_daemon')
        need(type(engine.deadline) in (int,float) and math.isfinite(engine.deadline)
             and 0<engine.deadline-time.monotonic()<=600,'representative_deadline')
        layout,inputs=_canonical(prepared_primary,fixed_bindings,checked_images,admit=True)
        need(fixed_bindings['uid']==os.getuid() and fixed_bindings['gid']==os.getgid(),'representative_native_uid')
        generated=prepared_primary/'representative-ingestion'
        if not generated.exists():layout.prepare_inputs()
        else:
            need(generated==generated.resolve() and generated.is_dir() and stat.S_IMODE(generated.stat().st_mode)==0o700
                 and {p.name for p in generated.iterdir()}==set(layout.files),'representative_generated_directory')
            for name,text in layout.files.items():need(_read(generated/name)[0]==text.encode(),'representative_generated_input')
        layout,inputs=_canonical(prepared_primary,fixed_bindings,checked_images)
        own=cls.__new__(cls)
        own.__engine=engine;own.__run=prepared_primary
        own.__binding=encoded(fixed_bindings);own.__images=encoded(checked_images)
        own.__layout=layout;own.__inputs=encoded(inputs);own.__lock=threading.RLock()
        own.__deadline=engine.deadline;own.__cleanup_end=None;own.__cleanup_started=False;own.__present=None;own.__files={};own.__scope_failure=None;own.__session=None;own.__native_calls=set();own.__native_threads={};own.__native_failure=None
        own.__directory=prepared_primary/DIRECTORY
        own.__directory.mkdir(mode=0o700)
        own.__registry={'schema':1,'status':'prepared','daemon':json.loads(encoded(engine.identity)),'binding':json.loads(own.__binding),
            'root':layout.manifest['root_identity'],'plan_sha256':layout.manifest['plan_sha256'],
            'manifest_sha256':sha(layout._manifest.encode()),'deadline_mono_ns':int(engine.deadline*10**9),'inputs':json.loads(own.__inputs),
            'containers':{},'volumes':{},'networks':{},'images':{},'generation':0,'dispatch':None,'phase_cuts':{},'worker':None}
        own.__write('compose.json',layout.plan)
        own.__record()
        return own

    def __write(self,name,value):
        directory=self.__directory
        need(directory==directory.resolve() and directory.stat().st_uid==os.getuid()
             and stat.S_IMODE(directory.stat().st_mode)==0o700,'representative_registry_directory')
        target=directory/name
        if name in self.__files:
            _,identity=_read(target);need(identity==self.__files[name],'representative_registry_replaced')
        else:need(not target.exists() and not target.is_symlink(),'representative_registry_collision')
        temporary=directory/(name+'.pending')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        info=os.fstat(fd)
        try:
            with os.fdopen(fd,'wb') as stream:
                stream.write(encoded(value).encode());stream.flush();os.fsync(stream.fileno())
            os.replace(temporary,target);self.__files[name]=_identity(info)
            parent=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(parent)
            finally:os.close(parent)
        finally:
            if temporary.exists() and _identity(temporary.lstat())==_identity(info):temporary.unlink()

    def __record(self):
        _registry(self.__registry,self.__layout)
        self.__write('resources.json',self.__registry)

    def __guard(self,*,cleanup=False):
        need(type(self) is CompositeOwner)
        layout,inputs=_canonical(self.__run,json.loads(self.__binding),json.loads(self.__images))
        need(layout._plan==self.__layout._plan and layout._manifest==self.__layout._manifest
             and encoded(inputs)==self.__inputs,'representative_preparation_changed')
        record,receipt=_json(self.__directory/'resources.json')
        need(receipt[0]==self.__files['resources.json'],'representative_registry_replaced')
        _registry(record,self.__layout)
        need(encoded(record)==encoded(self.__registry),'representative_registry_changed')
        if record['worker'] is not None:need(_worker(self.__run)==record['worker'],'representative_worker_changed')
        plan,receipt=_json(self.__directory/'compose.json');self.__layout.validate(plan)
        need(receipt[0]==self.__files['compose.json'],'representative_compose_replaced')
        need(self.__engine.identity==self.__registry['daemon']==self.__engine.identify(),'representative_daemon_changed')
        end=self.__cleanup_end if cleanup else self.__deadline
        need(end is not None and time.monotonic()<end,'representative_deadline')
        need(self.__engine.deadline==end,'representative_engine_deadline_changed')
        return self.__layout.plan

    def snapshot(self):
        with self.__lock:
            self.__guard(cleanup=self.__cleanup_end is not None)
            manifest=self.__layout.manifest
            result={key:manifest[key] for key in ('roles','volumes','networks','one_shot_roles','supervisor','source','profile')}
            if self.__registry['containers']:
                states={}
                for role in self.__registry['containers']:
                    value=self.validate(role);states[role]={'state':value['State'],'restart_count':value['RestartCount']}
                result.update(states=states,roles_healthy=_healthy(states,manifest))
            return result

    def __labels(self,actual,expected):
        need(type(actual) is dict and all(actual.get(k)==v for k,v in expected.items()),'representative_foreign_labels')
        need(not any(k.startswith('inside.monitoring.') and k not in expected for k in actual),'representative_foreign_labels')

    def __image_receipts(self,plan):
        life=core_layout.signoz_lifecycle()
        lock=life.verify_packet()
        proofs=life.image_proof.load(life.CONFIG/'oci',lock)
        by_ref={proof.runtime_reference:proof for proof in proofs.values()}
        images={}
        for reference in sorted({s['image'] for s in plan['services'].values()}):
            value=self.__engine.inspect('image',reference)
            need(value.get('Os')=='linux' and value.get('Architecture')=='amd64' and value.get('Variant') in (None,''),'representative_image_platform')
            proof=by_ref.get(reference)
            if proof is not None:
                relation=life.image_identity(value,proof)
            else:
                relation='config_id'
                need(re.fullmatch('sha256:[a-f0-9]{64}',value.get('Id','')) is not None,'representative_image_id')
                if reference.startswith('sha256:'):need(value['Id']==reference,'representative_application_image')
                else:
                    need(any(r.split('@')[-1]==reference.split('@')[-1] for r in value.get('RepoDigests',[])),'representative_vendor_image')
            config=value.get('Config');need(type(config) is dict,'representative_image_config')
            if proof is not None:
                for key in ('Env','Labels','ExposedPorts','Volumes','Healthcheck','StopSignal','Shell','OnBuild'):
                    need((config.get(key) or None)==(proof.config.get(key) or None),'representative_image_defaults')
            images[reference]={'id':value['Id'],'config':config,'descriptor':proof.descriptor if proof else value.get('Descriptor'),
                               'relation':relation}
        return images

    def __admit_images(self,plan):
        images=self.__image_receipts(plan)
        if self.__registry['images']:need(encoded(self.__registry['images'])==encoded(images),'representative_images_changed')
        self.__registry['images']=images;self.__record()

    def create(self):
        with self.__lock:
            plan=self.__guard()
            need(self.__registry['status']=='prepared','representative_acquisition_replay')
            worker=_worker(self.__run)
            self.__registry['worker']=worker;self.__record()
            self.__admit_images(plan)
            self.__registry['status']='acquiring';self.__record()
            # Intent is durable BEFORE create. Even a failed command may have acquired objects.
            try:
                self.__engine.call(['compose','-p',plan['name'],'-f',str(self.__directory/'compose.json'),
                                    '--profile','functional','create'],timeout=30)
            except BaseException:
                try:self.discover()
                except BaseException:pass
                raise
            self.discover()
            need(set(self.__registry['containers'])==set(plan['services'])
                 and set(self.__registry['volumes'])==set(plan['volumes'])
                 and set(self.__registry['networks'])==set(plan['networks']),'representative_acquisition_incomplete')
            for role in plan['services']:self.validate(role)
            self.__registry['status']='created';self.__record()

    def discover(self):
        with self.__lock:
            plan=self.__guard(cleanup=self.__cleanup_end is not None)
            self.__present=None;present={key:set() for key in ('containers','volumes','networks')}
            project=plan['name'];nonce=json.loads(self.__binding)['nonce']
            filters=['--filter','label=com.docker.compose.project='+project,'--filter','label=inside.monitoring.nonce='+nonce]
            found=self.__engine.call(['ps','-aq','--no-trunc',*filters]).split()
            need(len(found)==len(set(found)),'representative_duplicate_container')
            for cid in found:
                need(re.fullmatch('[a-f0-9]{64}',cid) is not None,'representative_container_id')
                value=self.__engine.inspect('container',cid)
                role=value.get('Config',{}).get('Labels',{}).get('inside.monitoring.service')
                need(role in plan['services'],'representative_foreign_role')
                self.__labels(value['Config']['Labels'],plan['services'][role]['labels'])
                need(value.get('Id')==cid and type(value.get('Created')) is str and value['Created'],'representative_container_identity')
                receipt={key:value[key] for key in ('Id','Created','Image')}
                previous=self.__registry['containers'].get(role)
                need(previous is None or previous==receipt,'representative_replaced_container')
                # Refused native input must not replace the last valid authority.
                candidate=self.__registry|{'containers':self.__registry['containers']|{role:receipt}}
                _registry(candidate,self.__layout)
                self.__registry=candidate;self.__record();present['containers'].add(role)
            for kind in ('volumes','networks'):
                singular=kind[:-1]
                for name,spec in plan[kind].items():
                    found=self.__engine.call([singular,'ls','-q',*(['--no-trunc'] if kind=='networks' else []),
                        '--filter','name=^'+spec['name']+'$']).split()
                    if not found:continue
                    need(len(found)==1,'representative_resource_collision')
                    value=self.__engine.inspect(singular,found[0])
                    self.__labels(value['Labels'],spec['labels'])
                    need(value.get('Name')==spec['name'] and value.get('Driver')==spec.get('driver','local' if kind=='volumes' else 'bridge'),
                         'representative_resource_shape')
                    if kind=='volumes':
                        need(not value.get('Options'),'representative_volume_options')
                        receipt={key:value[key] for key in ('Name','CreatedAt','Mountpoint','Driver')}
                    else:
                        need(value.get('Internal') is spec.get('internal',False) and not value.get('EnableIPv6')
                             and not value.get('Attachable') and not value.get('Ingress') and not value.get('Options'),
                             'representative_network_shape')
                        need(re.fullmatch('[a-f0-9]{64}',value.get('Id','')) is not None,'representative_network_id')
                        receipt={key:value[key] for key in ('Id','Name','Created','Driver','Internal','IPAM')}
                    previous=self.__registry[kind].get(name)
                    need(previous is None or previous==receipt,'representative_replaced_'+singular)
                    candidate=self.__registry|{kind:self.__registry[kind]|{name:receipt}}
                    _registry(candidate,self.__layout)
                    self.__registry=candidate;self.__record();present[kind].add(name)
            self.__present=present

    def validate(self,role):
        with self.__lock:
            plan=self.__guard(cleanup=self.__cleanup_end is not None)
            need(type(role) is str and role in plan['services'],'representative_role')
            need(role in self.__registry['containers'],'representative_missing_container')
            receipt=self.__registry['containers'][role];value=self.__engine.inspect('container',receipt['Id'])
            need(all(value.get(key)==item for key,item in receipt.items()),'representative_container_replaced')
            spec=plan['services'][role];self.__labels(value['Config']['Labels'],spec['labels'])
            image=self.__registry['images'][spec['image']]
            for mount in _mounts(spec):
                if mount['type']=='volume':
                    receipt=self.__registry['volumes'][mount['source']]
                    current=self.__engine.inspect('volume',receipt['Name'])
                    need(all(current.get(k)==v for k,v in receipt.items()),'representative_volume_replaced')
                    self.__labels(current['Labels'],plan['volumes'][mount['source']]['labels'])
            for name in spec.get('networks',[]):
                receipt=self.__registry['networks'][name]
                current=self.__engine.inspect('network',receipt['Id'])
                need(all(current.get(k)==v for k,v in receipt.items()),'representative_network_replaced')
                self.__labels(current['Labels'],plan['networks'][name]['labels'])
                members=current.get('Containers');need(type(members) is dict,'representative_network_members')
                allowed={v['Id'] for key,v in self.__registry['containers'].items() if name in plan['services'][key].get('networks',[])}
                need(set(members)<=allowed,'representative_foreign_network_member')
                if value['State']['Running']:need(value['Id'] in members,'representative_network_missing_member')
            _native_contract(role,spec,plan,value,image,self.__registry['volumes'],self.__registry['networks'])
            return json.loads(encoded(value))

    def start(self,*roles):
        with self.__lock:
            self.__guard()
            need(roles and len(set(roles))==len(roles),'representative_start_roles')
            for role in roles:self.validate(role)
            self.__engine.call(['start',*(self.__registry['containers'][role]['Id'] for role in roles)])
            for role in roles:self.validate(role)

    def wait(self,role,timeout=180):
        self.__guard()
        need(type(timeout) in (int,float) and not isinstance(timeout,bool) and math.isfinite(timeout) and 0<timeout<=180)
        need(role in self.__layout.manifest['one_shot_roles'],'representative_not_one_shot')
        end=min(self.__deadline,time.monotonic()+timeout)
        while time.monotonic()<end:
            value=self.validate(role);state=value['State']
            if not state['Running']:
                need(state['Status']=='exited' and state['ExitCode']==0 and state['OOMKilled'] is False
                     and value['RestartCount']==0,'representative_one_shot_failed')
                return
            time.sleep(min(.1,max(0,end-time.monotonic())))
        raise ValueError('representative_init_deadline')

    def cleanup_exact(self):
        with self.__lock:
            need(not self.__cleanup_started,'representative_cleanup_replay')
            self.__cleanup_started=True
            # The caller's existing supervisor owns this 90s tail. Never extend it on retry.
            if self.__cleanup_end is None:self.__cleanup_end=min(self.__deadline+90,time.monotonic()+90)
            self.__engine.deadline=self.__cleanup_end
            first=None;failures=[]
            def attempt(label,action):
                nonlocal first
                try:return action()
                except BaseException:
                    if first is None:first=sys.exc_info()
                    failures.append(label)
                    return None
            if self.__scope_failure is not None:
                first=self.__scope_failure;failures.append('scope_recovery')
            attempt('scope_cleanup',lambda:self._scope_cleanup(recovery=True))
            attempt('discover',self.discover)
            states={}
            if 'states.json' in self.__files:
                prior=attempt('prior_states',lambda:_json(self.__directory/'states.json')[0])
                if prior is not None:states.update(prior)
            for role in self.__registry['containers']:
                if self.__present is not None and role not in self.__present['containers']:continue
                value=attempt('state:'+role,lambda role=role:self.validate(role))
                if value is not None:states.setdefault(role,{'state':value['State'],'restart_count':value['RestartCount']})
            # The witness is durable before ANY removal, even if an earlier receipt failed.
            witness=attempt('states',lambda:self.__write('states.json',states))
            if 'states' not in failures:
                for role,receipt in self.__registry['containers'].items():
                    if self.__present is not None and role not in self.__present['containers']:continue
                    def remove(role=role,receipt=receipt):
                        self.validate(role);self.__engine.call(['rm','-f',receipt['Id']],timeout=5)
                    attempt('container:'+role,remove)
                for kind in ('networks','volumes'):
                    for name,receipt in self.__registry[kind].items():
                        if self.__present is not None and name not in self.__present[kind]:continue
                        def remove(kind=kind,name=name,receipt=receipt):
                            plan=self.__guard(cleanup=True);spec=plan[kind][name]
                            native=self.__engine.inspect(kind[:-1],receipt.get('Id',receipt['Name']))
                            self.__labels(native['Labels'],spec['labels'])
                            need(all(native.get(k)==v for k,v in receipt.items()),'representative_cleanup_replacement')
                            if kind=='networks':need(not native.get('Containers'),'representative_network_busy')
                            self.__engine.call([kind[:-1],'rm',receipt.get('Id',receipt['Name'])],timeout=5)
                        attempt(kind+':'+name,remove)
            nonce=json.loads(self.__binding)['nonce'];project=json.loads(self.__binding)['project']
            for args in (['ps','-aq'],['volume','ls','-q'],['network','ls','-q']):
                def residue(args=args):
                    need(not self.__engine.call([*args,'--filter','label=com.docker.compose.project='+project,
                        '--filter','label=inside.monitoring.nonce='+nonce]).strip(),'representative_owned_residue')
                attempt('residue:'+args[0],residue)
            self.__registry['status']='cleaned' if not failures else 'cleanup_failed'
            attempt('record',self.__record)
            attempt('cleanup_receipt',lambda:self.__write('cleanup.json',{'passed':not failures,'failed_operations':failures,'roles_healthy':_healthy(states,self.__layout.manifest)}))
            if first is not None:raise first[1].with_traceback(first[2])
            return True

    @classmethod
    def recover(cls,engine,prepared_primary,fixed_bindings,checked_images):
        # Never start/recreate/retry acquisition during recovery. The supervisor must
        # have stopped its registered worker session before opening this boundary.
        layout,inputs=_canonical(prepared_primary,fixed_bindings,checked_images,admit=True)
        directory=prepared_primary/DIRECTORY
        need(directory==directory.resolve() and directory.stat().st_uid==os.getuid()
             and stat.S_IMODE(directory.stat().st_mode)==0o700,'representative_registry_directory')
        record,receipt=_json(directory/'resources.json')
        _registry(record,layout)
        need(encoded(record['daemon'])==encoded(engine.identity) and encoded(record['binding'])==encoded(fixed_bindings)
             and encoded(record['inputs'])==encoded(inputs) and encoded(record['root'])==encoded(layout.manifest['root_identity'])
             and record['plan_sha256']==layout.manifest['plan_sha256']
             and record['manifest_sha256']==sha(layout._manifest.encode()),'representative_recovery_binding')
        need(type(record['deadline_mono_ns']) is int and 0<record['deadline_mono_ns']<2**63
             and -87<record['deadline_mono_ns']/10**9-time.monotonic()<=600,'representative_recovery_cleanup_budget')
        recovery_end=min(record['deadline_mono_ns']/10**9+90,time.monotonic()+90)
        # identify() reaches Engine.raw and therefore needs this validated tail
        # too. It cannot grant a new 600s phase or extend the original 90s tail.
        engine.deadline=recovery_end
        need(encoded(record['daemon'])==encoded(engine.identify()),'representative_recovery_binding')
        reader=cls.__new__(cls);reader.__engine=engine
        if record['images']:
            need(encoded(record['images'])==encoded(reader.__image_receipts(layout.plan)),'representative_recovery_images')
        if record['worker'] is not None:
            need(_worker(prepared_primary)==record['worker'],'representative_recovery_worker_changed')
            _stop_worker(record['worker'])
        else:
            need(record['status']=='prepared' and not any(record[k] for k in ('containers','volumes','networks')),'representative_recovery_worker_required')
        own=cls.__new__(cls)
        own.__engine=engine;own.__run=prepared_primary;own.__binding=encoded(fixed_bindings);own.__images=encoded(checked_images)
        own.__layout=layout;own.__inputs=encoded(inputs);own.__registry=record;own.__directory=directory
        own.__files={path.name:_read(path)[1] for path in directory.iterdir() if path.name in ('compose.json','resources.json','states.json','cleanup.json')}
        own.__lock=threading.RLock();own.__deadline=record['deadline_mono_ns']/10**9
        need(-90<own.__deadline-time.monotonic()<=600,'representative_recovery_deadline')
        own.__cleanup_end=recovery_end
        own.__cleanup_started=False;own.__present=None;own.__scope_failure=None;own.__session=None;own.__native_calls=set();own.__native_threads={};own.__native_failure=None;engine.deadline=own.__cleanup_end
        own.__guard(cleanup=True)
        if record['dispatch'] is not None:
            # Consume durably, retaining acquisition identities until exact unlink.
            try:
                own._scope_consume(record['dispatch']['generation'])
                own._scope_cleanup(recovery=True)
            except BaseException:own.__scope_failure=sys.exc_info()
        return own

    def _scope_cleanup(self,*,recovery=False):
        with self.__lock:
            self.__guard(cleanup=self.__cleanup_end is not None)
            current=self.__registry['dispatch']
            if current is None:return
            need(current['status']=='consumed','representative_scope_inflight')
            import representative_scope as scopes
            directory=self.__run/'signoz/private/representative-scope'
            if not recovery and current['directory'] is not None:
                need(scopes._directory(directory)==current['directory'],'representative_dispatch_directory_changed')
            if directory.exists() or directory.is_symlink():
                need(current['directory'] is not None and scopes._directory(directory)==current['directory'],
                     'representative_recovery_unrecorded_scope')
                path=directory/'current.json'
                if not recovery and current['file'] is not None:_read(path,32768)
                if path.exists() or path.is_symlink():
                    raw,identity=_read(path,32768)
                    need(current['file'] is not None and identity==current['file'],'representative_dispatch_replacement')
                    if current['digest'] is not None:need(sha(raw)==current['digest'],'representative_recovery_scope_replaced')
                    path.unlink()
                need(not any(directory.iterdir()),'representative_dispatch_directory_changed')
                directory.rmdir()
            self.__registry['dispatch']=None;self.__record()


    def _scope_begin(self,phase,start_ms,cut_ms):
        with self.__lock:
            self.__guard()
            need(self.__registry['status']=='created' and self.__registry['dispatch'] is None,'representative_scope_inflight')
            key=str(phase);previous=self.__registry['phase_cuts'].get(key)
            need(previous is None or previous['start_ms']==start_ms and cut_ms>previous['cut_ms'],'representative_scope_replay')
            native=self.validate('sig-disk')
            need(native['State']['Running'] is True and native['State']['Status']=='running','representative_scope_native_stopped')
            self.__registry['generation']+=1
            generation=self.__registry['generation']
            self.__registry['phase_cuts'][key]={'start_ms':start_ms,'cut_ms':cut_ms}
            self.__registry['dispatch']={'generation':generation,'status':'minting','directory':None,'file':None,'digest':None}
            self.__record()
            manifest=self.__layout.manifest
            return {'generation':generation,'binding':{key:manifest[key] for key in ('source','root','root_identity','profile','project','nonce')},
                'plan_sha256':manifest['plan_sha256'],'manifest_sha256':sha(self.__layout._manifest.encode()),
                'generator_sha256':sha(encoded(manifest['generator_inputs']).encode()),
                'native':{'cid':native['Id'],'created':native['Created'],'image':native['Image'],'init_pid':native['State']['Pid']},
                'owner_deadline_ns':int(self.__deadline*10**9)},self.__run/'signoz'

    def _scope_acquire(self,generation,*,directory=None,file=None):
        with self.__lock:
            self.__guard();current=self.__registry['dispatch']
            need(current is not None and current['generation']==generation and current['status']=='minting','representative_scope_generation')
            if directory is not None:
                need(current['directory'] is None and current['file'] is None,'representative_scope_acquisition')
                _inode(directory);current['directory']=directory
            if file is not None:
                need(current['directory'] is not None and current['file'] is None,'representative_scope_acquisition')
                _inode(file);current['file']=file
            self.__record()

    def _scope_record(self,generation,receipt):
        with self.__lock:
            self.__guard();current=self.__registry['dispatch']
            need(current is not None and current['generation']==generation and current['status']=='minting','representative_scope_generation')
            need(type(receipt) is dict and set(receipt)=={'file','directory','digest'},'representative_scope_receipt')
            need(receipt['directory']==current['directory'] and receipt['file']==current['file'] and _hex(receipt['digest'],64),'representative_scope_acquisition')
            current.update(json.loads(encoded(receipt)));current['status']='ready';self.__record()

    def _scope_check(self,generation,digest,*,executing=False):
        with self.__lock:
            self.__guard();current=self.__registry['dispatch']
            need(current is not None and current['generation']==generation and current['digest']==digest
                 and current['status']==('executing' if executing else 'ready'),'representative_scope_consumed')
            native=self.validate('sig-disk')
            need(native['State']['Running'] is True and native['State']['Status']=='running','representative_scope_native_stopped')
            return {'cid':native['Id'],'created':native['Created'],'image':native['Image'],'init_pid':native['State']['Pid']}

    def _scope_consume(self,generation):
        with self.__lock:
            self.__guard(cleanup=self.__cleanup_end is not None);current=self.__registry['dispatch']
            need(current is not None and current['generation']==generation,'representative_scope_consumed')
            current['status']='consumed';self.__record()

    def prepare_native_session(self,observed):
        """Bind actual private SDK receipt and source files before literal bootstrap."""
        import representative_scope as scopes
        import secrets
        with self.__lock:
            self.__guard();need(self.__session is None and self.__registry['generation']==0,'representative_session_replay')
            need(type(observed) is dict and set(observed)=={'schema','trace_id','root_id','provider_requests','body_read','runtime_modules'}
                and type(observed['schema']) is int and observed['schema']==2 and type(observed['provider_requests']) is int
                and observed['provider_requests']==1 and observed['body_read']=='passed'
                and _hex(observed['trace_id'],32) and observed['trace_id']!='0'*32
                and _hex(observed['root_id'],16) and observed['root_id']!='0'*16,'representative_sdk_receipt')
            modules=observed['runtime_modules'];need(type(modules) is dict and 4<=len(modules)<=1000)
            required={'apps/backend/dist/infrastructure/observability/'+name+'.js' for name in ('technical-telemetry-runtime','technical-telemetry')}
            required|={'apps/backend/dist/infrastructure/object-storage/'+name+'.js' for name in ('s3-object-storage','s3-request-observation')}
            need(required<=set(modules),'representative_sdk_modules')
            for name,digest in modules.items():
                need(type(name) is str and len(name)<=512 and not name.startswith('/') and '..' not in name.split('/')
                    and name.startswith(('apps/backend/dist/','node_modules/','packages/','docs/contracts/dist/')) and _hex(digest,64))
                need(sha(_read(ROOT/name)[0])==digest,'representative_sdk_module_changed')
            native=self.validate('sig-disk');need(native['State']['Running'],'representative_session_native_stopped')
            run=self.__run/'signoz';driver=run/'driver';mirror=scopes._install_mirror(driver)
            path=run/'agent-driver/representative_agent.py';raw,_=_read(ROOT/'scripts/observability-fullstack/representative_agent.py')
            scopes._write(path,raw)
            need({p.name for p in path.parent.iterdir()}=={'agent_probe.py','representative_agent.py'})
            manifest=self.__layout.manifest
            document={'schema':1,'binding':{k:manifest[k] for k in ('source','root','root_identity','profile','project','nonce')},
                'native':{'cid':native['Id'],'created':native['Created'],'image':native['Image'],'init_pid':native['State']['Pid'],
                    **scopes._process_receipt(native['State']['Pid'])},'deadline_mono_ns':int(self.__deadline*10**9),
                'mirror':{name:value[0] for name,value in mirror.items()},'agent_key':secrets.token_hex(32),'sdk':observed}
            body=scopes._encoded(document);need(len(body)<=65536)
            session=run/'private/representative-session.json';identity=scopes._write(session,body)
            self.__session=(session,identity,sha(body),document,mirror,[path,scopes._read(path,private=True)[1],sha(raw)])

    def __session_guard(self):
        import representative_scope as scopes
        self.__guard();need(self.__session is not None,'representative_session_missing')
        path,identity,digest,document,mirror,agent=self.__session
        raw,current=scopes._read(path,private=True,maximum=65536)
        need(current==identity and sha(raw)==digest and scopes._mirror(self.__run/'signoz/driver')==mirror,'representative_session_changed')
        raw,current=scopes._read(agent[0],private=True);need(current==agent[1] and sha(raw)==agent[2])
        return document

    def bootstrap(self):
        """Only the source-fixed no-argv resident, under the SAME absolute owner."""
        try:return self.__bootstrap()
        except BaseException:
            with self.__lock:self.__native_failure=sys.exc_info()
            raise

    def __bootstrap(self):
        with self.__lock:
            self.__session_guard();need('bootstrap' not in self.__native_calls,'representative_bootstrap_replay')
            native=self.validate('sig-disk');self.__native_calls.add('bootstrap');self.__native_threads['bootstrap']=threading.current_thread()
            timeout=self.__deadline-time.monotonic();need(0<timeout<=600)
        # Native Engine owns/cancels this child, without holding the owner lock.
        try:
            result=self.__engine.call(['exec',native['Id'],'python','-I','-B',
                '/driver/scripts/observability-fullstack/representative_reader.py'],timeout=timeout)
        except BaseException:
            with self.__lock:self.__native_failure=sys.exc_info()
            raise
        with self.__lock:self.__session_guard();self.validate('sig-disk')
        value=json.loads(result)
        need(type(value) is dict and set(value)=={'bootstrap','viewer_admin_denied','viewer_revoked_denied','reads','sdk'}
            and all(value[k] is True for k in ('bootstrap','viewer_admin_denied','viewer_revoked_denied')) and type(value['reads']) is int and value['reads']==10)
        sdk=value['sdk'];need(type(sdk) is dict and set(sdk)=={'sdk_span_semantics','sdk_metric_semantics','stored_spans','logical_series','unknown_fields','full_privacy','original_vm_oracle','native_probe_cases'}
            and sdk['sdk_span_semantics']==sdk['sdk_metric_semantics']=='passed' and type(sdk['stored_spans']) is int and sdk['stored_spans']==3
            and type(sdk['logical_series']) is int and sdk['logical_series']==67 and sdk['full_privacy']=='unknown' and sdk['original_vm_oracle']=='not_applicable'
            and sdk['native_probe_cases']==['zero','latest_zero','future']
            and type(sdk['unknown_fields']) is list and 1<=len(sdk['unknown_fields'])<=32
            and all(type(v) is str and re.fullmatch('[a-z_.]+',v) is not None for v in sdk['unknown_fields']))
        return value

    def prepare_agent(self):
        """Wait only for socket readiness, then bind the existing admission mount."""
        import representative_scope as scopes
        import representative_agent as agent
        with self.__lock:
            document=self.__session_guard();need('agent_admission' not in self.__native_calls)
            native=self.validate('sig-agent');need(native['State']['Running'])
        while time.monotonic()<self.__deadline:
            with self.__lock:
                if self.__native_failure is not None:raise self.__native_failure[1].with_traceback(self.__native_failure[2])
            result=self.__engine.call(['exec',native['Id'],'python','-I','-B','/driver/agent_probe.py','socket-identity'],timeout=min(10,self.__deadline-time.monotonic()))
            socket=json.loads(result)
            if socket.get('available') is True:break
            need(socket=={'available':False});time.sleep(.05)
        else:raise ValueError('representative_agent_ready_deadline')
        with self.__lock:
            self.__session_guard();self.validate('sig-agent')
            need(set(socket)=={'available','identity'} and type(socket['identity']) is dict)
            targets={}
            for role in agent.ENDPOINTS:
                value=self.validate('sig-'+role)
                backend=self.__layout.plan['networks']['sig-backend']['name']
                address=value['NetworkSettings']['Networks'][backend]['IPAddress']
                need(type(address) is str and address,'representative_backend_address');targets[role]=address
            config={'schema':1,'nonce':document['binding']['nonce'],'agent_key':document['agent_key'],
                'socket_identity':socket['identity'],'deadline_mono_ns':document['deadline_mono_ns'],
                'network_namespace':scopes._process_receipt(native['State']['Pid'])['netns'],'targets':targets}
            path=self.__run/'signoz/agent-admission/representative.json';scopes._write(path,scopes._encoded(config))
            self.__native_calls.add('agent_admission')

    def agent(self):
        with self.__lock:
            self.__session_guard();need('agent_admission' in self.__native_calls and 'agent' not in self.__native_calls)
            native=self.validate('sig-agent');self.__native_calls.add('agent')
            timeout=min(10,self.__deadline-time.monotonic());need(timeout>0)
        result=self.__engine.call(['exec',native['Id'],'python','-I','-B','/driver/representative_agent.py'],timeout=timeout)
        with self.__lock:self.__session_guard();self.validate('sig-agent')
        value=json.loads(result)
        need(type(value) is dict and set(value)=={'schema','reads','gateway_denials','direct_ip_denials','alias_kernel_denials','alias_dns_unknown'}
            and all(type(v) is int and 0<=v<=100 for v in value.values()) and value['schema']==1 and value['reads']==10
            and value['gateway_denials']==4 and value['direct_ip_denials']==11
            and value['alias_kernel_denials']+value['alias_dns_unknown']==11)
        return value

    def _cancel_readers(self,control,reader):
        # Only the two registered native reader threads can select cancellation.
        # Engine still owns the actual child processes and their reap.
        for thread in (control,reader):
            if thread is not None:
                need(type(thread) is threading.Thread and any(thread is owned for owned in self.__native_threads.values()))
                self.__engine.cancel_thread_children(thread)

    def helper_receipt(self):
        """Read only the fixed owned sanitizer's private file, never an endpoint."""
        with self.__lock:
            self.__guard();native=self.validate('sig-trace-sanitizer');need(native['State']['Running'])
        result=self.__engine.call(['exec',native['Id'],'python','-I','-B','-c',_HELPER_RECEIPT],timeout=3)
        with self.__lock:self.__guard();self.validate('sig-trace-sanitizer')
        need(type(result) is str and len(result)<=8192)
        return json.loads(result,object_pairs_hook=__import__('representative_scope')._unique)

    def _scope_exec(self,generation,digest):
        with self.__lock:
            native=self._scope_check(generation,digest)
            self.__registry['dispatch']['status']='executing';self.__record()
            # Preserved verify-only literal invocation.
            return self.__engine.call(['exec',native['cid'],'python','-I','-B',
                '/driver/scripts/observability-fullstack/representative_scope.py',digest],timeout=10)

    def _scope_read(self,generation,digest):
        with self.__lock:
            native=self._scope_check(generation,digest)
            self.__registry['dispatch']['status']='executing';self.__record();self.__native_threads['reader']=threading.current_thread()
        # Release owner lock while the resident/agent execute. The durable claim
        # has already consumed authority for every competing verify/read caller.
        result=self.__engine.call(['exec',native['cid'],'python','-I','-B',
            '/driver/scripts/observability-fullstack/representative_reader.py',digest],timeout=10)
        with self.__lock:self._scope_check(generation,digest,executing=True)
        return result


# This command is literal, private and read-only. The owned helper source/bind/CID
# is attested independently by the canonical owner before and after execution.
_HELPER_RECEIPT="""import hashlib,json,os,stat,time
from pathlib import Path
started=time.monotonic_ns()
p=Path('/state/receipt.json')
parent=p.parent.lstat()
assert stat.S_ISDIR(parent.st_mode) and parent.st_uid==os.getuid() and stat.S_IMODE(parent.st_mode)==0o700
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
with os.fdopen(fd,'rb') as stream:
 i=os.fstat(stream.fileno())
 assert stat.S_ISREG(i.st_mode) and i.st_uid==os.getuid() and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600 and 0<i.st_size<=4096
 raw=stream.read(4097)
 assert len(raw)==i.st_size and (p.lstat().st_dev,p.lstat().st_ino)==(i.st_dev,i.st_ino)
birth=int(Path('/proc/1/stat').read_text().rsplit(')',1)[1].split()[19])
cgroup=hashlib.sha256(Path('/proc/1/cgroup').read_bytes()).hexdigest()
source=hashlib.sha256(Path('/driver/trace_sanitizer.py').read_bytes()).hexdigest()
def unique(pairs):
 result=dict(pairs)
 assert len(result)==len(pairs)
 return result
print(json.dumps({'receipt':json.loads(raw,object_pairs_hook=unique),'identity':[i.st_dev,i.st_ino,i.st_uid,i.st_nlink],
 'process_start_ticks':birth,'cgroup_sha256':cgroup,'source_sha256':source,
 'read_start_ns':started,'read_end_ns':time.monotonic_ns()},separators=(',',':')))
"""


def _hex(value,length):return type(value) is str and re.fullmatch('[a-f0-9]{'+str(length)+'}',value) is not None

def _text(value):return type(value) is str and 0<len(value)<=4096

def _inode(value):
    need(type(value) is list and len(value)==3 and all(type(v) is int and v>=0 for v in value)
         and value[1]>0 and value[2]==os.getuid(),'representative_registry_inode')


def _registry(record,layout):
    """Recovery JSON is unknown until its entire closed ownership schema passes.

    Resource maps may be partial after acquisition failure. Each retained receipt
    must still carry its complete immutable identity, never an identity subset.
    Exact source/input/daemon/image values are checked separately before authority.
    """
    need(type(record) is dict and set(record)=={'schema','status','daemon','binding','root','plan_sha256',
        'manifest_sha256','deadline_mono_ns','inputs','containers','volumes','networks','images','generation','dispatch','phase_cuts','worker'},
        'representative_registry_schema')
    need(type(record['schema']) is int and record['schema']==1 and type(record['status']) is str
         and record['status'] in ('prepared','acquiring','created','cleaned','cleanup_failed'),'representative_registry_status')
    need(type(record['deadline_mono_ns']) is int and 0<record['deadline_mono_ns']<2**63)
    need(type(record['generation']) is int and 0<=record['generation']<2**53,'representative_registry_generation')
    for key in ('plan_sha256','manifest_sha256'):need(_hex(record[key],64))
    if record['worker'] is not None:_worker_record(record['worker'])
    plan=layout.plan
    for kind,catalogue in (('containers',plan['services']),('volumes',plan['volumes']),('networks',plan['networks'])):
        rows=record[kind];need(type(rows) is dict and set(rows)<=set(catalogue),'representative_registry_roles')
        identities=set()
        for name,row in rows.items():
            fields={'Id','Created','Image'} if kind=='containers' else {'Name','CreatedAt','Mountpoint','Driver'} if kind=='volumes' else {'Id','Name','Created','Driver','Internal','IPAM'}
            need(type(row) is dict and set(row)==fields,'representative_registry_receipt')
            if kind=='containers':
                need(_hex(row['Id'],64) and _text(row['Created']) and type(row['Image']) is str
                     and re.fullmatch('sha256:[a-f0-9]{64}',row['Image']) is not None)
            else:
                spec=catalogue[name]
                need(type(row['Name']) is str and row['Name']==spec['name'] and type(row['Driver']) is str
                     and row['Driver']==spec.get('driver','local' if kind=='volumes' else 'bridge'))
                if kind=='volumes':need(_text(row['CreatedAt']) and _text(row['Mountpoint']) and row['Mountpoint'].startswith('/'))
                else:
                    need(_hex(row['Id'],64) and _text(row['Created']) and type(row['Internal']) is bool
                         and row['Internal'] is spec.get('internal',False))
                    ipam=row['IPAM'];need(type(ipam) is dict and set(ipam)=={'Driver','Options','Config'} and _text(ipam['Driver']))
                    options=ipam['Options'];need(options is None or type(options) is dict and all(_text(k) and type(v) is str for k,v in options.items()))
                    need(type(ipam['Config']) is list)
                    for config in ipam['Config']:
                        need(type(config) is dict and set(config)<={'Subnet','IPRange','Gateway','AuxiliaryAddresses'})
                        for key,value in config.items():
                            if key=='AuxiliaryAddresses':need(type(value) is dict and all(_text(k) and _text(v) for k,v in value.items()))
                            else:need(type(value) is str)
            identity=row['Name'] if kind=='volumes' else row['Id']
            need(identity not in identities,'representative_registry_duplicate_identity');identities.add(identity)
    images=record['images'];refs={spec['image'] for spec in plan['services'].values()}
    need(type(images) is dict and (not images or set(images)==refs),'representative_registry_images')
    for image in images.values():
        need(type(image) is dict and set(image)=={'id','config','descriptor','relation'} and type(image['id']) is str
             and re.fullmatch('sha256:[a-f0-9]{64}',image['id']) is not None and type(image['config']) is dict
             and type(image['relation']) is str and image['relation'] in ('config_id','child_id'),'representative_registry_images')
        # The complete config/descriptor is compared byte-canonically with freshly
        # admitted native image receipts before any worker/destructive authority.
        need(image['descriptor'] is None or type(image['descriptor']) is dict)
    if any(record[k] for k in ('containers','volumes','networks')) or record['status'] in ('acquiring','created'):
        need(bool(images) and record['worker'] is not None,'representative_registry_acquisition')
    for role,row in record['containers'].items():need(row['Image']==images[plan['services'][role]['image']]['id'])
    cuts=record['phase_cuts'];need(type(cuts) is dict)
    for phase,window in cuts.items():
        need(type(phase) is str and phase in {str(i) for i in range(14)} and type(window) is dict and set(window)=={'start_ms','cut_ms'})
        need(all(type(v) is int for v in window.values()) and 0<window['start_ms']<window['cut_ms']<2**53
             and window['cut_ms']-window['start_ms']<=600000)
    need(len(cuts)<=record['generation'] and (record['generation']==0)==(not cuts))
    if record['status'] in ('prepared','acquiring'):need(record['generation']==0)
    dispatch=record['dispatch']
    if dispatch is not None:
        need(type(dispatch) is dict and set(dispatch)=={'generation','status','directory','file','digest'}
             and type(dispatch['generation']) is int and dispatch['generation']==record['generation']>0
             and type(dispatch['status']) is str and dispatch['status'] in ('minting','ready','executing','consumed')
             and bool(cuts) and record['worker'] is not None,'representative_registry_dispatch')
        for key in ('directory','file'):
            if dispatch[key] is not None:_inode(dispatch[key])
        need(dispatch['file'] is None or dispatch['directory'] is not None)
        need(dispatch['digest'] is None or _hex(dispatch['digest'],64) and dispatch['file'] is not None)
        if dispatch['status'] in ('ready','executing'):need(dispatch['digest'] is not None)
        if dispatch['status']=='minting':need(dispatch['digest'] is None)


def _mounts(spec):
    result=[]
    for mount in spec.get('volumes',[]):
        if type(mount) is dict:result.append(dict(mount));continue
        need(type(mount) is str)
        pieces=mount.split(':');need(2<=len(pieces)<=3)
        source,target=pieces[:2];options=pieces[2].split(',') if len(pieces)==3 else []
        result.append({'type':'bind' if source.startswith('/') else 'volume','source':source,'target':target,
            'read_only':'ro' in options,'propagation':next((o for o in options if o in ('rslave','rshared','slave','shared','private','rprivate')),'rprivate')})
    return result


def _environment(spec,image):
    result={}
    for entry in image.get('Env') or []:
        need(type(entry) is str and '=' in entry);key,value=entry.split('=',1);need(key not in result);result[key]=value
    for path in spec.get('env_file',[]):
        raw,_=_read(Path(path));text=raw.decode()
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith('#'):continue
            key,separator,value=line.partition('=')
            need(separator and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key) is not None
                 and not value.startswith(('"',"'")) and '$' not in value,'representative_env_file_grammar')
            result[key]=value
    values=spec.get('environment',{});need(type(values) is dict and all(type(k) is str and type(v) is str for k,v in values.items()))
    result.update(values);return result


def _native_contract(role,spec,plan,value,image,volumes,networks):
    """Normalize known Docker inspect fields against the ACTUAL canonical service.

    Source-model only until the required Linux attachment proof. Unknown authority
    fields are refused; harmless Docker bookkeeping fields do not grant authority.
    """
    config=value['Config'];host=value['HostConfig'];defaults=image['config']
    need(value.get('Image')==image['id'] and config.get('Image')==spec['image'],'representative_attached_image')
    if image['descriptor'] is not None and ('ImageManifestDescriptor' in value or image['relation']=='child_id'):
        need(value.get('ImageManifestDescriptor')==image['descriptor'],'representative_attached_descriptor')
    need(config.get('User','')==spec.get('user',defaults.get('User','')),'representative_user')
    need((config.get('Cmd') or [])==(spec.get('command',defaults.get('Cmd')) or []),'representative_command')
    need((config.get('Entrypoint') or [])==(spec.get('entrypoint',defaults.get('Entrypoint')) or []),'representative_entrypoint')
    need(config.get('WorkingDir','')==spec.get('working_dir',defaults.get('WorkingDir','')),'representative_working_dir')
    need(config.get('Hostname')==spec.get('hostname',value['Id'][:12]) and config.get('Domainname','')==spec.get('domainname',''),'representative_hostname')
    need(config.get('StopTimeout')==(_seconds(spec['stop_grace_period']) if 'stop_grace_period' in spec else defaults.get('StopTimeout')),'representative_stop_timeout')
    need((config.get('StopSignal') or '')==(spec.get('stop_signal',defaults.get('StopSignal')) or ''),'representative_stop_signal')
    _healthcheck(config.get('Healthcheck'),spec.get('healthcheck',{}),defaults.get('Healthcheck'))
    actual={}
    for item in config.get('Env') or []:
        need(type(item) is str and '=' in item);key,entry=item.split('=',1);need(key not in actual);actual[key]=entry
    need(actual==_environment(spec,defaults),'representative_environment')
    expected={'Memory':core_layout.memory(spec['mem_limit']),
        'MemorySwap':core_layout.memory(spec.get('memswap_limit',spec['mem_limit']))*(1 if 'memswap_limit' in spec else 2),
        'NanoCpus':round(float(spec['cpus'])*10**9),'PidsLimit':spec['pids_limit'],
        'ReadonlyRootfs':spec.get('read_only',False),'Privileged':spec.get('privileged',False),
        'PidMode':'','IpcMode':'private','UTSMode':'','CgroupnsMode':'private',
        'RestartPolicy':{'Name':spec.get('restart','no'),'MaximumRetryCount':0},
        'LogConfig':{'Type':spec['logging']['driver'],'Config':spec['logging'].get('options',{})}}
    for key,entry in expected.items():need(type(host.get(key)) is type(entry) and host[key]==entry,'representative_host_'+key)
    need(type(host.get('Init')) in (type(None),bool) and (host.get('Init') or False)==spec.get('init',False),'representative_init')
    life=core_layout.signoz_lifecycle()
    for key,field in (('CapDrop','cap_drop'),('CapAdd','cap_add')):
        need(life.canonical_caps(host.get(key))==set(spec.get(field,[])),'representative_'+field)
    need(set(host.get('SecurityOpt') or [])==set(spec.get('security_opt',[])),'representative_security_options')
    for key in ('Devices','DeviceRequests','VolumesFrom','Links','ExtraHosts','GroupAdd','Ulimits','Sysctls','DeviceCgroupRules'):
        need(not host.get(key),'representative_extra_authority')
    for key in ('CpuShares','CpuPeriod','CpuQuota','CpuRealtimePeriod','CpuRealtimeRuntime','MemoryReservation','BlkioWeight','OomScoreAdj'):
        need(type(host.get(key,0)) is int and host.get(key,0)==0,'representative_hidden_quota')
    need(not host.get('CpusetCpus') and not host.get('CpusetMems') and not host.get('CgroupParent')
         and not host.get('OomKillDisable') and not host.get('PublishAllPorts'),'representative_hidden_authority')
    need((host.get('Dns') or [])==spec.get('dns',[]) and not host.get('DnsOptions') and not host.get('DnsSearch'),'representative_dns')
    tmpfs={}
    for entry in spec.get('tmpfs',[]):
        target,_,options=entry.partition(':');tmpfs[target]=options
    need((host.get('Tmpfs') or {})==tmpfs,'representative_tmpfs')
    ports={}
    for entry in spec.get('ports',[]):
        address,external,internal=entry.split(':');key=internal if '/' in internal else internal+'/tcp'
        ports.setdefault(key,[]).append({'HostIp':address,'HostPort':external})
    need((host.get('PortBindings') or {})==ports,'representative_ports')
    mounts=_mounts(spec);actual=value.get('Mounts',[])
    need(len(actual)==len(mounts),'representative_mount_count')
    for mount in mounts:
        found=[v for v in actual if v.get('Destination')==mount['target']];need(len(found)==1,'representative_mount_target')
        native=found[0];need(native.get('Type')==mount['type'] and native.get('RW') is (not mount.get('read_only',False)),'representative_mount_authority')
        if mount['type']=='bind':
            need(native.get('Source')==mount['source'] and native.get('Propagation')==mount.get('propagation','rprivate'),'representative_bind')
        else:
            name=mount['source'];need(name in volumes and native.get('Name')==plan['volumes'][name]['name']
                 and native.get('Source')==volumes[name]['Mountpoint'],'representative_volume_mount')
    attached=value['NetworkSettings']['Networks']
    if spec.get('network_mode')=='none':
        need(host.get('NetworkMode')=='none' and set(attached) in (set(),{'none'}),'representative_network_none')
        need(all(not row.get(k) for row in attached.values() for k in ('IPAddress','GlobalIPv6Address','Gateway','IPv6Gateway')),'representative_network_none_address')
    else:
        expected_networks={plan['networks'][name]['name']:name for name in spec['networks']}
        need(set(attached)==set(expected_networks) and host.get('NetworkMode') in expected_networks,'representative_networks')
        native_name=plan['name']+'-'+role+'-1';need(value.get('Name')=='/'+native_name,'representative_compose_name')
        for real,name in expected_networks.items():
            need(name in networks and attached[real].get('NetworkID')==networks[name]['Id'],'representative_network_identity')
            options=spec['networks'][name] if type(spec['networks']) is dict else {}
            need(set(attached[real].get('Aliases') or [])=={native_name,role,*options.get('aliases',[])},'representative_network_aliases')
    native_name=plan['name']+'-'+role+'-1';need(value.get('Name')=='/'+native_name,'representative_compose_name')
    state=value.get('State');need(type(state) is dict and type(state.get('Running')) is bool
        and type(state.get('OOMKilled')) is bool and type(state.get('ExitCode')) is int
        and type(value.get('RestartCount')) is int and value['RestartCount']==0 and state['OOMKilled'] is False,
        'representative_state')
    need(all(type(state.get(k)) is bool and state[k] is False for k in ('Paused','Restarting','Dead'))
         and state.get('Error','')=='' and type(state.get('Pid')) is int
         and (state['Pid']>1 and state['Status']=='running' if state['Running'] else state['Pid']==0 and state['Status'] in ('created','exited')),'representative_state_transition')


def _healthy(states,manifest):
    if set(states)!=set(manifest['roles']):return False
    one_shots=set(manifest['one_shot_roles'])
    for role,value in states.items():
        state=value['state']
        if state['OOMKilled'] or state['ExitCode']!=0 or value['restart_count']!=0:return False
        if role in one_shots:
            if state['Running'] or state['Status']!='exited':return False
        elif not state['Running'] or state['Status']!='running':return False
    return True


def _worker(run):
    record,_=_json(run/'worker.json')
    _worker_record(record)
    return record


def _worker_record(record):
    need(type(record) is dict and set(record)=={'pid','group','start_ticks'}
        and type(record['pid']) is int and record['pid']>1 and record['group']==record['pid']
        and type(record['group']) is int and type(record['start_ticks']) is str
        and re.fullmatch('[0-9]{1,24}',record['start_ticks']) is not None,'representative_worker_registration')


def _stop_worker(record):
    # Reuse the existing Linux session cancellation boundary, never a new supervisor.
    name='_representative_session_recovery'
    if name not in sys.modules:
        path=ROOT/'scripts/observability-signoz/runtime.py'
        spec=importlib.util.spec_from_file_location(name,path)
        module=importlib.util.module_from_spec(spec)
        original=list(sys.path)
        try:
            sys.path.insert(0,str(path.parent));spec.loader.exec_module(module)
        finally:sys.path[:]=original
        sys.modules[name]=module
    sys.modules[name].stop_worker(record)


def _seconds(value):
    need(type(value) is str and re.fullmatch('[0-9]+s',value) is not None,'representative_duration')
    return int(value[:-1])


def _healthcheck(actual,service,image):
    expected=dict(image or {})
    fields={'test':'Test','interval':'Interval','timeout':'Timeout','retries':'Retries','start_period':'StartPeriod'}
    need(set(service)<=set(fields),'representative_healthcheck_fields')
    for key,value in service.items():expected[fields[key]]=_seconds(value)*10**9 if key in ('interval','timeout','start_period') else value
    actual=actual or {}
    allowed={'Test','Interval','Timeout','Retries','StartPeriod','StartInterval'}
    need(type(actual) is dict and set(actual)<=allowed and set(expected)<=allowed,'representative_healthcheck_shape')
    need((actual.get('Test') or None)==(expected.get('Test') or None),'representative_healthcheck_command')
    for key in allowed-{'Test'}:
        need(type(actual.get(key,0)) is int and actual.get(key,0)==expected.get(key,0),'representative_healthcheck_budget')
