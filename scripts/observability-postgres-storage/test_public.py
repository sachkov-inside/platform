"""Public CLI/curation boundary, private source records and default OFF; no runtime acquisition."""
import json
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
