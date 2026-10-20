"""Owned process contract for the source scenario; Docker/query boundaries are doubles."""
from contextlib import nullcontext
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
            (output / 'boundary-entered').write_text('ready')
            if mode in ('failure', 'cli_failure'):
                raise RuntimeError('private boundary diagnostic ' + str(output / 'private-config-sentinel'))
            if mode in ('timeout', 'outer_timeout', 'assertion_failure'):
                signal.pause()
            if mode == 'sigterm':
                os.kill(os.getpid(), signal.SIGTERM)
        return fake.observe(*args, **kwargs)
    if mode.startswith('cli_'):
        images = json.loads((pilot.CONFIG / 'inputs.lock.json').read_text())['images']
        fake.plan = pilot.compose_plan(pilot.CONFIG, output, images,
                                      credential_owner=(os.getuid(), os.getgid()))
        def command(args, **kwargs):
            if args[:6] == fake.compose and args[6] in ('config', 'up'):
                return ''
            if mode == 'cli_command_failure' and fake.changes:
                raise subprocess.CalledProcessError(7, ['docker', '--config', str(output / 'private-config-sentinel')],
                                                    output='private-output-sentinel', stderr='private-error-sentinel')
            return fake.command(args, **kwargs)
        pilot.command = command
        pilot.assert_docker_identity = fake.identity
        pilot.install_plugin = lambda *_: None
        pilot.worker_storage_guard = lambda *_: nullcontext()
        pilot.smoke = lambda *_: {}
        scenario.source_status_query.read_report = observe
        sys.argv = ['pilot.py', 'worker', '--output', str(output)]
        sys.exit(pilot.cli())
    else:
        scenario.run(output, fake.compose, fake.plan, command=fake.command,
                     assert_identity=fake.identity, observe=observe)
else:
    if mode.startswith('cli_'):
        (output / 'owner.json').write_text(json.dumps({'supervisor_pid': os.getpid(), 'project': PROJECT}))
        (output / 'auth.json').write_text(json.dumps({'users': [{'bearer_token': 'private-token-sentinel'}]}))
        (output / 'auth.json').chmod(0o600)
        (output / 'evidence.json').write_text('{}')
    def interrupt(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
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
