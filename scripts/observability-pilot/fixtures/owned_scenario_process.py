"""Own both fixture supervisor and its separately grouped worker through every exit."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

FIXTURE_FACT_TIMEOUT_SECONDS = 1
FIXTURE_POLL_INTERVAL_SECONDS = .01


def await_fixture_fact(read, *, clock=time.monotonic, pause=time.sleep):
    deadline = clock() + FIXTURE_FACT_TIMEOUT_SECONDS
    while clock() < deadline:
        try:
            last = read()
            if bool(last) and clock() < deadline:
                return last
        except OSError:
            pass
        remaining = deadline - clock()
        if remaining <= 0:
            break
        pause(min(FIXTURE_POLL_INTERVAL_SECONDS, remaining))
    raise RuntimeError('pilot fact unlabelled did not become visible before deadline')


def group_absent(group):
    try:
        os.killpg(group, 0)
    except ProcessLookupError:
        return True
    return False


def kill_group(group, sig):
    try:
        os.killpg(group, sig)
    except ProcessLookupError:
        pass


@contextmanager
def owned_scenario_process(output, mode, *, slow_profile_write=False):
    fixture = Path(__file__).with_name('source-scenario-process.py')
    controls=['--slow-profile-write'] if slow_profile_write else []
    parent = subprocess.Popen([sys.executable, str(fixture), 'parent', str(output), mode, *controls],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              start_new_session=True)
    groups = [parent.pid]
    def registered():
        try:
            worker = json.loads((output / 'worker.json').read_text())
        except (OSError, ValueError):
            return False
        if (isinstance(worker, dict) and type(worker.get('pid')) is int
                and worker['pid'] > 1 and worker['pid'] != parent.pid
                and worker.get('group') == worker['pid']
                and worker.get('supervisor_pid') == parent.pid):
            groups[:] = [parent.pid, worker['group']]
            return True
        return False
    try:
        # Cache ownership before the caller can fail or remove its temporary files.
        await_fixture_fact(registered)
        yield parent
    finally:
        try:
            registered()
            # Let the fixture supervisor reap its worker before escalation. It
            # catches SIGTERM as KeyboardInterrupt around its existing finally.
            kill_group(parent.pid, signal.SIGTERM)
            try:
                parent.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                for group in reversed(groups):
                    kill_group(group, signal.SIGKILL)
                parent.communicate(timeout=1)
        finally:
            for group in reversed(groups):
                kill_group(group, signal.SIGKILL)
            parent.wait(timeout=1)
            for stream in (parent.stdout, parent.stderr):
                stream.close()
            for group in groups:
                await_fixture_fact(lambda: group_absent(group))
