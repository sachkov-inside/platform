"""Real supervised Mac-shaped orchestration; Docker/registry/protocol boundaries are doubles."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pilot
import orbstack
import source_status_scenario

WORKER_FIXTURE_BUDGET_SECONDS = 1

role, directory, mode = sys.argv[1:]
state = Path(directory)
output = state / 'run'
backing = state / 'data.img.raw'
if role == 'parent':
    backing.write_bytes(b'backing')
identity = {'context':'orbstack','endpoint':'unix:///fixture/docker.sock','daemon_id':'fixture',
            'storage':'/var/lib/docker','socket_device':1,'socket_inode':2,'backing':orbstack.backing_identity('n'+str(backing))}

def command(args, **kwargs):
    if args[:2] == ['git','-C']:
        return '' if args[-1] == '--porcelain' else 'a'*40
    if args[1:3] == ['context','show']:
        return 'orbstack'
    if args[1:3] == ['compose','ls']:
        return '[]'
    if 'exec' in args:
        with (output/'fresh-requests').open('a') as requests:
            requests.write(args[-1]+'\n')
        return subprocess.run([sys.executable,str(Path(__file__).with_name('process.py')),
                               'fresh-stat',str(output),args[-1]], check=True,capture_output=True,
                               text=True,timeout=kwargs['timeout']).stdout
    if 'pull' in args:
        return ''
    if 'up' in args:
        (output/'owned-probe').write_text('probe')
        if 'storage-probe' not in args:
            (output/'owned-core').write_text('core')
        return ''
    if 'down' in args:
        (output/'owned-probe').unlink(missing_ok=True)
        (output/'owned-core').unlink(missing_ok=True)
        return ''
    if '--format' in args:
        return json.dumps([{'Service':'storage-probe','State':'running','ExitCode':0}])
    if (output/'owned-probe').exists() or (output/'owned-core').exists():
        return 'owned resource'
    return ''

def smoke(*args, timing=None):
    for name in pilot.core_timing.STAGES[3:21]:
        with timing.stage(name):
            if name=='trace_logging':
                if mode == 'failure':raise RuntimeError('fixture worker failure')
                if mode == 'timeout':signal.pause()
                if mode in ('sigterm','sigkill'):
                    os.killpg(os.getpgrp(), signal.SIGTERM if mode == 'sigterm' else signal.SIGKILL)
    return {'native_mcp':'fixture only'}


# Disk belongs to this process fixture, just like Docker/registry/protocol inputs.
# Keep the real production admission/stopping policy; exercise refusal separately.
disk_total = 100 * 1024**3
disk_free = (1 if mode == 'low_disk' else 80) * 1024**3
disk_sample = SimpleNamespace(total=disk_total, free=disk_free, used=disk_total-disk_free)

# This process fixture owns orchestration/cleanup with protocol doubles.
# Source-outage behavior has its own injected Docker/query/clock seam contracts.
original_supervise = pilot.supervise_worker
def supervise(execute, compose, output, project, *, pass_fds=()):
    return original_supervise([sys.executable,__file__,'worker',directory,mode], compose, output, project,
                              deadline_seconds=WORKER_FIXTURE_BUDGET_SECONDS, pass_fds=pass_fds)

@contextmanager
def forwarded_descriptor():
    descriptor = None
    marker = state/'forwarded-marker'
    metadata = state/'forwarded-fd'
    try:
        if mode == 'success' and role == 'parent':
            with os.fdopen(os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as stream:
                stream.write(b'F')
            descriptor = os.open(marker,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
            if os.get_inheritable(descriptor):raise RuntimeError('fixture descriptor must start non-inheritable')
            with os.fdopen(os.open(metadata,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as stream:
                stream.write(str(descriptor))
        elif mode == 'success' and role == 'worker':
            with os.fdopen(os.open(metadata,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:
                    raise RuntimeError('fixture descriptor metadata refused')
                raw = stream.read(11)
            if not 1<=len(raw)<=10 or not raw.isdigit():raise RuntimeError('fixture descriptor metadata refused')
            candidate = int(raw)
            if candidate<=2:raise RuntimeError('fixture descriptor identity refused')
            expected = marker.lstat();actual = os.fstat(candidate)
            if (not stat.S_ISREG(expected.st_mode) or not stat.S_ISREG(actual.st_mode)
                    or expected.st_uid!=os.getuid() or expected.st_size!=1
                    or (actual.st_dev,actual.st_ino,actual.st_uid)!=(expected.st_dev,expected.st_ino,expected.st_uid)):
                raise RuntimeError('fixture descriptor identity refused')
            # Only the actual constructor-owned inherited file may be read or closed.
            descriptor = candidate
            if os.read(descriptor,2)!=b'F':raise RuntimeError('fixture descriptor byte refused')
        yield (descriptor,) if descriptor is not None and role=='parent' else ()
    finally:
        if descriptor is not None:os.close(descriptor)


with forwarded_descriptor() as pass_fds, patch.object(pilot.platform,'system',return_value='Darwin'), patch.object(pilot.platform,'machine',return_value='arm64'), \
     patch.object(orbstack,'identify',return_value=identity), patch.object(pilot,'command',side_effect=command), \
     patch.object(pilot,'supervise_worker',side_effect=supervise), patch.object(orbstack,'verify_probe'), \
     patch.object(pilot,'install_plugin'), \
     patch.object(pilot.shutil,'disk_usage',return_value=disk_sample), \
     patch.object(pilot,'smoke',side_effect=smoke), \
     patch.object(source_status_scenario, 'run', return_value={'state':'fixture only', 'duration_seconds':0}):
    try:
        if role == 'parent':
            # Fake Compose does not publish ports; keep this process contract off live pilot ports.
            if pass_fds:pilot.run(output, ports=(0,), worker_pass_fds=pass_fds)
            else:pilot.run(output, ports=(0,))
        else:
            pilot.run_worker(output)
    except Exception:
        # The test only needs status, no private raw runtime errors.
        sys.exit(1)
