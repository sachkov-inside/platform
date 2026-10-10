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
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('meter', Path(__file__).with_name('acquisition-diagnostic-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)

CLIENT_SECONDS_MAXIMUM = 3
CLIENT_REAP_SECONDS_MAXIMUM = 1
NATIVE_PROOF_SECONDS_MAXIMUM = 55
NATIVE_POLL_SECONDS = 0.02
NATIVE_READY_SECONDS_MAXIMUM = 1
ROOT_IDENTITY_FIELDS = ('pid', 'ppid', 'pgid', 'sid', 'birth', 'uids')


def validate_root_ready(saved, kernel_ready):
    assert set(saved) == {'client', 'child', 'monitor'}, 'root identities missing'
    assert set(kernel_ready) == set(saved), 'kernel READY identities missing'
    assert len({row['pid'] for row in saved.values()}) == 3, 'root identities overlap'
    for name, row in saved.items():
        assert all(type(row[key]) is int and row[key] > 1 for key in ('pid', 'pgid', 'sid'))
        assert type(row['birth']) is int and row['birth'] > 0 and len(row['uids']) == 4 and all(type(uid) is int and uid == 0 for uid in row['uids']), 'root identity invalid'
        assert all(row[key] == kernel_ready[name][key] for key in ROOT_IDENTITY_FIELDS), 'kernel READY identity differs'
        assert row['pgid'] == saved['monitor']['pid'], 'foreign root group'
        assert row['sid'] == saved['monitor']['sid'], 'foreign root session'
    assert saved['client']['ppid'] == saved['monitor']['pid'] and saved['child']['ppid'] == saved['client']['pid']


def qualify_client_case(record, client_name, action, identity=meter.fingerprint):
    """A signal exit is qualified only with the right timer and native identities."""
    assert client_name in ('systemd-run', 'systemctl') and record.get('client') == client_name, 'foreign client'
    assert action in ('command-timeout', 'caller-sigkill', 'sudo-sigkill', 'ordinary-exit')
    assert record.get('case') == action and type(record.get('pending')) is int and record['pending'] == 0, 'case closure unproven'
    saved = record['fingerprints']
    validate_root_ready(saved, record['kernelReady'])
    closure = {name: identity(row['pid']) for name, row in saved.items()}
    assert all(row is None for row in closure.values()), 'root client/child/monitor kernel absence unproven'
    record['kernelAbsence'] = closure
    if action == 'caller-sigkill':
        assert record['callerExit'] == -signal.SIGKILL
        return
    exit_record = record['transportExit']
    native_exit = exit_record['nativeExit']
    assert type(native_exit) is int and record['callerExit'] == (128 - native_exit if native_exit < 0 else native_exit), 'native/caller exit differs'
    assert exit_record.get('failureType') != 'TimeoutExpired', 'outer transport deadline expired'
    if action == 'ordinary-exit':
        assert native_exit == 29
    elif action == 'sudo-sigkill':
        assert native_exit == -signal.SIGKILL
    else:
        transport = record['transport']
        command = transport['productionCommand']
        assert command[:4] == ['sudo', '-n', 'timeout', '--signal=TERM'] and command[6] == client_name
        assert '--foreground' not in command and command[4].startswith('--kill-after=')
        term, kill = float(command[5]), float(command[4].split('=', 1)[1])
        budget = transport['timeoutSeconds']
        assert type(budget) in (int, float) and type(exit_record['transportElapsedSeconds']) in (int, float)
        assert term > 0 and kill > 0 and term + kill < budget <= CLIENT_SECONDS_MAXIMUM
        assert term + kill <= exit_record['transportElapsedSeconds'] < budget, 'root timer expiry unproven'
        # The fixture ignores TERM; Python exposes SIGKILL as -9, a shell as 137.
        assert native_exit in (-signal.SIGKILL, 128 + signal.SIGKILL), 'TERM-resistant fixture did not reach KILL'


def wait_fact(read, deadline):
    while True:
        value = read()
        if value is not None:
            return value
        assert time.monotonic() < deadline, 'native fact deadline'
        time.sleep(NATIVE_POLL_SECONDS)


def live(saved):
    try:
        return meter.same_process(saved)
    except FileNotFoundError:
        if meter.process_row(saved['pid']) is None:
            return False
        raise


def reap(rows):
    for row in rows:
        try:
            os.waitpid(row['pid'], os.WNOHANG)
        except ChildProcessError:
            pass


def root_fixture(directory, child_only=False, normal_exit=None):
    """Real root client/child with the service executable replaced at its boundary."""
    assert sys.platform == 'linux' and os.getuid() == 0
    owner_uid = directory.stat().st_uid
    assert owner_uid != 0 and not directory.is_symlink() and directory.stat().st_mode & 0o777 == 0o700
    for signum in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, signal.SIG_IGN)
    if child_only:
        meter.save(directory, 'child-ready.json', meter.fingerprint(os.getpid()), owner_uid)
        while True:
            signal.pause()
    child = None
    try:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--fixture-child', '--output', str(directory)])
        child_identity = wait_fact(lambda: meter.ready_json(directory / 'child-ready.json'), time.monotonic() + NATIVE_READY_SECONDS_MAXIMUM)
        client = meter.fingerprint(os.getpid())
        monitor = meter.fingerprint(os.getppid())
        assert all(row['uids'][0] == 0 and row['pgid'] == monitor['pid'] for row in (client, child_identity, monitor))
        meter.save(directory, 'client-ready.json', {'client': client, 'child': child_identity, 'monitor': monitor}, owner_uid)
        # Even ordinary exit waits until the parent has validated all live identities.
        ack = wait_fact(lambda: meter.ready_json(directory / 'kernel-ready-ack.json'), time.monotonic() + NATIVE_READY_SECONDS_MAXIMUM)
        assert ack == {'pid': client['pid'], 'birth': client['birth']}, 'kernel READY acknowledgement differs'
        if normal_exit is not None:
            return normal_exit
        while True:
            signal.pause()
    finally:
        if child is not None:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=CLIENT_REAP_SECONDS_MAXIMUM)


