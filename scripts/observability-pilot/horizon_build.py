"""Pinned static guard acquisition, in the registered owner's existing build lifetime."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import tarfile

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'infra/observability/horizon'
sys.path.insert(0,str(ROOT/'scripts/heavy-check'))
from bounded import execute

MAX_SDK_UNPACKED=512*1024**2
BUILD_SECONDS=120
VERSION='go1.26.4'


def inputs():
    return {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted([*SOURCE.glob('*.go'), SOURCE/'go.mod', SOURCE/'go.sum',
                            SOURCE/'toolchain.lock.json', SOURCE/'metricsql-security.patch',
                            SOURCE/'metricsql-security.lock.json', Path(__file__), ROOT/'scripts/heavy-check/bounded.py'])}


def architecture():
    value={'arm64':'arm64','aarch64':'arm64','x86_64':'amd64','amd64':'amd64'}.get(platform.machine())
    if value is None:raise ValueError('horizon_architecture')
    return value


def prepare(output):
    directory=output/'horizon'
    directory.mkdir(mode=0o700)
    manifest={'schema':1,'toolchain':VERSION,'target_os':'linux','target_architecture':architecture(),'inputs':inputs()}
    (directory/'source.json').write_text(json.dumps(manifest,sort_keys=True)+'\n')
    (directory/'source.json').chmod(0o600)


def verify(output):
    directory=output/'horizon'
    if directory.is_symlink() or (directory/'source.json').is_symlink():raise ValueError('horizon_owner_path')
    manifest=json.loads((directory/'source.json').read_text())
    expected={'schema':1,'toolchain':VERSION,'target_os':'linux','target_architecture':architecture(),'inputs':inputs()}
    if manifest!=expected:raise ValueError('horizon_source_changed')
    binary=directory/'guard'
    binding=directory/'binary.json'
    if binary.is_symlink() or binding.is_symlink() or not binary.is_file() or not 0<binary.stat().st_size<=32*1024**2:
        raise ValueError('horizon_binary')
    wanted={**manifest,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
    if json.loads(binding.read_text())!=wanted or binary.stat().st_mode&0o777!=0o500:raise ValueError('horizon_binary_changed')
    return wanted


def unpack_sdk(raw,destination):
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        entries=archive.getmembers()
        if sum(item.size for item in entries)>MAX_SDK_UNPACKED:raise ValueError('horizon_sdk_size')
        for item in entries:
            path=(destination/item.name).resolve()
            if not path.is_relative_to(destination.resolve()) or not (item.isdir() or item.isfile()):
                raise ValueError('horizon_sdk_path')
        for item in entries:
            path=destination/item.name
            if item.isdir():path.mkdir(mode=0o700,parents=True,exist_ok=True)
            else:
                path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                with archive.extractfile(item) as source,path.open('xb') as target:shutil.copyfileobj(source,target)
                path.chmod(0o700 if item.mode&0o111 else 0o600)


def parser_overlay(directory):
    """Apply only the recorded exact-source security patch, with no fuzzy hunks."""
    lock=json.loads((SOURCE/'metricsql-security.lock.json').read_text())
    if lock['module']!='github.com/VictoriaMetrics/metricsql' or lock['version']!='v0.87.5':
        raise ValueError('horizon_parser_module')
    upstream=directory/'mod/github.com/!victoria!metrics/metricsql@v0.87.5/parser.go'
    raw=upstream.read_bytes()
    patch=(SOURCE/'metricsql-security.patch').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=lock['source_sha256'] or hashlib.sha256(patch).hexdigest()!=lock['patch_sha256']:
        raise ValueError('horizon_parser_source')
    original=raw.decode().splitlines(keepends=True)
    lines=patch.decode().splitlines(keepends=True)
    if lines[:2]!=['--- parser.go\n','+++ parser.go\n']:raise ValueError('horizon_parser_patch')
    result=[];position=0;index=2
    while index<len(lines):
        match=re.fullmatch(r'@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@\n',lines[index])
        if match is None:raise ValueError('horizon_parser_hunk')
        beginning=int(match[1])-1
        if beginning<position:raise ValueError('horizon_parser_hunk')
        result.extend(original[position:beginning]);position=beginning;index+=1
        while index<len(lines) and not lines[index].startswith('@@ '):
            line=lines[index];index+=1
            if line[0] in ' -':
                if position>=len(original) or original[position]!=line[1:]:raise ValueError('horizon_parser_context')
                position+=1
            if line[0] in ' +':result.append(line[1:])
            elif line[0]!='-':raise ValueError('horizon_parser_patch')
    result.extend(original[position:])
    patched=directory/'parser-security.go';patched.write_text(''.join(result));patched.chmod(0o600)
    overlay=directory/'overlay.json'
    overlay.write_text(json.dumps({'Replace':{str(upstream):str(patched)}})+'\n');overlay.chmod(0o600)
    return overlay


def build(output,download,*,run=execute,check=False):
    directory=output/'horizon'
    expected={'schema':1,'toolchain':VERSION,'target_os':'linux','target_architecture':architecture(),'inputs':inputs()}
    if directory.is_symlink() or json.loads((directory/'source.json').read_text())!=expected:raise ValueError('horizon_source_changed')
    if (directory/'binary.json').exists():return verify(output)
    host={'Darwin':'darwin','Linux':'linux'}.get(platform.system())
    if host is None:raise ValueError('horizon_host')
    target=directory/'guard'
    try:
        go=shutil.which('go')
        wanted=f'go version {VERSION} {host}/{architecture()}\n'.encode()
        if go is None or run(['/usr/bin/env','GOENV=off','GOTOOLCHAIN=local',go,'version'],timeout=5)!=wanted:
            lock=json.loads((SOURCE/'toolchain.lock.json').read_text())
            if lock['version']!=VERSION:raise ValueError('horizon_toolchain_version')
            asset=next(item for item in lock['assets'] if item['os']==host and item['architecture']==architecture())
            raw=download(asset)
            if len(raw)!=asset['size_bytes'] or 'sha256:'+hashlib.sha256(raw).hexdigest()!=asset['digest']:raise ValueError('horizon_sdk_digest')
            sdk=directory/'sdk';sdk.mkdir(mode=0o700);unpack_sdk(raw,sdk);go=str(sdk/'go/bin/go')
            if run(['/usr/bin/env','GOENV=off','GOTOOLCHAIN=local',go,'version'],timeout=5)!=wanted:raise ValueError('horizon_toolchain_version')
        for name in ('cache','mod','tmp','home'):(directory/name).mkdir(mode=0o700)
        environment={'GOENV':'off','CGO_ENABLED':'0','GOOS':'linux','GOARCH':architecture(),'GOTOOLCHAIN':'local',
            'GOFLAGS':'-mod=readonly -modcacherw','GOPROXY':'https://proxy.golang.org','GOSUMDB':'sum.golang.org',
            'GOCACHE':str(directory/'cache'),'GOMODCACHE':str(directory/'mod'),'TMPDIR':str(directory/'tmp'),
            'HOME':str(directory/'home'),'GOMAXPROCS':'2','GOMEMLIMIT':'256MiB'}
        prefix=['/usr/bin/env',*(key+'='+value for key,value in environment.items()),go,'-C',str(SOURCE)]
        run([*prefix,'mod','download'],timeout=BUILD_SECONDS)
        overlay=parser_overlay(directory)
        run([*prefix,'build','-overlay='+str(overlay),'-trimpath','-buildvcs=false','-ldflags=-s -w','-o',str(target),'.'],timeout=BUILD_SECONDS)
        if check:
            test_environment={**environment,'GOOS':host}
            run(['/usr/bin/env',*(key+'='+value for key,value in test_environment.items()),go,'-C',str(SOURCE),
                 'test','-overlay='+str(overlay),'-count=1','-timeout=20s','./...'],timeout=BUILD_SECONDS)
        target.chmod(0o500)
        binding={**expected,'binary_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        (directory/'binary.json').write_text(json.dumps(binding,sort_keys=True)+'\n');(directory/'binary.json').chmod(0o600)
        return verify(output)
    except BaseException:
        target.unlink(missing_ok=True);(directory/'binary.json').unlink(missing_ok=True);raise
    finally:
        primary=sys.exc_info()[1]
        cleanup_failed=False
        for name in ('cache','mod','tmp','home','sdk','parser-security.go','overlay.json'):
            path=directory/name
            try:
                if path.is_file() and not path.is_symlink():path.unlink()
                elif path.exists() and not path.is_symlink():
                    for child in path.rglob('*'):
                        if child.is_dir() and not child.is_symlink():child.chmod(0o700)
                    path.chmod(0o700);shutil.rmtree(path)
            except OSError:cleanup_failed=True
        if cleanup_failed:
            target.unlink(missing_ok=True);(directory/'binary.json').unlink(missing_ok=True)
            if primary is None:raise RuntimeError('horizon_build_cleanup_failed')


def main():
    import argparse
    import pilot
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('test',))
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    output=args.output.resolve();output.mkdir(mode=0o700,exist_ok=False)
    prepare(output)
    result=build(output,pilot.downloaded_asset,check=True)
    print(json.dumps({'source_bound_guard_tests':'passed','target_architecture':result['target_architecture'],
                      'binary_sha256':result['binary_sha256']}))


if __name__=='__main__':main()
