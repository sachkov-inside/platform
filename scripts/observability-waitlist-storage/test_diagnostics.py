"""Waitlist native capture metadata is typed before public projection; no API/PG/Docker."""
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import producer_protocol
import waitlist_storage
import diagnostics


class WaitlistDiagnostics(unittest.TestCase):
    def test_capture_preserves_legacy_defaults_and_forwards_only_optional_diagnostic(self):
        environment={'PATH':'fixed-test-path'};wire=object()
        with patch.object(producer_protocol._owner,'capture',return_value=wire) as owner:
            self.assertIs(producer_protocol.capture(environment=environment),wire)
            owner.assert_called_once_with(argv=['node',str(producer_protocol.HERE/'producer.mjs')],environment=environment)
        diagnostic=diagnostics.Diagnostic('waitlist')
        with patch.object(producer_protocol._owner,'capture',return_value=wire) as owner:
            self.assertIs(producer_protocol.capture(environment=environment,diagnostic=diagnostic),wire)
            owner.assert_called_once_with(argv=['node',str(producer_protocol.HERE/'producer.mjs')],environment=environment,diagnostic=diagnostic)

    def test_capture_composition_persists_first_reason_and_keeps_original_failure_when_write_fails(self):
        first=RuntimeError('private-canary')
        def refuse(*,environment,diagnostic):
            diagnostic.start('capture');diagnostic.fail('native_exit');diagnostic.fail('unknown')
            raise first
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            with patch.object(producer_protocol,'capture',side_effect=refuse):
                with self.assertRaises(RuntimeError) as caught:
                    waitlist_storage.capture_producer(output,environment={},source='a'*40)
            self.assertIs(caught.exception,first)
            state=diagnostics.read(output/diagnostics.NAME,scope='waitlist')
            self.assertEqual((state['phase'],state['reason']),('capture','native_exit'))
            self.assertNotIn('private-canary',json.dumps(state))
            with patch.object(producer_protocol,'capture',side_effect=refuse), patch.object(diagnostics,'write',side_effect=OSError('private-canary')):
                with self.assertRaises(RuntimeError) as caught:
                    waitlist_storage.capture_producer(output,environment={},source='a'*40)
            self.assertIs(caught.exception,first)

    def test_collector_validates_present_metadata_before_any_generic_copy_and_canonicalizes_only_valid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';metadata=root/'metadata'
            output.mkdir();metadata.mkdir()
            waitlist_storage.collect(output,metadata,root/'legacy')
            self.assertEqual(diagnostics.read(root/'legacy'/diagnostics.NAME,scope='waitlist'),diagnostics.unknown('waitlist'))
            valid={**diagnostics.unknown('waitlist'),'phase':'capture','outcome':'failed','reason':'native_exit','attempts':4}
            raw=json.dumps(valid,indent=5)
            (output/diagnostics.NAME).write_text(raw)
            waitlist_storage.collect(output,metadata,root/'canonical')
            actual=(root/'canonical'/diagnostics.NAME).read_text()
            self.assertEqual(json.loads(actual),valid);self.assertLess(len(actual),len(raw))
            bad=[json.dumps({**valid,'private':'private-canary'}),json.dumps(valid).replace('"schema": 1','"schema":1,"sch\\u0065ma":1'),
                 json.dumps({**valid,'attempts':float('nan')}),' '*2049,json.dumps({**valid,'scope':'sdk'}),
                 json.dumps({**valid,'scope':'tracking'}),json.dumps({**valid,'reason':'private-canary'}),
                 json.dumps({**valid,'phase':'witness','reason':'witness_header'})]
            for index,body in enumerate(bad):
                with self.subTest(case=index):
                    (output/diagnostics.NAME).write_text(body);target=root/('refused'+str(index))
                    with patch.object(waitlist_storage.ci,'collect') as generic:
                        with self.assertRaises(ValueError): waitlist_storage.collect(output,metadata,target)
                        generic.assert_not_called()
                    self.assertFalse(target.exists())
            (output/diagnostics.NAME).unlink();(output/diagnostics.NAME).symlink_to(root/'absent')
            with patch.object(waitlist_storage.ci,'collect') as generic:
                with self.assertRaises(ValueError):waitlist_storage.collect(output,metadata,root/'symlink')
                generic.assert_not_called()

    def test_bounds_first_failure_scopes_and_exact_reader_cap_remain_closed(self):
        value=diagnostics.Diagnostic('waitlist');value.start('capture')
        for _ in range(1025):value.attempt()
        value.fail('native_exit');value.start('complete');value.fail('unknown')
        snapshot=value.snapshot()
        self.assertEqual(snapshot['attempts'],1024);self.assertTrue(snapshot['attempts_saturated'])
        self.assertEqual((snapshot['phase'],snapshot['reason']),('capture','native_exit'))
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/diagnostics.NAME
            encoded=json.dumps(snapshot);path.write_text(encoded+' '*(2048-len(encoded)))
            self.assertEqual(diagnostics.read(path,scope='waitlist'),snapshot)
            path.write_text(encoded+' '*(2049-len(encoded)))
            with self.assertRaises(ValueError):diagnostics.read(path,scope='waitlist')
        for scope in ('private-canary',None,True):
            with self.assertRaises(ValueError):diagnostics.unknown(scope)

    def test_progress_refusal_or_observer_write_never_replaces_primary_error_or_its_traceback(self):
        import subprocess
        import sys
        for kind in ('runtime','timeout'):
            for observer in ('diagnostic_os','diagnostic_value','phase_write','phase_refusal'):
                with self.subTest(kind=kind,observer=observer), tempfile.TemporaryDirectory() as directory:
                    first=RuntimeError('private-canary') if kind=='runtime' else subprocess.TimeoutExpired(['private-canary'],1)
                    tails=[]
                    def fail(*,environment,diagnostic):
                        diagnostic.start('capture');diagnostic.fail('native_exit' if kind=='runtime' else 'deadline')
                        try: raise first
                        finally: tails.append(sys.exc_info()[2])
                    if observer.startswith('diagnostic'):
                        context=patch.object(diagnostics,'write',side_effect=OSError('private-canary') if observer.endswith('os') else ValueError('private-canary'))
                    else:
                        context=patch.object(waitlist_storage.api_progress,'write' if observer=='phase_write' else 'read',
                                             side_effect=OSError('private-canary') if observer=='phase_write' else ValueError('private-canary'))
                    message=str(first)
                    with patch.object(producer_protocol,'capture',side_effect=fail), context:
                        try:
                            waitlist_storage.capture_producer(Path(directory),environment={},source='a'*40)
                        except type(first) as caught:
                            # unittest.assertRaises clears __traceback__ on exit; inspect
                            # the actual propagation before that test-library cleanup.
                            self.assertIs(caught,first);self.assertEqual(str(caught),message)
                            trace=caught.__traceback__;same=False
                            while trace is not None:
                                same=same or trace is tails[0];trace=trace.tb_next
                            self.assertTrue(same)
                        else:self.fail('primary failure was suppressed')

    def test_present_invalid_phase_also_refuses_before_copy_with_a_valid_capture_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';metadata=root/'metadata';output.mkdir();metadata.mkdir()
            diagnostics.write(output/diagnostics.NAME,diagnostics.unknown('waitlist'),scope='waitlist')
            (output/waitlist_storage.api_progress.NAME).write_text('{"private":"private-canary"}')
            with patch.object(waitlist_storage.ci,'collect') as generic:
                with self.assertRaises(ValueError):waitlist_storage.collect(output,metadata,root/'public')
                generic.assert_not_called()
            self.assertFalse((root/'public').exists())

    def test_real_capture_owner_reaps_listener_for_every_waitlist_outcome(self):
        owner=producer_protocol._owner
        original=owner.capture
        for case,ending,reason in (
                ('success','s.close(()=>process.stdout.write("null"));','none'),
                ('exit','process.exit(2);','native_exit'),
                ('decode','s.close(()=>process.stdout.write("{private-canary"));','protocol_decode'),
                ('cap','process.stdout.write("x".repeat(1048577));','protocol_cap'),
                ('deadline','process.on("SIGTERM",()=>{});','deadline'),
                ('interrupt','process.stdout.write("x");','interrupted')):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'listener.json'
                code=('const h=require("node:http"),f=require("node:fs");const s=h.createServer();'
                      's.listen(0,"127.0.0.1",()=>{f.writeFileSync('+json.dumps(str(path))+',JSON.stringify([process.pid,s.address().port]));'
                      'process.stderr.write("private-canary");'+ending+'});')
                diagnostic=diagnostics.Diagnostic('waitlist')
                environment={'PATH':os.environ['PATH']}
                def bounded(*,argv,environment,diagnostic):
                    self.assertEqual(argv,['node',str(producer_protocol.HERE/'producer.mjs')])
                    return original(argv=['node','-e',code],environment=environment,budget=1,diagnostic=diagnostic)
                def run():return producer_protocol.capture(environment=environment,diagnostic=diagnostic)
                with patch.object(owner,'capture',side_effect=bounded):
                    if case=='success':self.assertIsNone(run())
                    elif case=='interrupt':
                        select=owner.selectors.DefaultSelector.select
                        def interrupted(selector,timeout):
                            select(selector,timeout);raise KeyboardInterrupt()
                        with patch.object(owner.selectors.DefaultSelector,'select',interrupted):
                            with self.assertRaises(KeyboardInterrupt):run()
                    else:
                        with self.assertRaises((ValueError,RuntimeError,TimeoutError)):run()
                pid,port=json.loads(path.read_text())
                with self.assertRaises(ProcessLookupError):os.kill(pid,0)
                with socket.socket() as listener:listener.bind(('127.0.0.1',port))
                self.assertEqual(diagnostic.snapshot()['reason'],reason)
                self.assertNotIn('private-canary',json.dumps(diagnostic.snapshot()))

    def test_waitlist_scope_refuses_phases_outside_capture_and_observed_storage_coverage(self):
        for phase in sorted(set(diagnostics.FAILURES)-{'unknown','capture','protocol_decode',*diagnostics.WAITLIST_STORAGE_PHASES}):
            with self.subTest(phase=phase),self.assertRaises(ValueError):
                diagnostics.validate({**diagnostics.unknown('waitlist'),'phase':phase,
                                      'outcome':'passed','reason':'none'},scope='waitlist')

    def test_new_capture_dependencies_and_contracts_are_source_bound_and_workflow_routed(self):
        import fnmatch
        names={str(path.relative_to(waitlist_storage.pilot.ROOT)) for path in waitlist_storage.source_inputs()}
        required={'scripts/observability-sdk-storage/trace-predicates.json',
                  'scripts/observability-sdk-storage/trace_reason_contract.py',
                  'scripts/observability-sdk-storage/test_sdk_trace_reasons.py',
                  'scripts/observability-tracking-storage/test_tracking_trace_reasons.py',
                  'scripts/observability-waitlist-storage/test_waitlist_trace_reasons.py',
                  'scripts/observability-waitlist-storage/test_storage_diagnostics.py',
                  'scripts/observability-sdk-storage/diagnostics.py',
                  'scripts/observability-tracking-storage/producer_protocol.py',
                  'scripts/observability-waitlist-storage/producer_protocol.py',
                  'scripts/observability-waitlist-storage/waitlist_storage.py',
                  'scripts/observability-waitlist-storage/test_diagnostics.py',
                  'scripts/observability-tracking-storage/test_witness_reasons.py'}
        self.assertTrue(required <= names,sorted(required-names))
        workflow=(waitlist_storage.pilot.ROOT/'.github/workflows/observability-waitlist-storage.yml').read_text()
        routes=[line.strip()[2:].strip('"\'') for line in workflow.split('    paths:')[1].split('permissions:')[0].splitlines()
                if line.strip().startswith('- ')]
        for name in required:
            with self.subTest(path=name):self.assertTrue(any(fnmatch.fnmatchcase(name,route) for route in routes),name)