def root_cleanup(directory, sudo_only=False):
    """Signal only recorded kernel identities; never a PID reused by another owner."""
    assert sys.platform == 'linux' and os.getuid() == 0
    assert not directory.is_symlink() and directory.stat().st_uid != 0 and directory.stat().st_mode & 0o777 == 0o700
    if sudo_only:
        target = json.loads((directory / 'sudo-target.json').read_text())
        launched = json.loads((directory / 'launched.json').read_text())
        assert target['pid'] == launched['sudo']['pid'] and target['birth'] == launched['sudo']['birth']
        assert target['ppid'] == launched['caller']['pid'] and live(launched['caller']), 'sudo owner changed'
        assert target['pid'] > 1 and live(target), 'sudo identity changed'
        os.kill(target['pid'], signal.SIGKILL)
        return 0
    ready = json.loads((directory / 'client-ready.json').read_text())
    identities = {row['pid']: row for row in ready.values()}
    for group in {row['pgid'] for row in ready.values()}:
        assert group > 1
        members = {pid: row for pid, row in meter.process_snapshot().items() if row[1] == group and row[2] != 'Z'}
        for pid in members:
            assert pid in identities and identities[pid]['uids'][0] == 0 and live(identities[pid]), 'foreign fixture group member'
        if members:
            os.killpg(group, signal.SIGKILL)
    return 0


def client_caller(client_name, directory, normal_exit=None):
    """Keep the actual two production transports, sudo and GNU timer unchanged."""
    assert os.getuid() != 0
    assert os.environ.get('ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL') == '1'
    actual_run = subprocess.run
    actual_popen = subprocess.Popen
    outcome = {}

    def launch(command, **kwargs):
        process = actual_popen(command, **kwargs)
        try:
            meter.save(directory, 'launched.json', {'caller': meter.fingerprint(os.getpid()),
                       'sudo': meter.fingerprint(process.pid)}, os.getuid())
        except BaseException:
            process.kill()
            process.wait(timeout=CLIENT_REAP_SECONDS_MAXIMUM)
            raise
        return process

    def run(command, **kwargs):
        assert command[:4] == ['sudo', '-n', 'timeout', '--signal=TERM'] and command[6] == client_name
        assert '--foreground' not in command and kwargs['timeout'] <= CLIENT_SECONDS_MAXIMUM
        fixture = [sys.executable, str(Path(__file__).resolve()), '--fixture-client', '--output', str(directory)]
        if normal_exit is not None:
            fixture.extend(['--normal-exit', str(normal_exit)])
        meter.save(directory, 'transport.json', {'productionCommand': command, 'timeoutSeconds': kwargs['timeout']}, os.getuid())
        started_at = time.monotonic()
        try:
            with patch.object(subprocess, 'Popen', side_effect=launch):
                result = actual_run([*command[:6], *fixture], **kwargs)
            outcome['nativeExit'] = result.returncode
            return result
        except subprocess.CalledProcessError as error:
            outcome.update(nativeExit=error.returncode, failureType=type(error).__name__)
            raise
        except subprocess.TimeoutExpired as error:
            outcome.update(nativeExit=None, failureType=type(error).__name__)
            raise
        finally:
            outcome['transportElapsedSeconds'] = time.monotonic() - started_at
            meter.save(directory, 'transport-exit.json', outcome, os.getuid())

    try:
        with patch.object(meter.subprocess, 'run', side_effect=run):
            if client_name == 'systemd-run':
                meter.launch_unit(directory, {'unit': 'inside-1337-native-fixture',
                                  'deadlineMonotonic': time.monotonic() + CLIENT_SECONDS_MAXIMUM})
            else:
                meter.shutdown_daemon(CLIENT_SECONDS_MAXIMUM)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        pass
    code = outcome['nativeExit']
    return 1 if code is None else 128 - code if code < 0 else code


