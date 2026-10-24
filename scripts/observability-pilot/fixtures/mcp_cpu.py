"""Synthetic native stdio/CPU fixture; no providers or credentials."""
import json
import os
from pathlib import Path
import signal
import socket
import stat
import sys
import time

POLL_INTERVAL_SECONDS = .01
GATE_TIMEOUT_SECONDS = 5
UNRELATED_CPU_SECONDS = .5
NATIVE_CPU_SECONDS = .04
mode = sys.argv[1]
if os.environ.get('MCP_CPU_FIXTURE_STATE'):
    state = Path(os.environ['MCP_CPU_FIXTURE_STATE'])
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(str(state.with_suffix('.sock')))
    listener.listen(1)
    state.write_text(json.dumps({'pid': os.getpid()}))
if mode == 'burn':
    until = time.process_time() + UNRELATED_CPU_SECONDS
    while time.process_time() < until:
        pass
    sys.exit(0)
if mode == 'silent':
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.pause()
if mode == 'error':
    sys.exit(7)
for line in sys.stdin:
    request = json.loads(line)
    identifier = request.get('id')
    if identifier is None:
        continue
    if request['method'] == 'initialize':
        result = {'protocolVersion': '2024-11-05', 'capabilities': {}}
    elif request['method'] == 'tools/list':
        result = {'tools': [{'name': 'query'}]}
    else:
        if len(sys.argv) > 2:
            gate = Path(sys.argv[2])
            deadline = time.monotonic() + GATE_TIMEOUT_SECONDS
            while not gate.exists():
                if time.monotonic() >= deadline:
                    sys.exit(8)
                time.sleep(POLL_INTERVAL_SECONDS)
        until = time.process_time() + NATIVE_CPU_SECONDS
        while time.process_time() < until:
            pass
        extra_pipes = []
        for descriptor in range(3, 64):
            try:
                if stat.S_ISFIFO(os.fstat(descriptor).st_mode):
                    extra_pipes.append(descriptor)
            except OSError:
                pass
        result = {'content': [{'type': 'text', 'text': 'known-fixture'}], 'private_pipe_fds': extra_pipes}
    print(json.dumps({'jsonrpc': '2.0', 'id': identifier, 'result': result}), flush=True)
