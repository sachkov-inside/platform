"""Real supervised Mac-shaped orchestration; Docker/registry/protocol boundaries are doubles."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pilot
import orbstack

WORKER_FIXTURE_BUDGET_SECONDS = 1

role, directory, mode = sys.argv[1:]
state = Path(directory)
output = state / 'run'
backing = state / 'data.img.raw'
if role == 'parent':
    backing.write_bytes(b'backing')
identity = {'context':'orbstack','endpoint':'unix:///fixture/docker.sock','daemon_id':'fixture',
            'storage':'/var/lib/docker','backing':orbstack.backing_identity('n'+str(backing))}

def command(args, **kwargs):
    if args[:2] == ['git','-C']:
        return '' if args[-1] == '--porcelain' else 'committed-fixture'
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

def smoke(*args, **kwargs):
    if mode == 'failure':
        raise RuntimeError('fixture worker failure')
    if mode == 'timeout':
        signal.pause()
    if mode in ('sigterm','sigkill'):
        os.killpg(os.getpgrp(), signal.SIGTERM if mode == 'sigterm' else signal.SIGKILL)
    return {'native_mcp':'fixture only'}

original_supervise = pilot.supervise_worker
def supervise(execute, compose, output, project):
    return original_supervise([sys.executable,__file__,'worker',directory,mode], compose, output, project,
                              deadline_seconds=WORKER_FIXTURE_BUDGET_SECONDS)

with patch.object(pilot.platform,'system',return_value='Darwin'), patch.object(pilot.platform,'machine',return_value='arm64'), \
     patch.object(orbstack,'identify',return_value=identity), patch.object(pilot,'command',side_effect=command), \
     patch.object(pilot,'supervise_worker',side_effect=supervise), patch.object(orbstack,'verify_probe'), \
     patch.object(pilot,'install_plugin'), \
     patch.object(pilot,'smoke',side_effect=smoke):
    try:
        if role == 'parent':
            pilot.run(output)
        else:
            pilot.run_worker(output)
    except Exception:
        # The test only needs status, no private raw runtime errors.
        sys.exit(1)
