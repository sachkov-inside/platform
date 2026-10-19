"""Owned local process/daemon doubles for pilot lifecycle contracts; no Docker."""

import os
from pathlib import Path
import signal
import socket
import subprocess
import json
import sys

role, directory, mode, *args = sys.argv[1:]
state = Path(directory)
owned = state / "owned-resource"
if role == 'probe':
    (state / 'probe-pid').write_text(str(os.getpid()))
    sample = 'bad sample' if mode == 'invalid' else 'abcd 4096 10000000 5000000 ext2/ext3'
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(state / 'probe.sock'))
        listener.listen(1)
        print(sample, flush=True)
        print(sample, flush=True)
        signal.pause()
if role == "descendant":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(state / "child.sock"))
        listener.listen(1)
        print("ready", flush=True)
        signal.pause()
if role == "worker":
    owned.write_text("owned")
    if mode == "descendant":
        child = subprocess.Popen([sys.executable, __file__, "descendant", directory, mode],
                                 stdout=subprocess.PIPE, text=True)
        if child.stdout.readline() != "ready\n":
            sys.exit(8)
        child.stdout.close()
    if mode == "timeout":
        signal.pause()
    if mode in ("sigterm", "sigkill"):
        os.killpg(os.getpgrp(), signal.SIGTERM if mode == "sigterm" else signal.SIGKILL)
    sys.exit(7 if mode == "failure" else 0)
if role == "compose":
    with (state / "commands").open("a") as log:
        log.write(" ".join(args) + "\n")
    if args[0] == "ps":
        if mode == "diagnostics-failure" and "--format" in args:
            sys.exit(9)
        if "--format" in args:
            print(json.dumps([{"Service": "metrics", "State": "running", "Health": "", "ExitCode": 0}]
                             if owned.exists() else []))
        elif owned.exists():
            print("owned-pilot-container")
    if args[0] == "down":
        owned.unlink(missing_ok=True)
    sys.exit(0)
if role == "docker":
    if owned.exists():
        print("owned-pilot-resource")
