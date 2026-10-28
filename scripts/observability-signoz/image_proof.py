"""Local immutable OCI index → child → config proof. No native or network effects."""
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat

MAX_DOCUMENT_BYTES=1048576
MAX_TOTAL_BYTES=2097152
INDEX_TYPES=('application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json')
MANIFEST_TYPES=('application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json')
CONFIG_TYPES=('application/vnd.oci.image.config.v1+json','application/vnd.docker.container.image.v1+json')
LAYER_TYPES=('application/vnd.docker.image.rootfs.diff.tar.gzip','application/vnd.docker.image.rootfs.foreign.diff.tar.gzip',
    'application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.oci.image.layer.v1.tar+zstd',
    'application/vnd.oci.image.layer.nondistributable.v1.tar','application/vnd.oci.image.layer.nondistributable.v1.tar+gzip','application/vnd.oci.image.layer.nondistributable.v1.tar+zstd')


class ProofError(ValueError):pass


def require(value):
    if not value:raise ProofError('invalid_oci_proof')


def digest(value):
    require(type(value) is str and re.fullmatch('sha256:[a-f0-9]{64}',value) is not None)
    return value


def unique(pairs):
    result={}
    for key,value in pairs:
        require(key not in result);result[key]=value
    return result


def decode(raw):
    require(type(raw) in (str,bytes) and len(raw)<=MAX_DOCUMENT_BYTES)
    def constant(_value):raise ProofError('invalid_oci_proof')
    try:value=json.loads(raw,object_pairs_hook=unique,parse_constant=constant)
    except (ValueError,UnicodeError,RecursionError) as error:raise ProofError('invalid_oci_proof') from error
    nodes=[0]
    def walk(item,depth):
        nodes[0]+=1;require(depth<=16 and nodes[0]<=20000)
        if type(item) is dict:
            require(len(item)<=2048 and all(len(k)<=256 for k in item))
            for child in item.values():walk(child,depth+1)
        elif type(item) is list:
            require(len(item)<=2048)
            for child in item:walk(child,depth+1)
        elif type(item) is str:require(len(item)<=65536)
        elif type(item) is float:require(math.isfinite(item))
    walk(value,0)
    return value


def runtime_reference(row):
    repository=row['repository']
    require(type(repository) is str and re.fullmatch(r'docker.io/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*',repository) is not None)
    return repository+'@'+digest(row['linux_amd64_manifest'])


@dataclass(frozen=True)
class Proof:
    reference: str
    runtime_reference: str
    child: str
    descriptor: dict
    config_digest: str
    config: dict
    diff_ids: tuple
    volume_paths: tuple


def load(directory,lock):
    """Verify the complete finite seven-image packet; returned data is engine-local."""
    try:return _load(Path(directory),lock)
    except (OSError,KeyError,TypeError,ValueError,RecursionError) as error:
        raise ProofError('invalid_oci_proof') from error


def _load(directory,lock):
    require(directory.is_dir() and not directory.is_symlink())
    used=set();total=0
    def read(expected,size=None):
        nonlocal total
        name=digest(expected).split(':')[1]+'.json';used.add(name)
        fd=os.open(directory/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb') as stream:
            native=os.fstat(stream.fileno())
            require(stat.S_ISREG(native.st_mode) and native.st_nlink==1 and 0<native.st_size<=MAX_DOCUMENT_BYTES)
            raw=stream.read(MAX_DOCUMENT_BYTES+1)
        total+=len(raw);require(total<=MAX_TOTAL_BYTES)
        require(size is None or len(raw)==size)
        require('sha256:'+hashlib.sha256(raw).hexdigest()==expected)
        return decode(raw)
    def descriptor(value,types):
        require(type(value) is dict and value.get('mediaType') in types)
        digest(value.get('digest'))
        require(type(value.get('size')) is int and 0<value['size']<=MAX_DOCUMENT_BYTES)
    rows=lock['images'];require(type(rows) is list and len(rows)==7)
    require(len({row['repository'] for row in rows})==len(rows))
    proofs={}
    for row in rows:
        runtime=runtime_reference(row);index_digest=digest(row['index_digest'])
        require(row['pinned']==row['repository']+'@'+index_digest)
        index=read(index_digest)
        require(type(index) is dict and type(index.get('schemaVersion')) is int and index['schemaVersion']==2 and index.get('mediaType') in INDEX_TYPES)
        require(type(index.get('manifests')) is list and 0<len(index['manifests'])<=128)
        for item in index['manifests']:descriptor(item,MANIFEST_TYPES)
        candidates=[d for d in index['manifests'] if type(d) is dict and type(d.get('platform')) is dict
                    and d['platform'].get('os')=='linux' and d['platform'].get('architecture')=='amd64']
        require(len(candidates)==1);selected=candidates[0];descriptor(selected,MANIFEST_TYPES)
        require(selected['digest']==row['linux_amd64_manifest'] and selected['platform'].get('variant') is None)
        child=read(selected['digest'],selected['size'])
        require(type(child) is dict and type(child.get('schemaVersion')) is int and child['schemaVersion']==2 and child.get('mediaType')==selected['mediaType'])
        cfg_descriptor=child['config'];descriptor(cfg_descriptor,CONFIG_TYPES)
        metadata=lock['image_config_metadata'][row['repository']]['amd64']
        require(cfg_descriptor['digest']==metadata['config_digest'])
        config=read(cfg_descriptor['digest'],cfg_descriptor['size'])
        require(type(config) is dict and config.get('os')=='linux' and config.get('architecture')=='amd64' and config.get('variant') is None)
        cfg=config['config'];require(type(cfg) is dict)
        require(all((cfg.get(native) or None)==(metadata[key] or None) for native,key in
            [('Entrypoint','entrypoint'),('Cmd','cmd'),('WorkingDir','working_dir'),('User','user')]))
        declared=cfg.get('Volumes')
        require(declared is None or type(declared) is dict and all(type(k) is str and k.startswith('/') and v=={} for k,v in declared.items()))
        volumes=tuple(sorted(declared or {}));require(list(volumes)==lock['declared_volume_contracts'][row['repository']])
        rootfs=config['rootfs'];require(type(rootfs) is dict and rootfs.get('type')=='layers' and type(rootfs.get('diff_ids')) is list)
        layers=child['layers'];require(type(layers) is list and 0<len(layers)==len(rootfs['diff_ids'])<=128)
        for layer,diff in zip(layers,rootfs['diff_ids']):
            require(type(layer) is dict and layer.get('mediaType') in LAYER_TYPES and type(layer.get('size')) is int and 0<layer['size']<=2**40)
            digest(layer.get('digest'));digest(diff)
        proofs[row['pinned']]=Proof(row['pinned'],runtime,selected['digest'],selected,cfg_descriptor['digest'],cfg,tuple(rootfs['diff_ids']),volumes)
    require(len(used)==21 and set(p.name for p in directory.iterdir())==used)
    return proofs
