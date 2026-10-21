"""Tracking-owned bounded first-observed failure phases, separate from native error categories."""
import json
import os
from pathlib import Path
import re
import stat
import tempfile

NAME = 'tracking-producer-phase.json'
MAX_BYTES = 512
PHASES = ('input_validation','hooks_setup','imports','migration','prisma_acquisition','provider_acquisition',
          'configuration','api_acquisition','api_listen','http_request','http_contract','carrier_check',
          'delivery_wait','delivery_contract','api_shutdown','prisma_shutdown','module_map','result_ready',
          'cleanup_api','cleanup_prisma','cleanup_provider','cleanup_hooks')
_FIELDS = {'schema','scope','source','state','phase','reason'}
_SOURCE_FIELDS = {'checkout_sha','checkout_tree','repository','run_id','run_attempt','event',
                  'provider_execution_sha','provider_pr_head_sha','provider_pr_base_sha','inputs','scope'}


def _refuse(*_):
    raise ValueError('closed tracking phase refused') from None


def _sha(value, width):
    return type(value) is str and re.fullmatch('[0-9a-f]{'+str(width)+'}',value) is not None


def validate(value, *, source):
    if (not _sha(source,40) or type(value) is not dict or any(type(key) is not str for key in value)
            or set(value) != _FIELDS or type(value['schema']) is not int or value['schema'] != 1
            or any(type(value[key]) is not str for key in _FIELDS-{'schema'})
            or value['scope'] != 'tracking' or value['source'] != source):
        _refuse()
    state,name,reason = value['state'],value['phase'],value['reason']
    if not ((state in ('running','failed') and name in PHASES and name != 'result_ready'
             and reason == ('none' if state == 'running' else 'operation_failed'))
            or (state == 'completed' and name == 'result_ready' and reason == 'none')
            or (state == 'unknown' and name == 'unknown' and reason == 'unavailable')
            or (state == 'refused' and name == 'unknown' and reason == 'contract')):
        _refuse()
    return {key:value[key] for key in sorted(_FIELDS)}


def _projection(source, state='unknown'):
    return validate(dict(schema=1,scope='tracking',source=source,state=state,phase='unknown',
                         reason='unavailable' if state == 'unknown' else 'contract'),source=source)


def _object(pairs):
    result={}
    for key,value in pairs:
        if key in result: _refuse()
        result[key]=value
    return result


def _decode(raw):
    try:
        return json.loads(raw.decode('utf-8'),object_pairs_hook=_object,parse_constant=_refuse)
    except (ValueError,TypeError,UnicodeError,RecursionError,OverflowError):
        _refuse()


def _identity(info):
    return (info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode,info.st_nlink,
            info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def _directory(path):
    parent=path.parent
    if not parent.is_absolute() or parent.resolve() != parent: _refuse()
    try:before=os.lstat(parent)
    except OSError:_refuse()
    if not stat.S_ISDIR(before.st_mode) or before.st_uid != os.getuid() or before.st_mode & 0o777 != 0o700:
        _refuse()
    descriptor=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        if _identity(before) != _identity(os.fstat(descriptor)) or _identity(before) != _identity(os.lstat(parent)):
            _refuse()
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor



def _same_directory(descriptor,path,initial):
    try:
        held=os.fstat(descriptor);named=os.lstat(path.parent)
        if (not stat.S_ISDIR(held.st_mode) or held.st_uid!=os.getuid() or held.st_mode & 0o777!=0o700
                or (held.st_dev,held.st_ino,held.st_uid,held.st_gid,held.st_mode)!=(initial.st_dev,initial.st_ino,initial.st_uid,initial.st_gid,initial.st_mode)
                or _identity(held)!=_identity(named)):_refuse()
    except OSError:_refuse()


def _read_bytes(path,cap,*,mode=0o600):
    descriptor=directory=None;present=False
    try:
        directory=_directory(path)
        directory_info=os.fstat(directory)
        before=os.stat(path.name,dir_fd=directory,follow_symlinks=False)
        present=True
        descriptor=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
        info=os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or (mode is not None and info.st_mode & 0o777 != mode) or info.st_size > cap
                or _identity(before) != _identity(info)):
            _refuse()
        chunks=[];remaining=cap+1
        while remaining:
            chunk=os.read(descriptor,remaining)
            if not chunk:break
            chunks.append(chunk);remaining-=len(chunk)
        raw=b''.join(chunks)
        if (len(raw)>cap or _identity(info)!=_identity(os.fstat(descriptor))
                or _identity(info)!=_identity(os.stat(path.name,dir_fd=directory,follow_symlinks=False))):
            _refuse()
        _same_directory(directory,path,directory_info)
        return raw
    except FileNotFoundError:
        if present:_refuse()
        raise
    finally:
        try:
            if descriptor is not None:os.close(descriptor)
        finally:
            if directory is not None:os.close(directory)


def read(path, *, source):
    if Path(path).name not in (NAME,'phase.json'): _refuse()
    try: return validate(_decode(_read_bytes(Path(path),MAX_BYTES)),source=source)
    except FileNotFoundError:return _projection(source)
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError,OverflowError):_refuse()


