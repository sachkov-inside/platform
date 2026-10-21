"""Tracking-owned phase schema/capture/source authority controls, without API/PG."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import producer_phase as phase

SOURCE='a'*40


def record(state='running',name='input_validation',reason='none'):
    return dict(schema=1,scope='tracking',source=SOURCE,state=state,phase=name,reason=reason)


class TrackingPhaseTest(unittest.TestCase):
    def test_exact_tracking_profile_refuses_sdk_and_parent_child_forgery(self):
        self.assertEqual(phase.validate(record('failed','migration','operation_failed'),source=SOURCE),record('failed','migration','operation_failed'))
        for value in [record(name='sdk_flush'),{**record(),'scope':'sdk'},{**record(),'source':'b'*40},record(name='result_ready'),{**record(),'private':'secret'}]:
            with self.assertRaises(ValueError):phase.validate(value,source=SOURCE)
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/'phase.json'
            phase.write(path,record('completed','result_ready'),source=SOURCE)
            self.assertEqual(phase.read_child(path,source=SOURCE)['state'],'completed')
            phase.write(path,record('refused','unknown','contract'),source=SOURCE)
            with self.assertRaises(ValueError):phase.read_child(path,source=SOURCE)

    def test_existing_source_is_captured_once_and_phase_read_follows_capture_reap(self):
        import tracking_storage as storage
        diagnostic=type('Diagnostic',(),{'start':lambda *_:None,'observed':lambda *_:None,'fail':lambda *_:None})()
        observed={'runtime_modules':{}}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();environment={'fixture':'unchanged'}
            def capture(*,environment,diagnostic):
                self.assertFalse((output/phase.NAME).exists())
                self.assertEqual(environment['INSIDE_PRODUCER_PHASE_SOURCE'],SOURCE)
                self.assertEqual(environment['INSIDE_TRACKING_PRODUCER_PHASE_SOURCE'],SOURCE)
                self.assertEqual(environment['fixture'],'unchanged')
                self.assertEqual(set(environment),{'fixture','INSIDE_PRODUCER_PHASE_PATH','INSIDE_PRODUCER_PHASE_SOURCE','INSIDE_PRODUCER_PHASE_SCOPE','INSIDE_TRACKING_PRODUCER_PHASE_PATH','INSIDE_TRACKING_PRODUCER_PHASE_SOURCE'})
                phase.write(Path(environment['INSIDE_TRACKING_PRODUCER_PHASE_PATH']),record('completed','result_ready'),source=SOURCE)
                return {}
            with patch.object(storage.ci,'read_command',return_value=SOURCE) as source,patch.object(storage.producer_protocol,'capture',side_effect=capture),patch.object(storage.producer_protocol,'witness',return_value=observed),patch.object(storage.pilot,'write_json'):
                self.assertEqual(storage.producer_observation(output,environment=environment,diagnostic=diagnostic),observed)
                source.assert_called_once()
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE)['state'],'completed')

    def test_collection_refuses_missing_metadata_before_destination(self):
        import tracking_storage as storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=root/'metadata';metadata.mkdir(mode=0o700);destination=root/'public'
            with patch.object(storage.diagnostics,'read',return_value={}),patch.object(storage.ci,'read_command',return_value=SOURCE),patch.object(storage.ci,'collect') as collect:
                with self.assertRaises(ValueError):storage.collect(output,metadata,destination)
                self.assertTrue(collect.call_count==0,'public destination acquired before source validation')
            self.assertFalse(destination.exists())


    def test_collection_requires_matching_admission_receipt_even_without_marker(self):
        import tracking_storage as storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700)
            metadata=root/'metadata';metadata.mkdir(mode=0o700);path=metadata/'source.json'
            value=dict(checkout_sha=SOURCE,checkout_tree='b'*40,repository=None,run_id=None,run_attempt=None,event=None,
                       provider_execution_sha=SOURCE,provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={},scope='fixture')
            with patch.object(storage.ci,'read_command',return_value=SOURCE):
                for index,receipt in enumerate([None,{**value,'provider_execution_sha':None},
                        {**value,'checkout_sha':'c'*40,'provider_execution_sha':'c'*40},value]):
                    if receipt is None:
                        if path.exists():path.unlink()
                    else:path.write_text(json.dumps(receipt));path.chmod(0o600)
                    destination=root/('public-'+str(index))
                    if receipt!=value:
                        with self.assertRaises(ValueError):storage.collect(output,metadata,destination)
                        self.assertFalse(destination.exists())
                    else:
                        storage.collect(output,metadata,destination)
                        self.assertEqual(phase.read(destination/phase.NAME,source=SOURCE),record('unknown','unknown','unavailable'))
                        self.assertEqual(json.loads((destination/'source.json').read_text()),value)
                        self.assertTrue((destination/storage.api_progress.NAME).is_file())


if __name__=='__main__':unittest.main()
