"""Immutable public OCI proofs and actual image/container admission, without Docker."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import lifecycle
import image_proof


def fixture():
    lock=lifecycle.verify_packet();row=next(r for r in lock['images'] if r['repository']=='docker.io/library/python')
    digest=lock['image_config_metadata'][row['repository']]['amd64']['config_digest']
    config=json.loads((lifecycle.CONFIG/'oci'/(digest.split(':')[1]+'.json')).read_bytes())
    child=row['repository']+'@'+row['linux_amd64_manifest']
    native={'Id':digest,'Os':'linux','Architecture':'amd64','Config':config['config'],
        'RootFS':{'Type':'layers','Layers':config['rootfs']['diff_ids']},'RepoDigests':[child]}
    return lock,row,native


class Native:
    def __init__(self,image):self.image=image;self.args=[]
    def call(self,args,timeout=10):
        self.args.append(args)
        if args[0]=='pull':return ''
        if args[:2]==['image','inspect']:return json.dumps([self.image])
        raise AssertionError('unexpected_native_command')
    def inspect(self,kind,reference):
        self.args.append([kind,'inspect',reference]);return copy.deepcopy(self.image)


def container_fixture(engine,row,image,root,descriptor=False):
    binding=lifecycle.checked_image(engine,row,'amd64')
    project='signoz1566-'+'a'*12;nonce='b'*32;role='disk';cid='c'*64
    own=lifecycle.Owned(engine,root,{role:binding},project,nonce)
    own.plan=lifecycle.make_plan(root,lifecycle.verify_packet()['images'],project,nonce,1001,1001)
    own.containers={role:cid};own.created={role:'owned-created'}
    own.volumes={spec['name']:{} for spec in own.plan['volumes'].values()}
    spec=own.plan['services'][role];cpu,memory=lifecycle.BUDGETS[role]
    value={'Id':cid,'Created':'owned-created','Image':binding['image_id'],
        'Config':{'Image':binding['runtime_reference'],'User':spec['user'],'Entrypoint':spec['entrypoint'],
            'Cmd':spec['command'],'Env':[],'Labels':{**lifecycle.labels(project,nonce),'inside.monitoring.service':role}},
        'HostConfig':{'Memory':memory*1024**2,'MemorySwap':memory*1024**2,'NanoCpus':round(cpu*10**9),
            'PidsLimit':128,'ReadonlyRootfs':True,'Privileged':False,'PortBindings':None,'Binds':None,
            'CapDrop':['ALL'],'CapAdd':None,'SecurityOpt':['no-new-privileges:true'],
            'NetworkMode':project+'_backend','RestartPolicy':{'Name':'no'},'LogConfig':{'Type':'none'}},
        'NetworkSettings':{'Networks':{project+'_backend':{}}},'Mounts':[]}
    for mount in spec['volumes']:
        native={'Destination':mount['target'],'Type':mount['type'],'RW':not mount['read_only']}
        native.update({'Source':mount['source']} if mount['type']=='bind' else {'Name':own.plan['volumes'][mount['source']]['name']})
        value['Mounts'].append(native)
    if descriptor:value['ImageManifestDescriptor']=copy.deepcopy(engine.image_proofs[row['pinned']].descriptor)
    original=engine.inspect
    engine.inspect=lambda kind,reference:copy.deepcopy(value) if kind=='container' else original(kind,reference)
    return own,value


class OCIAdmission(unittest.TestCase):
    def test_classic_no_descriptor_admits_only_the_same_locked_child_and_config(self):
        lock,row,image=fixture();engine=Native(image)
        admitted=lifecycle.checked_image(engine,row,'amd64')
        self.assertEqual(admitted['image_id'],image['Id'])
        self.assertEqual(admitted['runtime_reference'],row['repository']+'@'+row['linux_amd64_manifest'])
        self.assertEqual(admitted['relation'],'config_id')
        self.assertFalse(admitted['image_descriptor_available'])
        self.assertEqual(admitted['reference'],row['pinned'])
        self.assertTrue(all(args[-1]==admitted['runtime_reference'] for args in engine.args))

    def test_any_present_invalid_descriptor_and_native_identity_mutation_refuses(self):
        lock,row,image=fixture();engine=Native(image);lifecycle.checked_image(engine,row,'amd64')
        proof=engine.image_proofs[row['pinned']]
        bad=[{**image,'Descriptor':d} for d in (None,{},[],{'digest':proof.child})]
        for key,value in [('digest','sha256:'+'f'*64),('size',True),('size',proof.descriptor['size']+1),
                          ('mediaType','application/vnd.oci.image.index.v1+json'),('platform',{'os':'linux','architecture':'arm64'}),
                          ('platform',{'os':'linux','architecture':'amd64','variant':'v3'}),('platform',None)]:
            bad.append({**image,'Descriptor':{**proof.descriptor,key:value}})
        for key,value in [('Os','windows'),('Architecture','arm64'),('Id',row['index_digest']),('Id','sha256:'+'f'*64),
                          ('RepoDigests',[row['pinned']]),('RepoDigests',['foreign/python@'+proof.child]),
                          ('RootFS',{'Type':'layers','Layers':list(reversed(proof.diff_ids))}),('RootFS',None)]:
            bad.append({**image,key:value})
        for key,value in [('Cmd',['foreign']),('User','0'),('Entrypoint',['foreign']),('WorkingDir','/foreign'),('Volumes',[]),('Volumes',{'/foreign':{}})]:
            bad.append({**image,'Config':{**image['Config'],key:value}})
        for index,value in enumerate(bad):
            engine.image=value
            with self.subTest(index=index),self.assertRaises(lifecycle.Refusal):lifecycle.checked_image(engine,row,'amd64')

    def test_container_requested_and_actual_identity_and_all_present_metadata_are_bound(self):
        lock,row,image=fixture();engine=Native(image)
        with tempfile.TemporaryDirectory() as tmp:
            own,value=container_fixture(engine,row,image,Path(tmp));self.assertEqual(own.validate('disk')['Image'],image['Id'])
            self.assertFalse(own.images['disk']['container_descriptor_available'])
            base=copy.deepcopy(value);bad=[]
            for key,data in [('Image','sha256:'+'f'*64),('Created','replacement'),('ImageManifestDescriptor',None),('ImageManifestDescriptor',{})]:
                bad.append({**base,key:data})
            for requested in (row['pinned'],'python:latest','foreign/python@'+row['linux_amd64_manifest']):
                bad.append({**base,'Config':{**base['Config'],'Image':requested}})
            for key,data in [('Memory',1),('Privileged',True),('NetworkMode','host')]:
                bad.append({**base,'HostConfig':{**base['HostConfig'],key:data}})
            bad.append({**base,'Mounts':[]})
            bad.append({**base,'Config':{**base['Config'],'Labels':{**base['Config']['Labels'],'inside.monitoring.nonce':'foreign'}}})
            proof=engine.image_proofs[row['pinned']]
            for field,data in [('digest','sha256:'+'f'*64),('size',proof.descriptor['size']+1),('mediaType','foreign'),('platform',{'os':'windows','architecture':'amd64'})]:
                bad.append({**base,'ImageManifestDescriptor':{**proof.descriptor,field:data}})
            for index,broken in enumerate(bad):
                value.clear();value.update(broken)
                with self.subTest(index=index),self.assertRaises(lifecycle.Refusal):own.validate('disk')

    def test_child_target_relation_requires_both_descriptors_but_not_optional_platform(self):
        lock,row,image=fixture();engine=Native(image);lifecycle.checked_image(engine,row,'amd64')
        descriptor={k:v for k,v in engine.image_proofs[row['pinned']].descriptor.items() if k!='platform'}
        engine.image={**image,'Id':row['linux_amd64_manifest'],'Descriptor':descriptor}
        binding=lifecycle.checked_image(engine,row,'amd64');self.assertEqual(binding['relation'],'child_id')
        with tempfile.TemporaryDirectory() as tmp:
            own,value=container_fixture(engine,row,engine.image,Path(tmp),descriptor=True)
            value['ImageManifestDescriptor']=descriptor
            own.validate('disk');self.assertTrue(own.images['disk']['container_descriptor_available'])
            del value['ImageManifestDescriptor']
            with self.assertRaises(lifecycle.Refusal):own.validate('disk')
        engine.image={**image,'Id':row['linux_amd64_manifest']}
        with self.assertRaises(lifecycle.Refusal):lifecycle.checked_image(engine,row,'amd64')

    def test_acquisition_plan_and_all_image_inspection_use_only_same_locked_child_refs(self):
        lock,row,image=fixture();engine=Native(image)
        with patch.object(image_proof,'load',wraps=image_proof.load) as load:
            lifecycle.acquire_image(engine,row);lifecycle.checked_image(engine,row,'amd64');lifecycle.checked_image(engine,row,'amd64')
            self.assertEqual(load.call_count,1)
        child=image_proof.runtime_reference(row)
        self.assertEqual(engine.args[0],['pull','--platform','linux/amd64',child])
        self.assertTrue(all(a[-1]==child for a in engine.args))
        plan=lifecycle.make_plan(Path('/owned-fixture'),lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001)
        for role,spec in plan['services'].items():
            pin=next(r for r in lock['images'] if r['repository'].split('/')[-1]==lifecycle.ROLE_IMAGES[role])
            self.assertEqual(spec['image'],image_proof.runtime_reference(pin));self.assertEqual(spec['pull_policy'],'never')

    def test_recovery_reinspects_same_child_without_acquisition(self):
        import sys
        before=sys.path.copy()
        try:import runtime
        finally:sys.path[:]=before
        lock,row,image=fixture();engine=Native(image);engine.identity={}
        class Owned:
            def __init__(self,*args,**options):
                self.root=args[1];self.containers={'disk':'c'*64};self.created={'disk':'owned'};self.volumes={};self.networks={};self.images={}
            def discover(self):pass
            def record(self):pass
            def cleanup_exact(self):
                if self.images['disk']['runtime_reference']!=image_proof.runtime_reference(row):raise AssertionError('wrong_recovery_image')
                lifecycle.private_json(self.root/'states.json',{})
                return True
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();plan=lifecycle.make_plan(root,lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001)
            lifecycle.private_json(root/'compose.json',plan);lifecycle.private_json(root/'source.json',{'profile_id':lifecycle.BASELINE_PROFILE,'commit':'a'*40,'tree':'b'*40})
            lifecycle.private_json(root/'owner.json',{'profile_id':lifecycle.BASELINE_PROFILE,'source_sha':'a'*40,'source_tree':'b'*40,'cwd':str(runtime.ROOT),'project':plan['name'],'nonce':'b'*32,'daemon':{},'plan_sha256':lifecycle.digest(root/'compose.json')})
            with patch.object(runtime,'verify_source'),patch.object(runtime,'engine',return_value=engine),patch.object(lifecycle,'Owned',Owned):
                self.assertTrue(runtime.recover(root)['passed'])
        self.assertTrue(engine.args);self.assertTrue(all(args[:2]==['image','inspect'] and args[-1]==image_proof.runtime_reference(row) for args in engine.args))


if __name__=='__main__':unittest.main()
