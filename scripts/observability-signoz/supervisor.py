"""External worker deadline and owned POSIX process-group shutdown."""
import os
import platform
import signal
import subprocess
import time

POLL_SECONDS = .1
TERM_SECONDS = 1


def wait(process, deadline, cancelled):
    while not cancelled() and time.monotonic() < deadline:
        if platform.system() == 'Linux':
            # Retain the exited leader as a zombie until session cleanup. Its PID and
            # start time cannot be reused between observation and exact group stop.
            status = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            if status is not None:
                return status.si_status if status.si_code == os.CLD_EXITED else -status.si_status
            time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
            continue
        try: return process.wait(timeout=min(POLL_SECONDS, max(.001, deadline - time.monotonic())))
        except subprocess.TimeoutExpired: pass
    return 130 if cancelled() else 124


def stop(process):
    # This Popen was acquired with start_new_session=True by this supervisor.
    # Descendants can retain the group after the launcher exits or ignores TERM.
    try: os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    try: process.wait(timeout=TERM_SECONDS)
    except subprocess.TimeoutExpired: pass
    try: os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    process.wait(timeout=1)
