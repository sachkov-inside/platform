"""Own both fixture supervisor and its separately grouped worker through every exit."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

import pilot


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
def owned_scenario_process(output, mode):
    fixture = Path(__file__).with_name('source-scenario-process.py')
    parent = subprocess.Popen([sys.executable, str(fixture), 'parent', str(output), mode],
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
        pilot.await_fact(registered, bool, budget=1)
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
                pilot.await_fact(lambda: group_absent(group), bool, budget=1)
