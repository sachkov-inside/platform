"""Public CLI/curation boundary, private source records and default OFF; no runtime acquisition."""
import hashlib
import io
import json
import os
import stat
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import postgres_source
import record


class PublicBoundary(unittest.TestCase):
    def receipt(self,root):
        value={'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,
            'repository':None,'run_id':None,'run_attempt':None,'event':None,'provider_pr_head_sha':None,
            'provider_pr_base_sha':None,'inputs':{},'scope':record.SCOPE}
        path=root/'source.json';path.write_text(json.dumps(value));path.chmod(0o600)

    def test_nonlinux_run_refuses_before_any_runtime_allocation(self):
        with patch.object(postgres_source.sys,'platform','darwin'),patch.object(postgres_source.sys,'argv',
                ['postgres_source.py','run','--output','/nonexistent/task-only']),patch.object(postgres_source.pilot,'run') as runtime:
            with self.assertRaises(ValueError):postgres_source.main()
        runtime.assert_not_called()

    def test_present_invalid_record_or_source_receipt_refuses_before_public_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';metadata=root/'metadata';destination=root/'public'
            output.mkdir(mode=0o700);metadata.mkdir(mode=0o700)
            self.receipt(metadata);record.write(output,record.report('a'*40))
            with patch.object(postgres_source.ci,'read_command',return_value='a'*40):
                (output/record.NAME).write_text('{"schema":1,"schema":1}')
                with self.assertRaises(ValueError):postgres_source.collect(output,metadata,destination)
                self.assertFalse(destination.exists())
                record.write(output,record.report('a'*40))
                source=json.loads((metadata/'source.json').read_text());source['provider_execution_sha']=None
                (metadata/'source.json').write_text(json.dumps(source))
                with self.assertRaises(ValueError):postgres_source.collect(output,metadata,destination)
                self.assertFalse(destination.exists())

    def test_complete_bound_closed_report_copies_without_private_sql_or_vectors(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';metadata=root/'metadata';destination=root/'public'
            output.mkdir(mode=0o700);metadata.mkdir(mode=0o700);self.receipt(metadata)
            value=record.report('a'*40);record.write(output,value)
            (output/'private-frame.json').write_text('{"private":"controlled"}')
            with patch.object(postgres_source.ci,'read_command',return_value='a'*40):postgres_source.collect(output,metadata,destination)
            self.assertEqual(set(path.name for path in destination.iterdir()),{'source.json',record.NAME})
            self.assertEqual(record.read(destination,'a'*40),value)


class AdmissionComposition(unittest.TestCase):
    @contextmanager
    def external_reads(self,root,*,free=32*1024**3,failure=None,storage_error=None):
        """Only process/storage facts are doubled; actual producer, writer and reader compose."""
        checkout=postgres_source.pilot.ROOT
        source=checkout/'scripts/observability-postgres-storage/frame.py'
        sha='a'*40
        environment={'GITHUB_SHA':sha,'GITHUB_REPOSITORY':'sachkov-inside/platform',
            'GITHUB_RUN_ID':'1','GITHUB_RUN_ATTEMPT':'1','GITHUB_EVENT_NAME':'pull_request',
            'PILOT_PR_HEAD_SHA':'c'*40,'PILOT_PR_BASE_SHA':'d'*40}
        def read(args):
            if args==['git','-C',str(checkout),'rev-parse','HEAD']:return sha
            if args==['git','-C',str(checkout),'status','--porcelain']:return ''
            if args==['git','-C',str(checkout),'rev-parse','HEAD^{tree}']:
                if failure is not None:raise failure
                return 'b'*40
            if args==['docker','info','--format','{{.DockerRootDir}}']:return str(root)
            raise AssertionError('unexpected external read')
        with patch.dict(os.environ,environment),patch.object(postgres_source.ci,'read_command',side_effect=read), \
                patch.object(postgres_source,'source_inputs',return_value=(source,)), \
                patch.object(postgres_source.ci.shutil,'disk_usage',side_effect=storage_error,return_value=SimpleNamespace(total=64*1024**3,free=free)), \
                patch('sys.stdout',new=io.StringIO()):
            yield {'checkout_sha':sha,'checkout_tree':'b'*40,'repository':environment['GITHUB_REPOSITORY'],
                'run_id':'1','run_attempt':'1','event':'pull_request','provider_execution_sha':sha,
                'provider_pr_head_sha':'c'*40,'provider_pr_base_sha':'d'*40,
                'inputs':{str(source.relative_to(checkout)):hashlib.sha256(source.read_bytes()).hexdigest()},
                'scope':record.SCOPE}

    def cli_admission(self,metadata):
        with patch.object(postgres_source.sys,'argv',['postgres_source.py','admission','--output',str(metadata.parent/'unused'),
                '--metadata',str(metadata)]):return postgres_source.main()

    def test_actual_admission_receipt_and_collect_under_public_and_private_umasks(self):
        for mask in (0o022,0o077):
            with self.subTest(mask=oct(mask)),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();metadata=root/'metadata';output=root/'private';destination=root/'public'
                saved=os.umask(mask)
                try:
                    with self.external_reads(root) as expected:
                        self.assertEqual(self.cli_admission(metadata),0)
                        restored=os.umask(mask)
                        self.assertEqual(restored,mask)
                        self.assertEqual(stat.S_IMODE(metadata.stat().st_mode),0o700)
                        self.assertEqual(stat.S_IMODE((metadata/'source.json').stat().st_mode),0o600)
                        self.assertEqual(stat.S_IMODE((metadata/'admission.json').stat().st_mode),0o600)
                        self.assertEqual(json.loads((metadata/'source.json').read_text()),expected)
                        self.assertEqual(record.receipt(metadata),'a'*40)
                        output.mkdir(mode=0o700);value=record.report('a'*40);record.write(output,value)
                        postgres_source.collect(output,metadata,destination)
                        self.assertEqual(set(p.name for p in destination.iterdir()),{'source.json','admission.json',record.NAME})
                        self.assertEqual(record.read(destination,'a'*40),value)
                finally:os.umask(saved)

    def test_original_nonzero_admission_codes_and_mask_are_preserved(self):
        for expected,options in ((2,{'free':0}),(1,{'storage_error':OSError('controlled unavailable storage')})):
            with self.subTest(code=expected),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();metadata=root/'metadata';saved=os.umask(0o022)
                try:
                    with self.external_reads(root,**options):self.assertEqual(self.cli_admission(metadata),expected)
                    self.assertEqual(os.umask(0o022),0o022)
                    self.assertEqual(record.receipt(metadata),'a'*40)
                    self.assertFalse((root/'public').exists())
                finally:os.umask(saved)

    def test_producer_failure_and_interrupt_restore_original_mask_and_traceback(self):
        for primary in (RuntimeError('controlled primary'),KeyboardInterrupt(),SystemExit(19)):
            with self.subTest(kind=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();saved=os.umask(0o022);caught=None
                try:
                    with self.external_reads(root,failure=primary):
                        try:self.cli_admission(root/'metadata')
                        except BaseException as error:caught=error
                    self.assertIs(caught,primary)
                    self.assertEqual(os.umask(0o022),0o022)
                    names=[];trace=caught.__traceback__
                    while trace is not None:names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                    self.assertIn('read',names)
                    self.assertFalse((root/'public').exists())
                finally:os.umask(saved)

    def test_restore_failure_keeps_first_primary_and_never_hides_cleanup_only_failure(self):
        # A failed restoration is observed before independent test safety restores the actual mask.
        variants=((None,OSError('controlled restoration')),
            (RuntimeError('controlled primary'),KeyboardInterrupt()),
            (KeyboardInterrupt(),SystemExit(23)),(SystemExit(29),OSError('controlled restoration')))
        same=RuntimeError('controlled same primary');variants+=((same,same),)
        for primary,secondary in variants:
            with self.subTest(primary=type(primary).__name__,secondary=type(secondary).__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();real=os.umask;saved=real(0o022);calls=[];caught=None
                def change_mask(value):
                    calls.append(value)
                    if len(calls)==2:raise secondary
                    return real(value)
                try:
                    with self.external_reads(root,failure=primary),patch.object(postgres_source.os,'umask',side_effect=change_mask):
                        try:self.cli_admission(root/'metadata')
                        except BaseException as error:caught=error
                    self.assertIs(caught,secondary if primary is None else primary)
                    self.assertEqual(calls,[0o077,0o022])
                    self.assertEqual(real(0o077),0o077)
                    names=[];trace=caught.__traceback__
                    while trace is not None:names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                    if primary is not None:
                        self.assertIn('read',names)
                        self.assertNotIn('change_mask',names)
                    else:self.assertIn('change_mask',names)
                    self.assertFalse((root/'public').exists())
                finally:real(saved)

    def test_failed_initial_umask_never_enters_shared_admission_or_retries(self):
        for primary in (OSError('controlled initial mask'),KeyboardInterrupt(),SystemExit(31)):
            with self.subTest(kind=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();caught=None
                with patch.object(postgres_source.os,'umask',side_effect=primary) as mask, \
                        patch.object(postgres_source.ci,'read_command') as read:
                    try:self.cli_admission(root/'metadata')
                    except BaseException as error:caught=error
                self.assertIs(caught,primary);mask.assert_called_once_with(0o077);read.assert_not_called()
                self.assertFalse((root/'metadata').exists())

    def test_actual_produced_invalid_present_receipt_and_report_refuse_before_public_copy(self):
        for kind in ('source_mode','source_duplicate','source_symlink','source_provider','report'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();metadata=root/'metadata';output=root/'private';destination=root/'public'
                saved=os.umask(0o022)
                try:
                    with self.external_reads(root):
                        self.assertEqual(self.cli_admission(metadata),0)
                        output.mkdir(mode=0o700);record.write(output,record.report('a'*40));path=metadata/'source.json'
                        if kind=='source_mode':path.chmod(0o644)
                        elif kind=='source_duplicate':path.write_text('{"schema":1,"schema":1}')
                        elif kind=='source_symlink':
                            held=metadata/'controlled-held-source.json';path.rename(held);path.symlink_to(held.name)
                        elif kind=='source_provider':
                            value=json.loads(path.read_text());value['provider_execution_sha']='e'*40;path.write_text(json.dumps(value))
                        else:(output/record.NAME).write_text('{"schema":1,"schema":1}')
                        with self.assertRaises(ValueError):postgres_source.collect(output,metadata,destination)
                        self.assertFalse(destination.exists())
                finally:os.umask(saved)
