"""Private owning HTTP seam; never a Caddy or vendor runtime witness."""
import http.client
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import request_hold

try:
    def ready():
        if 'CADDY_TEST_REPORT' not in os.environ:return
        report=Path(os.environ['CADDY_TEST_REPORT'])
        report.with_suffix('.tmp').write_text(json.dumps({'pid':os.getpid(),'child':os.getpid(),'helper':os.getppid(),
            'python':int(os.environ['CADDY_TEST_PARENT_PID']),'port':int(os.environ['CADDY_TEST_HTTP_PORT'])}))
        report.with_suffix('.tmp').replace(report)
    request_hold.child(os.environ['CADDY_HOLD_TOKEN'],
        _connection=http.client.HTTPConnection('127.0.0.1',int(os.environ['CADDY_TEST_HTTP_PORT']),timeout=8),_ready=ready)
except BaseException:
    sys.exit(1)
