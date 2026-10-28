"""Image admission refusals survive the actual worker producer and closed publication."""
import ast
from contextlib import nullcontext
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import evidence
import lifecycle
_import_path=sys.path.copy()
try:
    import runtime
finally:
    sys.path[:]=_import_path


class AdmissionReasons(unittest.TestCase):
    def test_actual_checked_image_worker_failure_remains_failed_with_exact_closed_reason(self):
        for image,reason in [({'Os':'linux','Architecture':'amd64'},'selected_image_descriptor'),
                             ({'Os':'linux','Architecture':'arm64'},'image_platform'),
                             ({'Os':'linux','Architecture':'amd64','Descriptor':{'mediaType':'untrusted'}},'selected_image_media_type')]:
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);private=root/'private';private.mkdir(mode=0o700)
                class Native:
                    identity={}
                    def call(self,args,timeout=10):
                        if args[:1]==['pull']:return ''
                        if args[:2]==['image','inspect']:return json.dumps([image])
                        raise AssertionError('unexpected_native_operation')
                for name,value in {'source':{},'owner':{'supervisor_pid':os.getppid(),'deadline':time.monotonic()+10,'daemon':{},'project':'fixture','nonce':'a'*32},
                                   'worker':{'pid':os.getpid(),'group':os.getpid(),'start_ticks':'fixture'},'compose':{}}.items():
                    lifecycle.private_json(private/(name+'.json'),value)
                handlers={signum:runtime.signal.getsignal(signum) for signum in (runtime.signal.SIGTERM,runtime.signal.SIGINT,runtime.signal.SIGUSR1)}
                with patch.object(runtime,'require_native_host'),patch.object(runtime,'verify_source'),\
                     patch.object(runtime,'process_start',return_value='fixture'),patch.object(runtime,'engine',return_value=Native()),\
                     patch.object(runtime.signal,'signal'),patch.object(lifecycle,'storage_guard',return_value=nullcontext(lambda:None)),\
                     self.assertRaisesRegex(lifecycle.Refusal,'^'+reason+'$'):
                    runtime.worker(private)
                self.assertEqual({signum:runtime.signal.getsignal(signum) for signum in handlers},handlers)
                self.assertEqual(evidence.read(private/'failure.json')['reason'],reason)
                self.assertFalse(evidence.collect(private,root/'public',lambda _v:None))
                public=json.loads((root/'public/witness.json').read_text())
                self.assertEqual(public['failure']['phase'],'acquire')
                self.assertEqual(public['failure']['reason'],reason)
                self.assertFalse(public['passed'])

    def test_every_image_admission_guard_uses_the_single_finite_public_reason_owner(self):
        tree=ast.parse(Path(lifecycle.__file__).read_text())
        members=set()
        for function in tree.body:
            if not isinstance(function,ast.FunctionDef) or function.name not in ('checked_image','require_child_descriptor','require_declared_volume_coverage'):continue
            for call in ast.walk(function):
                if not isinstance(call,ast.Call) or not isinstance(call.func,ast.Name) or call.func.id!='need':continue
                reason=call.args[1]
                self.assertIsInstance(reason,ast.Attribute)
                self.assertIsInstance(reason.value,ast.Name)
                self.assertEqual(reason.value.id,'ImageAdmissionReason')
                members.add(reason.attr)
        self.assertEqual(members,set(lifecycle.ImageAdmissionReason.__members__))
        self.assertEqual(len(members),15)
        for reason in lifecycle.ImageAdmissionReason:
            self.assertEqual(evidence.failure({'phase':'acquire','reason':reason.value})['reason'],reason.value)

    def test_arbitrary_reason_prefix_exception_text_and_category_never_escape(self):
        secret='private-key-email-DSN-query'
        for reason in (secret,'image_platform:'+secret,'selected_image_descriptor_'+secret,{},['image_platform']):
            # Untrusted JSON types must be rejected or safely projected, never printed.
            try:public=evidence.failure({'phase':'acquire','reason':reason,'category':secret,'exception':secret})
            except (TypeError,ValueError):continue
            self.assertEqual(public['reason'],'unclassified_failure')
            self.assertNotIn(secret,json.dumps(public))


if __name__=='__main__':unittest.main()
