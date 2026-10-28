"""Python contract entry point; native children belong to the outside Node owner."""
import json
import os
from pathlib import Path
import sys
import signal
import runpy
import subprocess
import time
import unittest

import producer_protocol


def main():
    if sys.argv[1:2] == ['--script']:
        if len(sys.argv) != 3 or sys.argv[2] not in ('logging_contract.py', 'trace_flags_contract.py', 'diagnostic_contract.py', 'api_progress_contract.py', 'producer_phase_contract.py'):
            raise ValueError('closed tracking script')
        script = str(Path(__file__).parent / sys.argv[2])
        sys.argv = [script]
        runpy.run_path(script, run_name='__main__')
    elif sys.argv[1:2] == ['--fixture']:
        case, report = sys.argv[2:]
        if case == 'nested_interruption':
            nested_report = report + '.nested'
            child = subprocess.Popen(['node', str(Path(__file__).with_name('contract-runner.mjs')),
                                      '--fixture', 'interruption', nested_report],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not Path(nested_report).exists():
                    if child.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('nested owned listener missing')
                    time.sleep(.01)
                state = json.loads(Path(nested_report).read_text())
                state.update(outer_python=os.getpid(), inner_owner=child.pid)
                Path(report + '.tmp').write_text(json.dumps(state))
                os.replace(report + '.tmp', report)
                child.wait(timeout=30)
            finally:
                # A nested owner has its own session; forward cancellation and await its reap.
                if child.poll() is None:
                    child.terminate()
                child.wait(timeout=4)
            return
        ending = {'success': 's.close(()=>process.stdout.write("{}"));',
                  'failure': 'process.exit(2);',
                  'timeout': 'process.on("SIGTERM",()=>{});',
                  'interruption': 'process.on("SIGTERM",()=>{});'}[case]
        code = ('const h=require("node:http"),f=require("node:fs");const s=h.createServer();'
                's.listen(0,"127.0.0.1",()=>{const report='+json.dumps(report)+';f.writeFileSync(report+".tmp"'
                ',JSON.stringify({child:process.pid,python:'+str(os.getpid())+',port:s.address().port}));'
                'f.renameSync(report+".tmp",report);'+ending+'});')
        producer_protocol.capture(argv=['node', '-e', code])
    elif sys.argv[1:] and not (len(sys.argv)==3 and sys.argv[1]=='--source-group'):
        raise ValueError('closed tracking contracts')
    else:
        suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern='test_*.py')
        import source_groups
        group=sys.argv[2] if sys.argv[1:] else None
        if group is not None:suite=source_groups.select_group(suite,group)
        elif tuple(test.id() for test in source_groups.tests(suite))!=source_groups.SOURCE_IDS:source_groups.refuse()
        result=unittest.TextTestRunner().run(suite)
        if not result.wasSuccessful():raise SystemExit(1)
        if group is not None:
            sys.stderr.write('TRACKING_CONTRACTS_V1 completed '+group+' '+str(result.testsRun)+'\n')


if __name__ == '__main__':
    # Unwind capture/test finally blocks before the outside group owner escalates.
    signal.signal(signal.SIGTERM, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
    main()
