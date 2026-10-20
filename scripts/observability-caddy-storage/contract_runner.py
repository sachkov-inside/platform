"""Run contracts under one outside owner and unwind child cleanup on TERM."""
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import pilot
import caddy_mcp


def main():
    if sys.argv[1:2]==['--held-fixture']:
        if len(sys.argv)!=4 or sys.argv[2] not in ('success','failure','timeout','interruption','early_exit'):raise ValueError('closed Caddy fixture')
        import request_hold
        from test_request_hold import peer
        case,report=sys.argv[2:]
        with peer(status=500 if case=='failure' else 200) as (port,prefixed,_):
            environment={'PATH':os.environ.get('PATH',''),'CADDY_HOLD_TOKEN':'owned_token','CADDY_TEST_HTTP_PORT':str(port),
                'CADDY_TEST_REPORT':report,'CADDY_TEST_CASE':case,'CADDY_TEST_PARENT_PID':str(os.getpid())}
            fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'held.py')],environment)
            with request_hold.Held('owned_token',_fixture=fixture) as held:
                if not prefixed.wait(1):raise ValueError('closed Caddy fixture')
                if case in ('timeout','interruption','early_exit'):signal.pause()
                held.finish()
    elif sys.argv[1:2]==['--fixture']:
        if len(sys.argv)!=4 or sys.argv[2] not in ('success','failure','timeout','interruption','early_exit'):raise ValueError('closed Caddy fixture')
        case,report=sys.argv[2:]
        from test_observation import acquisition
        with tempfile.TemporaryDirectory() as directory:
            body=Path(directory)/'body.json';values,_=acquisition();body.write_text(json.dumps(values))
            environment={'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':report,'CADDY_TEST_CASE':case,
                         'CADDY_TEST_BODY_FILE':str(body),'CADDY_TEST_PARENT_PID':str(os.getpid())}
            pilot.stdio_probe(Path(sys.executable),environment,'query',{},'caddy_http_requests_total',
                argv=[sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'mcp.py')],decode_response=caddy_mcp.decode_response)
    elif sys.argv[1:]:raise ValueError('closed Caddy contracts')
    else:
        suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
        import source_progress
        source_progress.verify_inventory(suite)
        if not unittest.TextTestRunner(resultclass=source_progress.ProgressResult).run(suite).wasSuccessful():return 1
    return 0


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    try:sys.exit(main())
    except KeyboardInterrupt:sys.exit(130)
    except Exception:sys.exit(1)
