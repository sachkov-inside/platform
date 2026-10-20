"""Closed SDK phase file ownership controls; no Docker or application runtime."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import emitter_phase as phase

SOURCE = 'a' * 40


def record(state='running', name='input_validation', reason='none'):
    return dict(schema=1, scope='sdk', source=SOURCE, state=state, phase=name, reason=reason)


class SdkPhaseTest(unittest.TestCase):
    def test_exact_schema_matrix_and_no_foreign_payload(self):
        for state, name, reason in [('running','input_validation','none'),('failed','cleanup_sdk','operation_failed'),
                                    ('completed','result_ready','none'),('unknown','unknown','unavailable'),('refused','unknown','contract')]:
            value=record(state,name,reason)
            self.assertEqual(phase.validate(value,source=SOURCE),value)
        invalid=[]
        for key in record():
            value=record(); del value[key]; invalid.append(value)
        for key,value in [('schema',True),('scope','tracking'),('source','b'*40),('state','private'),
                          ('phase','migration'),('phase','result_ready'),('reason','operation_failed')]:
            invalid.append({**record(),key:value})
        invalid += [{**record(),'private':'secret'},record('completed','input_validation'),record('failed','input_validation','none')]
        for value in invalid:
            with self.assertRaisesRegex(ValueError,'closed SDK phase refused'):
                phase.validate(value,source=SOURCE)

    def test_canonical_owned_roundtrip_and_child_parent_separation(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve(); path=output/phase.NAME
            phase.write(path,record(),source=SOURCE)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.read_bytes(),(json.dumps(record(),sort_keys=True,separators=(',',':'))+'\n').encode())
            self.assertEqual(phase.read(path,source=SOURCE),record())
            for state,reason in [('unknown','unavailable'),('refused','contract')]:
                phase.write(path,record(state,'unknown',reason),source=SOURCE)
                with self.assertRaises(ValueError):phase.read_child(path,source=SOURCE)
            self.assertFalse((output/'phase.json.new').exists())

    def test_strict_bounded_reader_refuses_private_duplicates_links_and_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve(); path=output/phase.NAME
            for raw in [b'{}',b'{"schema":1,"schema":1}',b'{"x":NaN}',b' '*513,b'['*600]:
                path.write_bytes(raw);path.chmod(0o600)
                with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();target=output/'private';target.write_bytes(b'private');path.symlink_to(target)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();os.link(target,path)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();phase.write(path,record(),source=SOURCE);path.chmod(0o644)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)

    def test_missing_is_unknown_and_invalid_child_cannot_replace_primary(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE),record('unknown','unknown','unavailable'))
            original=RuntimeError('synthetic private primary')
            try:
                with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                    marker=owned.path
                    environment=owned.environment({'fixture':'unchanged'})
                    self.assertEqual(set(environment),{'fixture','INSIDE_SDK_EMITTER_PHASE_PATH','INSIDE_SDK_EMITTER_PHASE_SOURCE'})
                    self.assertEqual(environment['INSIDE_SDK_EMITTER_PHASE_SOURCE'],SOURCE)
                    self.assertEqual(marker.parent.stat().st_mode & 0o777,0o700)
                    marker.write_bytes(b'private');marker.chmod(0o600)
                    raise original
            except RuntimeError as observed:
                self.assertTrue(observed is original,'primary identity changed')
            self.assertFalse(marker.parent.exists())
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE),record('refused','unknown','contract'))

    def test_failed_child_exit_zero_refuses_success_after_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with self.assertRaises(ValueError):
                with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                    phase.write(owned.path,record('failed','modules_import','operation_failed'),source=SOURCE)
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE)['state'],'failed')

    def test_source_authority_rejects_unknown_fields_or_mismatched_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            metadata=Path(directory).resolve();path=metadata/'source.json'
            value=dict(checkout_sha=SOURCE,checkout_tree='b'*40,repository=None,run_id=None,run_attempt=None,event=None,
                       provider_execution_sha=SOURCE,provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={},scope='fixture')
            path.write_text(json.dumps(value));path.chmod(0o600)
            self.assertEqual(phase.source_from_metadata(metadata),SOURCE)
            for field,item in [('provider_execution_sha','c'*40),('private','secret'),('inputs',{'x':'invalid'})]:
                path.write_text(json.dumps({**value,field:item}))
                with self.assertRaises(ValueError):phase.source_from_metadata(metadata)



class SdkOwnershipFailureTest(unittest.TestCase):
    def test_temp_collision_and_recreated_foreign_inode_are_never_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME;temporary=output/'phase.json.new'
            temporary.write_bytes(b'foreign');temporary.chmod(0o600)
            with self.assertRaises(ValueError):phase.write(path,record(),source=SOURCE)
            self.assertEqual(temporary.read_bytes(),b'foreign')
            temporary.unlink()
            def replaced(*_args,**_kwargs):
                temporary.unlink();temporary.write_bytes(b'recreated');temporary.chmod(0o600)
                raise OSError('synthetic replace refusal')
            with patch.object(phase.os,'replace',side_effect=replaced),self.assertRaises(ValueError):
                phase.write(path,record(),source=SOURCE)
            self.assertEqual(temporary.read_bytes(),b'recreated')

    def test_reader_rejects_inode_replacement_and_fixed_child_name(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME
            phase.write(path,record(),source=SOURCE)
            original_read=os.read
            def replaced(fd,count):
                raw=original_read(fd,count)
                new=output/'replacement';new.write_bytes(path.read_bytes());new.chmod(0o600);os.replace(new,path)
                return raw
            with patch.object(phase.os,'read',side_effect=replaced),self.assertRaises(ValueError):
                phase.read(path,source=SOURCE)
            arbitrary=output/'arbitrary';arbitrary.write_bytes(path.read_bytes());arbitrary.chmod(0o600)
            with self.assertRaises(ValueError):phase.read_child(arbitrary,source=SOURCE)

    def test_secondary_same_or_different_error_cannot_override_primary_traceback(self):
        import sys
        class Primary(RuntimeError):
            def with_traceback(self,_traceback):
                raise AssertionError('foreign override called')
        for same in (False,True):
            with self.subTest(same=same),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();original=Primary('synthetic primary')
                secondary=original if same else OSError('synthetic marker failure')
                with patch.object(phase,'read_child',side_effect=secondary):
                    try:
                        with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                            try:raise original
                            except Primary:
                                captured=sys.exc_info()[2]
                                raise
                    except BaseException as observed:
                        self.assertTrue(observed is original,'primary identity changed')
                        traceback=BaseException.__getattribute__(observed,'__traceback__')
                        while traceback is not None and traceback is not captured:
                            self.assertNotEqual(traceback.tb_frame.f_code.co_name,'_execute_mock_call','secondary traceback leaked')
                            traceback=traceback.tb_next
                        self.assertTrue(traceback is captured,'primary traceback changed')
                    else:self.fail('primary not restored')
                self.assertFalse(owned.path.parent.exists())


class SdkCapturePhaseTest(unittest.TestCase):
    def test_opt_in_scope_projects_only_after_capture_and_defaults_allocate_nothing(self):
        import sdk_storage
        diagnostic=type('Diagnostic',(),{'start':lambda *_:None,'observed':lambda *_:None,'fail':lambda *_:None})()
        observed={'runtime_modules':{}}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();environment={'fixture':'unchanged'}
            def capture(*,environment,diagnostic):
                self.assertFalse((output/phase.NAME).exists())
                marker=Path(environment['INSIDE_SDK_EMITTER_PHASE_PATH'])
                phase.write(marker,record('completed','result_ready'),source=SOURCE)
                return {}
            with patch.object(sdk_storage,'emitter',side_effect=capture),patch.object(sdk_storage,'witness',return_value=observed),patch.object(sdk_storage.pilot,'write_json'):
                self.assertEqual(sdk_storage.producer_observation(output,environment=environment,diagnostic=diagnostic,phase_source=SOURCE),observed)
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE)['state'],'completed')
            with patch.object(sdk_storage,'emitter',return_value={}) as emitter,patch.object(sdk_storage,'witness',return_value=observed),patch.object(sdk_storage.pilot,'write_json'),patch.object(phase,'OwnedSdkPhase',side_effect=AssertionError('default observer allocation')):
                sdk_storage.producer_observation(output,environment=environment,diagnostic=diagnostic)
                self.assertTrue(emitter.call_args.kwargs['environment'] is environment)

    def test_collection_refuses_phase_or_source_before_public_destination(self):
        import sdk_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=root/'metadata';metadata.mkdir(mode=0o700);destination=root/'public'
            with patch.object(sdk_storage.diagnostics,'read',return_value={}),patch.object(sdk_storage.ci,'collect') as collect:
                with self.assertRaises(ValueError):sdk_storage.collect(output,metadata,destination)
                collect.assert_not_called()
            self.assertFalse(destination.exists())

if __name__=='__main__':unittest.main()
