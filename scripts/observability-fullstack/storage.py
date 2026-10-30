"""Metadata-only counters for this fixture's read-only named volume mounts."""
import json
import os
from pathlib import Path
import stat

VOLUMES=('metrics','logs','traces','grafana','application-database','broker-data','caddy-data','caddy-config')
CANDIDATE_VOLUMES=('application-database','broker-data','caddy-data','caddy-config',
    'sig-ch-data','sig-keeper-data','sig-keeper-default-data','sig-pg-data','sig-histogram','sig-probe','sig-gateway')
MAX_ENTRIES=100_000


def measure(root, *, limit=MAX_ENTRIES):
    if root.is_symlink() or not root.is_dir():raise ValueError('owned_volume_directory_required')
    result={'entries':0,'unique_inodes':0,'files':0,'directories':0,'symlinks':0,'logical_file_bytes':0,'allocated_bytes':0,'vanished_entries':0}
    seen=set();examined=0
    def walk(descriptor,depth):
        nonlocal examined
        if depth>128:raise ValueError('volume_metadata_budget')
        def count(info):
            result['entries']+=1
            if stat.S_ISLNK(info.st_mode):result['symlinks']+=1
            elif stat.S_ISDIR(info.st_mode):result['directories']+=1
            elif stat.S_ISREG(info.st_mode):result['files']+=1
            else:return
            identity=(info.st_dev,info.st_ino)
            if identity in seen:return
            seen.add(identity);result['unique_inodes']+=1
            result['allocated_bytes']+=info.st_blocks*512
            if stat.S_ISREG(info.st_mode):result['logical_file_bytes']+=info.st_size
        examined+=1
        if examined>limit:raise ValueError('volume_metadata_budget')
        count(os.fstat(descriptor))
        with os.scandir(descriptor) as entries:
            for item in entries:
                if examined>=limit:raise ValueError('volume_metadata_budget')
                try:
                    info=os.stat(item.name,dir_fd=descriptor,follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        child=os.open(item.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
                        try:walk(child,depth+1)
                        finally:os.close(child)
                    else:
                        examined+=1;count(info)
                except FileNotFoundError:
                    # Native stores compact/delete concurrently. Missing entries add no bytes;
                    # record this explicitly rather than follow a replacement or invent zero usage.
                    examined+=1;result['vanished_entries']+=1
    descriptor=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:walk(descriptor,0)
    finally:os.close(descriptor)
    fs=os.statvfs(root)
    return {**result,'filesystem_inodes_total':fs.f_files,'filesystem_inodes_available':fs.f_favail}


def configure(output,plan):
    images=json.loads((Path(__file__).resolve().parents[2]/'infra/observability/umami/inputs.lock.json').read_text())['images']
    if any(name not in plan['volumes'] for name in VOLUMES):raise ValueError('complete_owned_volumes_required')
    plan['services']['volume-reader']={'image':images['python'],'pull_policy':'never','user':'0:0','read_only':True,
        'cap_drop':['ALL'],'cap_add':['DAC_READ_SEARCH'],'security_opt':['no-new-privileges:true'],'network_mode':'none',
        'mem_limit':'64m','cpus':.25,'pids_limit':64,'logging':{'driver':'none'},'environment':{'PYTHONDONTWRITEBYTECODE':'1'},
        'command':['python','/pilot/storage.py'],'volumes':[str(Path(__file__).resolve())+':/pilot/storage.py:ro',
            *(name+':/volumes/'+name+':ro' for name in VOLUMES)]}


def read_mounted(root):
    """Select one complete literal mount catalogue; never infer extra authority."""
    if root.is_symlink() or not root.is_dir():raise ValueError('owned_mount_catalogue')
    with os.scandir(root) as entries:
        names={entry.name for entry in entries}
    catalogue=next((catalogue for catalogue in (VOLUMES,CANDIDATE_VOLUMES) if names==set(catalogue)),None)
    if catalogue is None:raise ValueError('owned_mount_catalogue')
    return {name:measure(root/name) for name in catalogue}


if __name__=='__main__':
    print(json.dumps(read_mounted(Path('/volumes')),allow_nan=False))

FIELDS={'entries','unique_inodes','files','directories','symlinks','logical_file_bytes','allocated_bytes','filesystem_inodes_total','filesystem_inodes_available','vanished_entries'}
DATABASES=('inside','umami','logto','inside_telegram')


def validate_volumes(value):
    if type(value) is not dict or set(value)!=set(VOLUMES):raise ValueError('owned_volume_counters')
    for row in value.values():
        if (type(row) is not dict or set(row)!=FIELDS
                or any(type(number) is not int or not 0<=number<2**63 for number in row.values())
                or row['filesystem_inodes_available']>row['filesystem_inodes_total']):raise ValueError('owned_volume_counters')
    return value


def observe(compose,invoke,sql):
    volumes=validate_volumes(json.loads(invoke(compose,['run','--rm','--no-deps','volume-reader'],timeout=10)))
    databases=json.loads(sql(compose,"SELECT json_object_agg(datname,pg_database_size(oid)) FROM pg_database WHERE datname IN ('inside','umami','logto','inside_telegram');",timeout=10))
    if (type(databases) is not dict or set(databases)!=set(DATABASES)
            or any(type(number) is not int or not 0<number<2**63 for number in databases.values())):raise ValueError('owned_database_counters')
    return {'volumes':volumes,'database_bytes':databases}
