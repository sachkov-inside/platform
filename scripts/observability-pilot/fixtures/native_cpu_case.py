"""CPU contract command tree under the repository's independent stdlib supervisor."""
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).with_name('mcp_cpu.py')
FACT_DEADLINE_SECONDS = 5
POLL_INTERVAL_SECONDS = .01
NATIVE_RESPONSE_TIMEOUT_SECONDS = 1

if sys.argv[1] == 'supervise':
    descriptor, parent = int(sys.argv[2]), sys.argv[3]
    if descriptor != 3:
        os.dup2(descriptor, 3)
        os.close(descriptor)
    owned = ROOT / 'scripts/owned-process.py'
    sys.argv = [str(owned), json.dumps([sys.executable, __file__, 'case', *sys.argv[4:]]), parent]
    runpy.run_path(str(owned), run_name='__main__')
    sys.exit(1)

sys.path.insert(0, str(SCRIPTS))
import pilot
import native_cpu

mode, directory = sys.argv[2:]
state = Path(directory)
environment = {**os.environ, 'MCP_CPU_FIXTURE_STATE': str(state / 'native.json')}
native = [sys.executable, '-I', '-S', str(FIXTURE)]
if mode == 'concurrent':
    gate = state / 'gate'
    unrelated = subprocess.Popen([*native, 'burn'])
    def release():
        unrelated.wait(timeout=FACT_DEADLINE_SECONDS)
        gate.touch()
    releaser = threading.Thread(target=release)
    releaser.start()
    try:
        def no_private_pipe(result):
            if result.get('private_pipe_fds') != []:
                raise RuntimeError('native inherited private descriptor')
        result = pilot.stdio_probe(sys.executable, environment, 'query', {}, 'known-fixture',
                                   argv=[*native, 'normal', str(gate)], validate_result=no_private_pipe)
        print(json.dumps(result), flush=True)
    finally:
        if unrelated.poll() is None:
            unrelated.kill()
        unrelated.wait(timeout=FACT_DEADLINE_SECONDS)
        releaser.join(timeout=FACT_DEADLINE_SECONDS)
elif mode == 'error':
    with native_cpu.measured_process([*native, 'error'], environment) as (child, measurement):
        child.wait(timeout=FACT_DEADLINE_SECONDS)
    print(json.dumps(measurement), flush=True)
elif mode == 'protocol-error':
    try:
        pilot.stdio_probe(sys.executable, environment, 'query', {}, 'known-fixture',
                          argv=[*native, 'error'])
    except RuntimeError as error:
        if str(error) != 'native MCP exited before response':
            raise
        print(json.dumps({'outcome': 'error'}), flush=True)
    else:
        sys.exit(8)
elif mode in ('additional','additional-error'):
    validated = 0
    def validate(result):
        global validated
        if mode=='additional-error':
            raise RuntimeError('additional fixture rejected')
        if result.get('private_pipe_fds')!=[]:
            raise RuntimeError('native inherited private descriptor')
        validated += 1
    try:
        result = pilot.stdio_probe(sys.executable,environment,'query',{},'known-fixture',
            argv=[*native,'normal'], additional=(('query',{},'known-fixture',validate),)*3)
    except RuntimeError as error:
        if mode!='additional-error' or str(error)!='additional fixture rejected':
            raise
        print(json.dumps({'outcome':'rejected'}),flush=True)
    else:
        if mode!='additional' or validated!=3:
            sys.exit(8)
        print(json.dumps({**result,'validated':validated}),flush=True)
elif mode == 'timeout':
    pilot.MCP_RESPONSE_TIMEOUT_SECONDS = NATIVE_RESPONSE_TIMEOUT_SECONDS
    try:
        pilot.stdio_probe(sys.executable, environment, 'query', {}, 'known-fixture',
                          argv=[*native, 'silent'])
    except RuntimeError as error:
        if str(error) != 'native MCP response deadline exceeded':
            raise
        print(json.dumps({'outcome': 'timeout'}), flush=True)
    else:
        sys.exit(8)
elif mode == 'signal':
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt('fixture interrupted')
    signal.signal(signal.SIGTERM, interrupt)
    try:
        with native_cpu.measured_process([*native, 'silent'], environment):
            deadline = time.monotonic() + FACT_DEADLINE_SECONDS
            while not (state / 'native.json').exists():
                if time.monotonic() >= deadline:
                    sys.exit(8)
                time.sleep(POLL_INTERVAL_SECONDS)
            os.kill(os.getpid(), signal.SIGTERM)
    except KeyboardInterrupt:
        print(json.dumps({'outcome': 'interrupted'}), flush=True)
elif mode == 'interruption':
    with native_cpu.measured_process([*native, 'silent'], environment):
        deadline = time.monotonic() + FACT_DEADLINE_SECONDS
        while not (state / 'native.json').exists():
            if time.monotonic() >= deadline:
                sys.exit(8)
            time.sleep(POLL_INTERVAL_SECONDS)
        # Kill only this command owner; the independent supervisor must clean helper/native descendants.
        os.kill(os.getpid(), signal.SIGKILL)
