"""Private owning HTTP seam; never a Caddy or vendor runtime witness."""
import http.client
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import request_hold

try:
    request_hold.child(os.environ['CADDY_HOLD_TOKEN'],
        _connection=http.client.HTTPConnection('127.0.0.1',int(os.environ['CADDY_TEST_HTTP_PORT']),timeout=8))
except BaseException:
    sys.exit(1)
