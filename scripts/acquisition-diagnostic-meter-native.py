"""Root-granted Linux mixed-UID preflight; no Docker, images or SDK calls."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('meter', Path(__file__).with_name('acquisition-diagnostic-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


def prove(receipt):
    assert receipt['pending'] == 0 and receipt['fingerprints']
    for row in receipt['fingerprints']:
        assert row['uids'][0] == 0 and row['pgid'] > 1
        assert not meter.same_process(row), 'privileged descendant is still alive'
    assert not meter.same_process(receipt['helper']), 'root helper still alive'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assert sys.platform == 'linux' and os.getuid() != 0
    assert os.environ.get('ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL') == '1', 'separate Root native grant required'
    output = Path(args.output) / 'meter-native'
    output.mkdir(mode=0o700)
    evidence = {'pending': 'native mixed-UID proof unproven', 'dockerPulls': 0, 'cases': []}
    try:
        try:
            meter.measure([], output, 10, 4096, fixture=True)
            raise AssertionError('TERM-resistant meter must time out')
        except subprocess.TimeoutExpired as error:
            prove(error.meter_receipt)
            evidence['cases'].append({'case': 'command-timeout', 'receipt': error.meter_receipt})
        # systemd registers RuntimeMaxSec/KillMode BEFORE this root fixture is launched.
        directory = output / 'owner-sigkill'
        directory.mkdir(mode=0o700)
        body = 'import importlib.util,sys; from pathlib import Path; s=importlib.util.spec_from_file_location("meter",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.measure([],Path(sys.argv[2]),10,4096,fixture=True)'
        caller = subprocess.Popen([sys.executable, '-c', body, str(Path(meter.__file__)), str(directory)], start_new_session=True)
        caller_birth = meter.fingerprint(caller.pid)
        deadline = time.monotonic() + 10
        try:
            started = None
            while started is None:
                files = list(directory.glob('meter-*/started.json'))
                if files:
                    started = files[0]
                    break
                assert time.monotonic() < deadline, 'fixture READY deadline'
                time.sleep(0.02)
            ready = json.loads(started.read_text())
            assert ready['leaf']['uids'][0] == 0 and ready['leaf']['pgid'] == ready['leaf']['pid']
            assert meter.same_process(caller_birth)
            os.kill(caller.pid, signal.SIGKILL)
            assert caller.wait(timeout=1) == -signal.SIGKILL
            result = started.parent / 'result.json'
            while not result.exists():
                assert time.monotonic() < deadline, 'independent root cleaner deadline'
                time.sleep(0.02)
            receipt = json.loads(result.read_text())
            while meter.same_process(receipt['helper']):
                assert time.monotonic() < deadline
                time.sleep(0.02)
            prove(receipt)
            assert receipt['stopReason'] in ('owner exited', 'owner EOF')
            evidence['cases'].append({'case': 'owner-sigkill', 'caller': caller_birth, 'receipt': receipt})
        finally:
            if caller.poll() is None:
                caller.kill()
            caller.wait(timeout=1)
        evidence['pending'] = 0
    finally:
        (output / 'native-proof.json').write_text(json.dumps(evidence, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