def client_case(output, client_name, action, evidence, whole_deadline):
    directory = output / (client_name + '-' + action)
    directory.mkdir(mode=0o700)
    record = {'client': client_name, 'case': action, 'pending': 'native client closure unproven'}
    evidence['cases'].append(record)
    start = time.monotonic()
    deadline = min(whole_deadline, start + CLIENT_SECONDS_MAXIMUM + CLIENT_REAP_SECONDS_MAXIMUM)
    assert deadline - start > CLIENT_SECONDS_MAXIMUM, 'native proof cleanup reserve'
    command = [sys.executable, str(Path(__file__).resolve()), '--caller', client_name, '--output', str(directory)]
    if action == 'ordinary-exit':
        command.extend(['--normal-exit', '29'])
    caller = subprocess.Popen(command, start_new_session=True)
    ready = None
    primary = None
    try:
        launched = wait_fact(lambda: meter.ready_json(directory / 'launched.json'), deadline)
        ready = wait_fact(lambda: meter.ready_json(directory / 'client-ready.json'), deadline)
        record.update(launched=launched, fingerprints=ready, transport=meter.ready_json(directory / 'transport.json'),
                      kernelReady={name: meter.fingerprint(row['pid']) for name, row in ready.items()})
        validate_root_ready(ready, record['kernelReady'])
        meter.save(directory, 'kernel-ready-ack.json', {'pid': ready['client']['pid'], 'birth': ready['client']['birth']}, os.getuid())
        if action == 'caller-sigkill':
            assert live(launched['caller'])
            caller.kill()
        elif action == 'sudo-sigkill':
            target = meter.fingerprint(launched['sudo']['pid'])
            assert target is not None and target['birth'] == launched['sudo']['birth'], 'sudo birth changed'
            meter.save(directory, 'sudo-target.json', target, os.getuid())
            kill = meter.root_client_command([sys.executable, str(Path(__file__).resolve()), '--kill-sudo', '--output', str(directory)], 1)
            subprocess.run(kill, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1, start_new_session=True)
            record['sudoSigkillTarget'] = target
        record['callerExit'] = caller.wait(timeout=max(0.01, deadline - time.monotonic()))
        record['transportExit'] = meter.ready_json(directory / 'transport-exit.json')
        while True:
            reap(ready.values())
            if not any(live(row) for row in ready.values()):
                break
            assert time.monotonic() < deadline, 'root client/child/monitor still exists'
            time.sleep(NATIVE_POLL_SECONDS)
        record['pending'] = 0
        qualify_client_case(record, client_name, action)
    except BaseException as error:
        primary = error
        record['failureType'] = type(error).__name__
        record['pending'] = 'native client qualification failed'
        raise
    finally:
        try:
            if caller.poll() is None:
                caller.kill()
            caller.wait(timeout=CLIENT_REAP_SECONDS_MAXIMUM)
            if ready is not None and any(live(row) for row in ready.values()):
                cleanup = meter.root_client_command([sys.executable, str(Path(__file__).resolve()), '--cleanup-client', '--output', str(directory)], 1)
                subprocess.run(cleanup, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1, start_new_session=True)
                cleanup_end = min(whole_deadline, time.monotonic() + CLIENT_REAP_SECONDS_MAXIMUM)
                while True:
                    reap(ready.values())
                    if not any(live(row) for row in ready.values()):
                        break
                    assert time.monotonic() < cleanup_end, 'fixture cleanup unproven'
                    time.sleep(NATIVE_POLL_SECONDS)
            if ready is not None:
                record['cleanupKernelAbsence'] = {name: meter.fingerprint(row['pid']) for name, row in ready.items()}
                assert all(row is None for row in record['cleanupKernelAbsence'].values()), 'fixture cleanup kernel absence unproven'
                record['cleanupPending'] = 0
        except BaseException as error:
            record['cleanupFailureType'] = type(error).__name__
            record['pending'] = 'fixture cleanup unproven'
            if primary is None:
                raise
        finally:
            record['elapsedSeconds'] = time.monotonic() - start


