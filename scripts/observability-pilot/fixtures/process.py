"""Owned local process/daemon doubles for pilot lifecycle contracts; no Docker."""

import os
from pathlib import Path
import signal
import sys

role, directory, mode, *args = sys.argv[1:]
state = Path(directory)
owned = state / "owned-resource"
if role == "worker":
    owned.write_text("owned")
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
        if owned.exists():
            print("owned-pilot-container")
    if args[0] == "down":
        owned.unlink(missing_ok=True)
    sys.exit(0)
if role == "docker":
    if owned.exists():
        print("owned-pilot-resource")
