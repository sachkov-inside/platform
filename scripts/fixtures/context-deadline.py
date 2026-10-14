"""Start the real context deadline only after its blocked Docker fixture is ready."""
import importlib.util
import os
import select
import sys
import threading
from types import SimpleNamespace


def main():
    script, *arguments = sys.argv[1:]
    spec = importlib.util.spec_from_file_location('context_smoke', script)
    context = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(context)
    read_fd, write_fd = os.pipe()

    class ReadyTimer(threading.Timer):
        def start(self):
            # This setup budget bounds a missing fact; it is not the measured deadline.
            try:
                if not select.select([read_fd], [], [], 5)[0]:
                    raise RuntimeError('Blocked Docker fixture did not become ready')
                if os.read(read_fd, 4096) != b'CONTEXT_READY\n':
                    raise RuntimeError('Unexpected blocked Docker readiness response')
            except BaseException:
                # Let run_owned cancel/join its timer and reap the real tree on setup failure.
                super().start()
                self.function()
                raise
            super().start()

    # Inject at the timer seam without changing the production script or supervisor.
    context.threading = SimpleNamespace(Timer=ReadyTimer)
    run_owned = context.run_owned

    def run_ready(command, budget):
        return run_owned(command, budget, stdout=write_fd)

    context.run_owned = run_ready
    sys.argv = [script, *arguments]
    try:
        return context.main()
    finally:
        os.close(read_fd)
        os.close(write_fd)


if __name__ == '__main__':
    sys.exit(main())
