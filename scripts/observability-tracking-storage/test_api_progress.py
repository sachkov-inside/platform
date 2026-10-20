"""Closed native API progress never substitutes for producer acceptance."""
import json
from pathlib import Path
import tempfile
import unittest
import api_progress

SOURCE='a'*40

class ProgressSchema(unittest.TestCase):
    def test_strict_source_scope_and_private_refusal_before_projection(self):
        good={'schema':1,'scope':'tracking','source':SOURCE,'state':'observed','milestone':'api_started'}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'phase.json'
            path.write_text(json.dumps(good))
            self.assertEqual(api_progress.read(path,scope='tracking',source=SOURCE),good)
            for raw in ('{"schema":1,"schema":1}', '{"private":"private-sentinel"}', 'NaN', '['*100, 'x'*513):
                path.write_text(raw)
                with self.assertRaises(ValueError): api_progress.read(path,scope='tracking',source=SOURCE)
            for key,value in (('scope','waitlist'),('source','b'*40),('milestone','private-sentinel'),('schema',True),('state','unknown')):
                path.write_text(json.dumps(good|{key:value}))
                with self.assertRaises(ValueError): api_progress.read(path,scope='tracking',source=SOURCE)
            path.unlink()
            self.assertEqual(api_progress.read(path,scope='tracking',source=SOURCE)['state'],'unknown')

    def test_owned_channel_removes_private_directory_and_keeps_primary_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            with self.assertRaisesRegex(RuntimeError,'primary'):
                with api_progress.OwnedProgress(output,scope='tracking',source=SOURCE) as channel:
                    marker=Path(channel.environment({})['INSIDE_PRODUCER_PHASE_PATH'])
                    marker.write_text('{"private":"private-sentinel"}')
                    raise RuntimeError('primary')
            self.assertFalse(marker.parent.exists())
            value=api_progress.read(output/api_progress.NAME,scope='tracking',source=SOURCE)
            self.assertEqual(value['state'],'refused')
            self.assertNotIn('private',json.dumps(value))

    def test_marker_collection_is_canonical_and_refuses_present_wrong_source_before_public_copy(self):
        import tracking_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';metadata=root/'metadata';output.mkdir();metadata.mkdir()
            source=tracking_storage.ci.read_command(['git','-C',str(tracking_storage.pilot.ROOT),'rev-parse','HEAD'])
            good=dict(schema=1,scope='tracking',source=source,state='observed',milestone='carrier_confirmed')
            (output/api_progress.NAME).write_text(json.dumps(good,indent=4))
            tracking_storage.collect(output,metadata,root/'public')
            canonical=(root/'public'/api_progress.NAME).read_text()
            self.assertEqual(json.loads(canonical),good)
            self.assertLess(len(canonical),len(json.dumps(good,indent=4)))
            (output/api_progress.NAME).write_text(json.dumps(good|{'source':'b'*40}))
            with self.assertRaises(ValueError): tracking_storage.collect(output,metadata,root/'refused')
            self.assertFalse((root/'refused').exists())

    def test_fifo_symlink_and_bad_child_state_refuse_without_replacing_primary_or_hanging(self):
        import os
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'phase.json'
            os.mkfifo(path)
            with self.assertRaises(ValueError): api_progress.read(path,scope='tracking',source=SOURCE)
            path.unlink();path.symlink_to(root/'missing')
            with self.assertRaises(ValueError): api_progress.read(path,scope='tracking',source=SOURCE)
            with self.assertRaisesRegex(RuntimeError,'primary'):
                with api_progress.OwnedProgress(root,scope='tracking',source=SOURCE) as channel:
                    channel.path.write_text(json.dumps(api_progress.projection('tracking',SOURCE)))
                    raise RuntimeError('primary')
            with patch.object(api_progress,'write',side_effect=OSError('private-write-failure')):
                with self.assertRaisesRegex(RuntimeError,'primary'):
                    with api_progress.OwnedProgress(root,scope='tracking',source=SOURCE):
                        raise RuntimeError('primary')
