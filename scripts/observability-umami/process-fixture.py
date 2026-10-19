"""Real process-group fixture: deliberately leaves descendants for the external owner."""
import json
import os
import pathlib
import signal
import socket
import sys

CONNECTION_TIMEOUT_SECONDS = 2

mode, report = sys.argv[1:]
reader, writer = os.pipe()
acceptor = os.fork()
if acceptor == 0:
    os.close(reader)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        server.listen(1)
        port = server.getsockname()[1]
        # The fixture worker opens the client only after the listener is committed.
        os.write(writer, (str(port) + '\n').encode())
        client, _ = server.accept()
        child = os.fork()
        if child == 0:
            os.write(writer, (json.dumps({'request': os.getpid(), 'acceptor': os.getppid(), 'port': port, 'pgid': os.getpgrp()}) + '\n').encode())
            os.close(writer)
            while True:
                signal.pause()
        os.close(writer)
        while True:
            signal.pause()
os.close(writer)
with os.fdopen(reader) as ready:
    port = int(ready.readline())
    client = socket.create_connection(('127.0.0.1', port), timeout=CONNECTION_TIMEOUT_SECONDS)
    state = json.loads(ready.readline())
state['worker'] = os.getpid()
temporary = pathlib.Path(report + '.tmp')
temporary.write_text(json.dumps(state))
os.replace(temporary, report)
if mode == 'success':
    sys.exit(0)
if mode == 'failure':
    sys.exit(7)
if mode == 'worker_sigterm':
    os.kill(os.getpid(), signal.SIGTERM)
if mode == 'worker_sigkill':
    os.kill(os.getpid(), signal.SIGKILL)
# timeout / owner interruption keep the runner, acceptor, child and socket alive.
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    signal.pause()
