"""Build a disposable recovery foundation and bind its exact local identity to source.

The receipt is local evidence, never a published image or permission to deploy.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
import recovery

INPUTS=(*recovery.FOUNDATION_INPUTS,'infra/production/database/libpq-version.c')
INSPECT='{"id":{{json .Id}},"architecture":{{json .Architecture}},"os":{{json .Os}},"source":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'


def hashes():
    return {name:hashlib.sha256((recovery.ROOT/name).read_bytes()).hexdigest() for name in INPUTS}


def version():
    matches=re.findall(r'pgbackrest/releases/download/release/([0-9]+\.[0-9]+\.[0-9]+)/',
        (recovery.ROOT/'infra/production/database/Dockerfile').read_text())
    if len(matches)!=1:raise ValueError('foundation_version_source')
    return matches[0]


def validate(raw):
    if (type(raw) is not dict or set(raw)!={'schema','image','cache_owner','source','architecture','inputs','pgbackrest_version'}
            or type(raw['schema']) is not int or raw['schema']!=2
            or type(raw['image']) is not str or re.fullmatch(r'sha256:[a-f0-9]{64}',raw['image']) is None
            or type(raw['source']) is not str or re.fullmatch(r'[a-f0-9]{40}',raw['source']) is None
            or type(raw['cache_owner']) is not str or re.fullmatch(r'inside-observability-recovery-foundation-[a-f0-9]{12}-[a-f0-9]{12}:local',raw['cache_owner']) is None
            or raw['architecture'] not in ('arm64','amd64') or raw['inputs']!=hashes()
            or raw['pgbackrest_version']!=version()):
        raise ValueError('foundation_cache_source_or_identity')
    return raw


def command(args):
    return subprocess.run(args,cwd=recovery.ROOT,check=True,capture_output=True,text=True,timeout=600).stdout


def build(output,*,execute=command):
    output=Path(output)
    if output.exists() or output.is_symlink():raise ValueError('foundation_receipt_exists')
    source=execute(['git','rev-parse','HEAD']).strip()
    if re.fullmatch(r'[a-f0-9]{40}',source) is None:raise ValueError('foundation_source')
    if execute(['git','status','--porcelain','--','infra/production/database']).strip():
        raise ValueError('foundation_source_dirty')
    before=hashes()
    tag='inside-observability-recovery-foundation-'+source[:12]+'-'+uuid.uuid4().hex[:12]+':local'
    execute(['docker','build','--label','org.opencontainers.image.revision='+source,'--tag',tag,'infra/production/database'])
    actual=json.loads(execute(['docker','image','inspect',tag,'--format',INSPECT]))
    if (type(actual) is not dict or set(actual)!={'id','architecture','os','source'}
            or actual['source']!=source or actual['os']!='linux' or hashes()!=before
            or execute(['git','rev-parse','HEAD']).strip()!=source
            or execute(['git','status','--porcelain','--','infra/production/database']).strip()):
        raise ValueError('foundation_build_identity_changed')
    result=validate({'schema':2,'image':actual['id'],'cache_owner':tag,'source':source,
        'architecture':actual['architecture'],'inputs':before,'pgbackrest_version':version()})
    output.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(result,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:
        result=build(args.output)
        print(json.dumps({'state':'prepared','image':result['image'],'source':result['source'],'architecture':result['architecture']}))
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        raise SystemExit('foundation preparation failed; no recovery acquisition permitted') from None
