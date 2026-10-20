"""Owned process contract for the source scenario; Docker/query boundaries are doubles."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pilot
import source_status_scenario as scenario
from test_source_status_scenario import FakePilot, PROJECT

role, directory, mode = sys.argv[1:]
output = Path(directory).resolve()
fake = FakePilot(output)

if role == 'worker':
    def observe(*args, **kwargs):
        if fake.changes:
            if mode == 'failure':
                raise RuntimeError('private boundary diagnostic')
            if mode == 'timeout':
                signal.pause()
            if mode == 'sigterm':
                os.kill(os.getpid(), signal.SIGTERM)
        return fake.observe(*args, **kwargs)
    scenario.run(output, fake.compose, fake.plan, command=fake.command,
                 assert_identity=fake.identity, observe=observe)
else:
    def cleanup_command(args, **_):
        if args[1] in ('container', 'volume', 'network') and args[2] == 'inspect':
            kind, identity = args[1], args[-1]
            message = ('Error response from daemon: No such container: ' + identity if kind == 'container' else
                       'Error response from daemon: get ' + identity + ': no such volume' if kind == 'volume' else
                       'Error response from daemon: network ' + identity + ' not found')
            raise subprocess.CalledProcessError(1, args, output='[]', stderr=message)
        if '--format' in args:
            return '[]'
        return ''
    pilot.command = cleanup_command
    code = pilot.supervise_worker([sys.executable, __file__, 'worker', directory, mode],
                                  fake.compose, output, PROJECT, deadline_seconds=1)
    (output / 'fixture-result.json').write_text(json.dumps({'exit_code': code}))
    sys.exit(code)
