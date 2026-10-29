"""Private one-read scope integrity under a trusted controller dispatch channel.

SHA256 is not a signature or independent CID/telemetry attestation. Only the
controller attests CID ownership. Native authority and transport stay unavailable.
The helper imports only stdlib until ALL five mirrored files have been checked.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import threading
import time

_MIRROR=('scripts/observability-fullstack/representative_scope.py',
    'scripts/observability-fullstack/signoz_queries.py','scripts/observability-fullstack/core_layout.py',
    'scripts/observability-signoz/metric_recipe.py','infra/observability/fullstack/profile.json')
_PRIVATE=Path('/private/representative-scope')
_DRIVER=Path(__file__).resolve().parents[2]
_NAME='current.json'
_MAX=32768
_SCOPES={}
_READERS={}
_LOADED=set()


def need(ok,reason='representative_scope_contract'):
    if not ok:raise ValueError(reason)


def _encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def _sha(raw):return hashlib.sha256(raw).hexdigest()
def _identity(info):return [info.st_dev,info.st_ino,info.st_uid]
def _hex(value,length):return type(value) is str and re.fullmatch('[a-f0-9]{'+str(length)+'}',value) is not None


def _directory(path):
    need(type(path) is Path or isinstance(path,Path))
    need(path.is_absolute() and path==path.resolve(),'representative_scope_parent')
    info=path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and stat.S_IMODE(info.st_mode)==0o700,'representative_scope_directory')
    return _identity(info)


def _read(path,*,private=False,maximum=_MAX):
    need(path.is_absolute() and path.parent==path.parent.resolve(),'representative_scope_path')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==os.getuid()
             and 0<info.st_size<=maximum and (not private or stat.S_IMODE(info.st_mode)==0o600),'representative_scope_file')
        raw=stream.read(maximum+1)
        need(len(raw)==info.st_size and _identity(path.lstat())==_identity(info),'representative_scope_replaced')
        return raw,_identity(info)


def _write(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    info=os.fstat(fd)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(parent)
        finally:os.close(parent)
        return _identity(info)
    except BaseException:
        if path.exists() and _identity(path.lstat())==_identity(info):path.unlink()
        raise


def _process_receipt(pid):
    need(type(pid) is int and pid>=1,'representative_scope_pid')
    root=Path('/proc')/str(pid)
    # /proc stat comm may contain spaces and closing parentheses.
    fields=(root/'stat').read_text().rsplit(')',1)[1].split()
    need(len(fields)>=20 and fields[19].isdigit(),'representative_scope_birth')
    return {'start_ticks':fields[19],'netns':os.readlink(root/'ns/net'),'pidns':os.readlink(root/'ns/pid')}


def _window(phase,start_ms,cut_ms,web):
    need(type(phase) is int and 0<=phase<=13)
    need(type(start_ms) is int and type(cut_ms) is int and 0<start_ms<cut_ms<2**53
         and cut_ms-start_ms<=600000 and cut_ms<=(2**63-1)//1000000)
    if web is not None:
        need(type(web) is dict and set(web)=={'ok','positive_count','not_found_count','process_start_seconds','observed_at_seconds'} and web['ok'] is True)
        need(all(type(web[k]) is int and 1<=web[k]<=2**53-1 for k in ('positive_count','not_found_count')))
        need(all(type(web[k]) in (int,float) and math.isfinite(web[k]) and .001<=web[k]<1e12 for k in ('process_start_seconds','observed_at_seconds')))
        need(web['process_start_seconds']<=web['observed_at_seconds']<=cut_ms/1000)
    return {'phase':phase,'start_ms':start_ms,'cut_ms':cut_ms,'pair':phase//6 if phase<12 else None,
        'mode':('on' if phase%6>=3 else 'off') if phase<12 else 'outage' if phase==12 else 'recovery',
        'cohort':'1566'*9+format(phase,'04x'),'web':web}


def _mirror(driver):
    # Existing minimal driver files at its root are retained. The two new mirror
    # subtrees have an EXACT closure, so no local module can shadow an import.
    expected={}
    for name in _MIRROR:
        path=Path(name)
        for index in range(1,len(path.parts)):
            parent=Path(*path.parts[:index]);expected.setdefault(parent,set()).add(path.parts[index])
    for parent,children in expected.items():
        path=driver/parent
        need(path==path.resolve() and path.is_dir() and path.stat().st_uid==os.getuid()
             and not path.stat().st_mode&0o022 and {p.name for p in path.iterdir()}==children,'representative_mirror_closure')
    values={}
    for name in _MIRROR:
        raw,identity=_read(driver/name,private=True,maximum=1048576);values[name]=[_sha(raw),identity]
    return values


def _install_mirror(driver):
    # Only these five source-fixed files under the EXISTING /driver bind.
    root=Path(__file__).resolve().parents[2]
    for name in _MIRROR:
        path=driver/name
        path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        need(path.parent==path.parent.resolve(),'representative_mirror_parent')
        raw,_=_read(root/name,maximum=1048576)
        if path.exists() or path.is_symlink():need(_read(path,maximum=1048576)[0]==raw,'representative_mirror_changed')
        else:_write(path,raw)
    return _mirror(driver)


def mint(owner,phase,start_ms,cut_ms,web=None):
    """Controller only. One durable generation; the returned dispatch must be closed."""
    import representative_owner
    need(type(owner) is representative_owner.CompositeOwner,'representative_scope_owner')
    window=_window(phase,start_ms,cut_ms,web)
    wall_ms=int(time.time()*1000);mono=time.monotonic_ns()
    need(wall_ms-1000<=cut_ms<=wall_ms,'representative_scope_current_cut')
    base,run=owner._scope_begin(phase,start_ms,cut_ms)
    directory=run/'private'/'representative-scope';driver=run/'driver'
    dispatch=Dispatch.__new__(Dispatch)
    dispatch._Dispatch__owner=owner;dispatch._Dispatch__generation=base['generation']
    dispatch._Dispatch__directory=directory;dispatch._Dispatch__directory_identity=None
    dispatch._Dispatch__file=None;dispatch._Dispatch__closed=False
    try:
        (run/'private').mkdir(mode=0o700,parents=True,exist_ok=True)
        directory.mkdir(mode=0o700)
        dispatch._Dispatch__directory_identity=_directory(directory)
        driver.mkdir(mode=0o700,exist_ok=True)
        mirror=_install_mirror(driver)
        native=base['native']|_process_receipt(base['native']['init_pid'])
        deadline=min(base.pop('owner_deadline_ns'),mono+10*10**9)
        document={'schema':1,'kind':'representative-read-v1',**base,**window,'native':native,
            'mirror':{name:value[0] for name,value in mirror.items()},'issued_wall_ms':wall_ms,
            'issued_mono_ns':mono,'deadline_mono_ns':deadline}
        _validate(document)
        raw=_encoded(document);need(0<len(raw)<=_MAX)
        digest=_sha(raw);identity=_write(directory/_NAME,raw)
        dispatch._Dispatch__file=identity;dispatch._Dispatch__digest=digest
        dispatch._Dispatch__document=document;dispatch._Dispatch__mirror=mirror;dispatch._Dispatch__driver=driver
        owner._scope_record(base['generation'],{'file':identity,'directory':dispatch._Dispatch__directory_identity,'digest':digest})
        return dispatch
    except BaseException:
        try:dispatch.close()
        except BaseException:pass
        raise


class Dispatch:
    """Controller-only in-flight token. Digest is the sole admitted exec argument."""
    __slots__=('__owner','__generation','__directory','__directory_identity','__file','__closed',
        '__digest','__document','__mirror','__driver')
    @property
    def digest(self):return self.__digest
    def __repr__(self):return '<RepresentativeDispatch>'
    def __enter__(self):return self
    def __exit__(self,kind,error,traceback):
        if error is None:self.close()
        else:
            try:self.close()
            except BaseException:pass
        return False
    def _check(self):
        need(not self.__closed,'representative_dispatch_consumed')
        need(_directory(self.__directory)==self.__directory_identity)
        raw,identity=_read(self.__directory/_NAME,private=True)
        need(identity==self.__file and _sha(raw)==self.__digest and _mirror(self.__driver)==self.__mirror,'representative_dispatch_mutation')
        native=self.__owner._scope_check(self.__generation,self.__digest)
        need(native|_process_receipt(native['init_pid'])==self.__document['native'],'representative_dispatch_native_changed')
        _validate(self.__document)
    def execute(self):
        """Prepared finite helper verification only. No query transport/keys exist here."""
        try:
            self._check()
            raw=self.__owner._scope_exec(self.__generation,self.__digest)
            self._check()
            need(type(raw) is str and len(raw)<=1024)
            value=json.loads(raw,object_pairs_hook=_unique,parse_constant=lambda _:need(False))
            need(type(value) is dict and set(value)=={'scope_verified','generation','digest'}
                 and value['scope_verified'] is True and type(value['generation']) is int and type(value['digest']) is str)
            need(value=={'scope_verified':True,'generation':self.__generation,'digest':self.__digest},'representative_dispatch_response')
        except BaseException:
            try:self.close()
            except BaseException:pass
            raise
        self.close()
        return {'ok':True}
    def close(self):
        need(not self.__closed,'representative_dispatch_consumed')
        self.__closed=True
        # Consumption is durable before unlink. An uncertain deletion prevents the
        # next fixed pathname from being minted; recovery never retries this read.
        first=None
        try:self.__owner._scope_consume(self.__generation)
        except BaseException:first=sys.exc_info()
        try:
            if self.__file is not None:
                need(_directory(self.__directory)==self.__directory_identity)
                _,identity=_read(self.__directory/_NAME,private=True)
                need(identity==self.__file,'representative_dispatch_replacement')
                (self.__directory/_NAME).unlink()
            if self.__directory_identity is not None:
                need(_directory(self.__directory)==self.__directory_identity and not any(self.__directory.iterdir()),'representative_dispatch_directory_changed')
                self.__directory.rmdir()
        except BaseException:
            if first is None:first=sys.exc_info()
        if first is not None:raise first[1].with_traceback(first[2])


def _unique(pairs):
    result={}
    for key,value in pairs:need(key not in result);result[key]=value
    return result


def _validate(value):
    need(type(value) is dict and set(value)=={'schema','kind','generation','binding','plan_sha256','manifest_sha256','generator_sha256',
        'native','mirror','phase','start_ms','cut_ms','pair','mode','cohort','web','issued_wall_ms','issued_mono_ns','deadline_mono_ns'})
    need(type(value['schema']) is int and value['schema']==1 and value['kind']=='representative-read-v1')
    need(type(value['generation']) is int and 0<value['generation']<2**53)
    for key in ('plan_sha256','manifest_sha256','generator_sha256'):need(_hex(value[key],64))
    window=_window(value['phase'],value['start_ms'],value['cut_ms'],value['web'])
    need(all(type(value[key]) is type(item) and value[key]==item for key,item in window.items()))
    binding=value['binding'];need(type(binding) is dict and set(binding)=={'source','root','root_identity','profile','project','nonce'})
    need(type(binding['source']) is dict and set(binding['source'])=={'commit','tree'} and all(_hex(v,40) for v in binding['source'].values()))
    need(type(binding['root']) is str and binding['root'].startswith('/') and len(binding['root'])<=4096)
    identity=binding['root_identity'];need(type(identity) is dict and set(identity)=={'device','inode','uid'} and all(type(v) is int and v>=0 for v in identity.values()))
    need(binding['profile']=='representative-signoz-mcp512-v1' and type(binding['project']) is str
        and re.fullmatch('inside-observability-representative-[a-f0-9]{12}',binding['project']) is not None and _hex(binding['nonce'],32))
    native=value['native'];need(type(native) is dict and set(native)=={'cid','created','image','init_pid','start_ticks','netns','pidns'})
    need(_hex(native['cid'],64) and type(native['created']) is str and 0<len(native['created'])<=128
         and type(native['image']) is str and re.fullmatch('sha256:[a-f0-9]{64}',native['image']) is not None)
    need(type(native['init_pid']) is int and native['init_pid']>1 and type(native['start_ticks']) is str and re.fullmatch('[0-9]{1,24}',native['start_ticks']) is not None)
    for key in ('netns','pidns'):need(type(native[key]) is str and re.fullmatch(('net' if key=='netns' else 'pid')+r':\[[0-9]{1,24}\]',native[key]) is not None)
    need(type(value['mirror']) is dict and set(value['mirror'])==set(_MIRROR) and all(_hex(v,64) for v in value['mirror'].values()))
    for key in ('issued_wall_ms','issued_mono_ns','deadline_mono_ns'):need(type(value[key]) is int and 0<value[key]<2**63)
    # Wall clock checks use ONLY wall units; process budget uses ONLY monotonic ns.
    now_wall=int(time.time()*1000);now_mono=time.monotonic_ns()
    need(value['issued_wall_ms']-1000<=value['cut_ms']<=value['issued_wall_ms']<=now_wall<=value['issued_wall_ms']+10000,'representative_scope_wall_clock')
    need(value['issued_mono_ns']<=now_mono<value['deadline_mono_ns']<=value['issued_mono_ns']+10*10**9,'representative_scope_deadline')


class _Scope:
    __slots__=('__weakref__',)
    def __repr__(self):return '<VerifiedRepresentativeRead>'


def load_current(expected_digest):
    """Helper only. The expected digest MUST originate in the trusted exec argv."""
    need(_hex(expected_digest,64) and expected_digest not in _LOADED,'representative_scope_replay')
    directory_identity=_directory(_PRIVATE)
    raw,identity=_read(_PRIVATE/_NAME,private=True)
    need(_sha(raw)==expected_digest,'representative_scope_digest')
    value=json.loads(raw,object_pairs_hook=_unique,parse_constant=lambda _:need(False))
    need(_encoded(value)==raw,'representative_scope_encoding');_validate(value)
    mirror=_mirror(_DRIVER)
    need({name:item[0] for name,item in mirror.items()}==value['mirror'],'representative_scope_mirror')
    need(_process_receipt(1)=={key:value['native'][key] for key in ('start_ticks','netns','pidns')},'representative_scope_native_birth')
    # Prevent preloaded aliases from substituting query/core modules after verification.
    for name,path in (('core_layout','scripts/observability-fullstack/core_layout.py'),('signoz_queries','scripts/observability-fullstack/signoz_queries.py')):
        module=sys.modules.get(name)
        if module is not None:need(Path(module.__file__).resolve()==_DRIVER/path,'representative_scope_import_substitution')
    _LOADED.add(expected_digest)
    scope=_Scope();_SCOPES[id(scope)]=(scope,os.getpid(),threading.get_ident(),expected_digest,value,directory_identity,identity,mirror)
    return scope


def _consume(scope):
    need(type(scope) is _Scope and id(scope) in _SCOPES,'representative_scope_opaque')
    current=_SCOPES.pop(id(scope))
    value=_check_current(scope,current)
    _READERS[id(scope)]=current
    return value


def _check_reader(scope):
    need(type(scope) is _Scope and id(scope) in _READERS,'representative_scope_reader')
    return _check_current(scope,_READERS[id(scope)])


def _check_current(scope,current):
    need(current[0] is scope and current[1:3]==(os.getpid(),threading.get_ident()),'representative_scope_process')
    _,_,_,digest,value,directory_identity,identity,mirror=current
    need(_directory(_PRIVATE)==directory_identity)
    raw,now_identity=_read(_PRIVATE/_NAME,private=True)
    need(now_identity==identity and _sha(raw)==digest and _mirror(_DRIVER)==mirror,'representative_scope_changed')
    _validate(value)
    need(_process_receipt(1)=={key:value['native'][key] for key in ('start_ticks','netns','pidns')},'representative_scope_native_birth')
    return json.loads(_encoded(value))


if __name__=='__main__':
    # Prepared verification endpoint only. No reader, SQL, URL, key or native query.
    need(len(sys.argv)==2)
    scope=load_current(sys.argv[1]);value=_consume(scope)
    print(_encoded({'scope_verified':True,'generation':value['generation'],'digest':sys.argv[1]}).decode())
