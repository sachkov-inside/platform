"""SOURCE-MODEL birth barrier using tiny actual owned children, no native trial."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import representative_witness as witness


class Worker(unittest.TestCase):
    def test_registration_is_durable_before_child_crosses_barrier(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            child=subprocess.Popen([sys.executable,'-I','-B','-c',
                "import sys,json,pathlib,os; assert sys.stdin.buffer.read(1)==b'1'; r=json.loads(pathlib.Path(sys.argv[1]).read_text()); assert r['pid']==os.getpid(); pathlib.Path(sys.argv[2]).write_text('registered')",
                str(root/'worker.json'),str(root/'passed')],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            try:
                self.assertFalse((root/'passed').exists())
                with patch.object(witness._native_runtime(),'process_start',return_value='123456'):
                    record=witness._register(child,root)
                self.assertEqual(set(record),{'pid','group','start_ticks'})
                self.assertEqual(record,{'pid':child.pid,'group':child.pid,'start_ticks':'123456'})
                self.assertEqual(child.wait(timeout=3),0)
                self.assertEqual((root/'passed').read_text(),'registered')
                self.assertEqual((root/'worker.json').stat().st_mode&0o777,0o600)
            finally:
                if child.poll() is None:os.killpg(child.pid,9)
                child.wait(timeout=3)
                if child.stdin:child.stdin.close()
    def test_receipt_collision_does_not_release_or_kill_unrelated_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            (root/'worker.json').write_text('foreign');(root/'worker.json').chmod(0o600)
            child=subprocess.Popen([sys.executable,'-I','-B','-c','import sys; sys.stdin.buffer.read(1)'],stdin=subprocess.PIPE,start_new_session=True)
            try:
                with patch.object(witness._native_runtime(),'process_start',return_value='123456'),self.assertRaises(FileExistsError):witness._register(child,root)
                self.assertIsNone(child.poll());self.assertEqual((root/'worker.json').read_text(),'foreign')
            finally:
                child.stdin.close();child.wait(timeout=3)


class Helper(unittest.TestCase):
    def test_actual_receipt_envelope_keeps_unknown_and_rejects_stale_or_partial_counts(self):
        import copy
        binding={'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'d'*12}
        row={'schema':1,'binding':binding,'instance':'e'*32,'pid':1,'process_start_ticks':123,'cgroup_sha256':'f'*64,
            'requests':2,'submitted_spans':3,'acknowledged_spans':3,'rejected_spans':0,'partial_responses':0,
            'partial_warnings':0,'failed_requests':0,'unknown_outcomes':0}
        value={'receipt':row,'identity':[1,2,os.getuid(),1],'process_start_ticks':123,'cgroup_sha256':'f'*64,
            'source_sha256':'1'*64,'read_start_ns':time.monotonic_ns()-1000,'read_end_ns':time.monotonic_ns()}
        self.assertEqual(witness.helper_receipt(value,binding=binding,source_sha256='1'*64),row)
        for field,changed in [('unknown_outcomes',1),('rejected_spans',1),('requests',True),('acknowledged_spans',4),('instance','changed')]:
            bad=copy.deepcopy(value);bad['receipt'][field]=changed
            with self.subTest(field=field),self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64,previous=row)
        bad=copy.deepcopy(value);del bad['receipt']['unknown_outcomes']
        with self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64)
        bad=copy.deepcopy(value);bad['receipt']['submitted_spans']=2;bad['receipt']['acknowledged_spans']=2
        with self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64,previous=row)
