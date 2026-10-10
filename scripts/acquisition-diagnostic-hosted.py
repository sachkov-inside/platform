"""Allowlisted hosted identity and independent Linux closure evidence for #1324."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).parent / 'heavy-check'))
from processes import process_snapshot

NATIVE_CLOSURE_COMMAND_SECONDS = 10
DAEMON_UNITS = ('docker.service', 'docker.socket', 'containerd.service')


def qualify_closure(root, receipt, snapshot, cwd, daemon_state, identity=lambda _pid: None):
    """Fail closed on live workspace children or a still-active ephemeral daemon."""
    ancestors = {os.getpid()}
    parent = os.getpid()
    while parent in snapshot:
        parent = snapshot[parent][0]
        if parent in ancestors:
            break
        ancestors.add(parent)
    pending = []
    contexts = []
    meter_pending = []
    for result in receipt.get("meters", []):
        if result.get("pending") != 0:
            meter_pending.append(result.get("unit"))
        for owned in [result["helper"], *result["fingerprints"]]:
            current = identity(owned["pid"])
            if current is not None and current["birth"] == owned["birth"]:
                meter_pending.append(owned)
    for pid, row in snapshot.items():
        if pid in ancestors or row[2] == 'Z':
            continue
        context = identity(pid) or {"pid": pid, "ppid": row[0], "pgid": row[1], "state": row[2], "birth": row[3], "uids": None}
        try:
            directory = cwd(pid)
        except (FileNotFoundError, ProcessLookupError) as error:
            # A vanished process is harmless; an unreadable live process is not proof.
            if process_snapshot().get(pid) == row:
                error.kernel_process = context
                raise error
            continue
        except Exception as error:
            error.kernel_process = context
            raise
        if directory.is_relative_to(root):
            pending.append(pid)
            contexts.append(context)
    states = {unit: daemon_state(unit) for unit in DAEMON_UNITS}
    closed = (not pending and not meter_pending and all(value == ('inactive', '0') for value in states.values())
              and receipt.get('pending') == 0 and receipt.get('daemonShutdownExit') == 0
              and isinstance(receipt.get('supervisorExit'), int))
    return {'pending': 0 if closed else 'native closure unproven',
            'workspaceProcessPids': pending, 'workspaceProcesses': contexts, 'meterProcessesPending': meter_pending, 'daemonStates': states,
            'supervisorExit': receipt.get('supervisorExit'),
            'daemonShutdownExit': receipt.get('daemonShutdownExit')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('identity', 'close'))
    parser.add_argument('--output', required=True)
    parser.add_argument('--receipt')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(mode=0o700, exist_ok=True)
    if args.mode == 'identity':
        # Only public Actions identity and runner image metadata; never dump environment.
        names = ('SOURCE_SHA', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'GITHUB_JOB',
                 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion')
        identity = {name: os.environ[name] for name in names}
        with (output / 'identity.json').open('x') as file:
            json.dump(identity, file, indent=2)
        return 0
    evidence = {'pending': 'native closure unproven'}
    try:
        assert sys.platform == 'linux', 'Linux native qualification required'
        root = Path(__file__).resolve().parent.parent
        receipt = json.loads(Path(args.receipt).read_text())

        def daemon_state(unit):
            result = subprocess.check_output(
                ['systemctl', 'show', unit, '--property=ActiveState', '--property=MainPID'],
                text=True, timeout=NATIVE_CLOSURE_COMMAND_SECONDS)
            fields = dict(line.split('=', 1) for line in result.splitlines())
            return fields['ActiveState'], fields.get('MainPID', '0') if unit == 'docker.socket' else fields['MainPID']

        def native_cwd(pid):
            try:
                return Path(os.readlink(f'/proc/{pid}/cwd'))
            except FileNotFoundError:
                # Linux kernel threads have no cwd. PF_KTHREAD proves that exception.
                fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                if int(fields[6]) & 0x00200000:
                    return Path('/')
                raise

        def kernel_identity(pid):
            from processes import process_row
            row = process_row(pid)
            if row is None:
                return None
            try:
                status = Path(f'/proc/{pid}/status').read_text()
                uids = next(line for line in status.splitlines() if line.startswith('Uid:'))
                return {'pid': pid, 'ppid': row[0], 'pgid': row[1], 'state': row[2], 'birth': row[3],
                        'uids': list(map(int, uids.split()[1:]))}
            except FileNotFoundError:
                if process_row(pid) is None:
                    return None
                raise

        evidence = qualify_closure(root, receipt, process_snapshot(), native_cwd, daemon_state, kernel_identity)
    except Exception as error:
        evidence['failureType'] = type(error).__name__
        if hasattr(error, 'kernel_process'):
            evidence['failureProcess'] = error.kernel_process
    finally:
        with (output / 'native-closure.json').open('x') as file:
            json.dump(evidence, file, indent=2)
    return 0 if evidence['pending'] == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
