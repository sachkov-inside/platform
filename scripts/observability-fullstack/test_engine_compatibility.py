"""Read actual HTTP from an owned Engine peer with the pinned Linux runner API ceiling."""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import json
import socketserver
import sys
import tempfile
import threading
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-resource'))
import engine


class EngineCompatibility(unittest.TestCase):
    def test_docker_28_stats_are_read_without_requesting_a_newer_engine_api(self):
        paths=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_GET(self):
                paths.append(self.path)
                body=json.dumps({'memory_stats':{'usage':123},'cpu_stats':{'cpu_usage':{'total_usage':456}}}).encode()
                supported=self.path.startswith('/v1.48/containers/')
                self.send_response(200 if supported else 400)
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'engine.sock'
            server=socketserver.UnixStreamServer(str(path),Handler)
            server.timeout=2
            worker=threading.Thread(target=server.handle_request)
            worker.start()
            try:
                value=engine.fetch('unix://'+str(path),'a'*64)
                self.assertEqual(value['counters']['memory_charged_bytes'],123)
                self.assertEqual(value['counters']['cpu_total_ns'],456)
                self.assertEqual(paths,['/v1.48/containers/'+'a'*64+'/stats?stream=false&one-shot=true'])
            finally:
                worker.join(timeout=3);server.server_close()
                self.assertFalse(worker.is_alive())