def read_child(path, *, source):
    if Path(path).name != 'phase.json':_refuse()
    # Missing is not a child state. Only the parent may project absence.
    try:value=validate(_decode(_read_bytes(Path(path),MAX_BYTES)),source=source)
    except FileNotFoundError:raise
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError,OverflowError):_refuse()
    if value['state'] not in ('running','failed','completed'):_refuse()
    return value


def write(path,value,*,source):
    path=Path(path)
    if path.name not in (NAME,'phase.json'): _refuse()
    raw=(json.dumps(validate(value,source=source),sort_keys=True,separators=(',',':'))+'\n').encode()
    if len(raw)>MAX_BYTES:_refuse()
    directory=descriptor=None;created=None
    try:
        directory=_directory(path)
        directory_info=os.fstat(directory)
        descriptor=os.open('phase.json.new',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
        created=os.fstat(descriptor)
        offset=0
        while offset<len(raw):
            count=os.write(descriptor,raw[offset:])
            if count<=0:_refuse()
            offset+=count
        final=os.fstat(descriptor)
        if (not stat.S_ISREG(final.st_mode) or final.st_mode & 0o777 != 0o600
                or final.st_uid != os.getuid() or final.st_nlink != 1 or final.st_size != len(raw)
                or _identity(final)!=_identity(os.stat('phase.json.new',dir_fd=directory,follow_symlinks=False))):_refuse()
        os.close(descriptor);descriptor=None
        try:
            existing=os.stat(path.name,dir_fd=directory,follow_symlinks=False)
        except FileNotFoundError:existing=None
        if existing is not None and (not stat.S_ISREG(existing.st_mode) or existing.st_uid!=os.getuid()
                or existing.st_mode & 0o777 != 0o600 or existing.st_nlink!=1):_refuse()
        if _identity(final)!=_identity(os.stat('phase.json.new',dir_fd=directory,follow_symlinks=False)):_refuse()
        _same_directory(directory,path,directory_info)
        os.replace('phase.json.new',path.name,src_dir_fd=directory,dst_dir_fd=directory)
        created=None
    except (OSError,ValueError,TypeError):_refuse()
    finally:
        try:
            if descriptor is not None:os.close(descriptor)
        finally:
            try:
                if created is not None and directory is not None:
                    try:current=os.stat('phase.json.new',dir_fd=directory,follow_symlinks=False)
                    except FileNotFoundError:current=None
                    if (current is not None and stat.S_ISREG(current.st_mode) and current.st_nlink==1
                            and current.st_uid==created.st_uid and current.st_gid==created.st_gid
                            and current.st_mode & 0o777==0o600 and (current.st_dev,current.st_ino)==(created.st_dev,created.st_ino)):
                        os.unlink('phase.json.new',dir_fd=directory)
            finally:
                if directory is not None:os.close(directory)


def source_from_metadata(metadata):
    try:
        value=_decode(_read_bytes(Path(metadata)/'source.json',1_048_576,mode=None))
        if (type(value) is not dict or set(value)!=_SOURCE_FIELDS
                or not _sha(value['checkout_sha'],40) or not _sha(value['checkout_tree'],40)
                or value['provider_execution_sha']!=value['checkout_sha']
                or type(value['provider_execution_sha']) is not str or type(value['scope']) is not str):_refuse()
        for key in ('repository','run_id','run_attempt','event'):
            if value[key] is not None and type(value[key]) is not str:_refuse()
        for key in ('provider_pr_head_sha','provider_pr_base_sha'):
            if value[key] is not None and not _sha(value[key],40):_refuse()
        inputs=value['inputs']
        if (type(inputs) is not dict or len(inputs)>10000
                or any(type(key) is not str or len(key.encode('utf-8'))>1024 or not _sha(item,64)
                       for key,item in inputs.items())):_refuse()
        return value['checkout_sha']
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError,OverflowError):_refuse()


def load_for_collection(output,*,source):
    return read(Path(output)/NAME,source=source)


class OwnedTrackingPhase:
    def __init__(self,output,*,source):
        _projection(source)
        self.output,self.source=Path(output),source

    def __enter__(self):
        self.directory=tempfile.TemporaryDirectory(prefix='inside-tracking-producer-phase-')
        self.path=Path(self.directory.name).resolve()/'phase.json'
        return self

    def environment(self,originalEnvironment):
        return {**originalEnvironment,'INSIDE_TRACKING_PRODUCER_PHASE_PATH':str(self.path),
                'INSIDE_TRACKING_PRODUCER_PHASE_SOURCE':self.source}

    def __exit__(self,kind,error,traceback):
        secondary=None
        observed_secondary=False
        try:
            try:value=read_child(self.path,source=self.source)
            except FileNotFoundError:
                observed_secondary=True
                value=_projection(self.source)
            except (OSError,ValueError):
                observed_secondary=True
                value=_projection(self.source,'refused')
            write(self.output/NAME,value,source=self.source)
            if value['state'] in ('refused','failed') and error is None:_refuse()
        except BaseException as failure:secondary=failure
        finally:
            try:self.directory.cleanup()
            except BaseException as failure:
                if secondary is None:secondary=failure
        if error is not None:
            if secondary is not None or observed_secondary:raise BaseException.with_traceback(error,traceback)
            return False
        if secondary is not None:raise secondary
        return False