def prove(receipt):
    assert receipt['pending'] == 0 and receipt['fingerprints']
    for row in receipt['fingerprints']:
        assert row['uids'][0] == 0 and row['pgid'] > 1
        assert not meter.same_process(row), 'privileged descendant is still alive'
    assert not meter.same_process(receipt['helper']), 'root helper still alive'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-sha')
    parser.add_argument('--caller', choices=('systemd-run', 'systemctl'))
    parser.add_argument('--fixture-client', action='store_true')
    parser.add_argument('--fixture-child', action='store_true')
    parser.add_argument('--normal-exit', type=int)
    parser.add_argument('--kill-sudo', action='store_true')
    parser.add_argument('--cleanup-client', action='store_true')
    args = parser.parse_args()
    if args.fixture_client or args.fixture_child:
        return root_fixture(Path(args.output), args.fixture_child, args.normal_exit)
    if args.kill_sudo or args.cleanup_client:
        return root_cleanup(Path(args.output), args.kill_sudo)
    if args.caller:
        return client_caller(args.caller, Path(args.output), args.normal_exit)
    assert sys.platform == 'linux' and os.getuid() != 0
    assert os.environ.get('ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL') == '1', 'separate Root native grant required'
    started_at = time.monotonic()
    whole_deadline = started_at + NATIVE_PROOF_SECONDS_MAXIMUM
    output = Path(args.output) / 'meter-native'
    output.mkdir(mode=0o700)
    evidence = {'pending': 'native mixed-UID proof unproven', 'dockerPulls': 0, 'acquisitionStarted': False,
                'runtimeSecondsMaximum': NATIVE_PROOF_SECONDS_MAXIMUM, 'cases': []}
    try:
        expected = args.source_sha or os.environ.get('SOURCE_SHA')
        assert expected is not None and len(expected) == 40 and all(value in '0123456789abcdef' for value in expected)
        source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, timeout=10).strip()
        assert source == expected, 'native Source SHA differs'
        evidence['sourceSha'] = source
        for command in (['git', 'diff', '--quiet'], ['git', 'diff', '--cached', '--quiet']):
            subprocess.run(command, check=True, timeout=10)
        meter.adopt_orphans()
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
        deadline = time.monotonic() + 10
        try:
            caller_birth = meter.fingerprint(caller.pid)
            started = None
            while started is None:
                files = list(directory.glob('meter-*/started.json'))
                if files:
                    started = files[0]
                    break
                assert time.monotonic() < deadline, 'fixture READY deadline'
                time.sleep(0.02)
            ready = wait_fact(lambda: meter.ready_json(started), deadline)
            assert ready['leaf']['uids'][0] == 0 and ready['leaf']['pgid'] == ready['leaf']['pid']
            assert meter.same_process(caller_birth)
            os.kill(caller.pid, signal.SIGKILL)
            assert caller.wait(timeout=1) == -signal.SIGKILL
            result = started.parent / 'result.json'
            while not result.exists():
                assert time.monotonic() < deadline, 'independent root cleaner deadline'
                time.sleep(0.02)
            receipt = wait_fact(lambda: meter.ready_json(result), deadline)
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
        for client_name in ('systemd-run', 'systemctl'):
            for action in ('command-timeout', 'caller-sigkill', 'sudo-sigkill', 'ordinary-exit'):
                client_case(output, client_name, action, evidence, whole_deadline)
        assert time.monotonic() < whole_deadline, 'whole native proof deadline'
        evidence['pending'] = 0
    except BaseException as error:
        evidence['failureType'] = type(error).__name__
        raise
    finally:
        evidence['elapsedSeconds'] = time.monotonic() - started_at
        (output / 'native-proof.json').write_text(json.dumps(evidence, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
