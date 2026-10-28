"""Actual native failure projection without Docker, private arguments or stderr publication."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import evidence
import lifecycle
from test_lifecycle import benign_engine


class NativeDiagnostics(unittest.TestCase):
    def test_acquisition_failure_identifies_actual_operation_without_private_bytes(self):
        pin=lifecycle.verify_packet()['images'][-1]['pinned']
        cases=[(['pull','--platform','linux/amd64',pin],'image_pull','amd64_digest_reference'),
               (['image','inspect','--platform','linux/amd64',pin],'image_inspect','amd64_digest_reference'),
               (['image','inspect',pin],'image_inspect','digest_reference'),
               (['compose','-p','signoz1566-'+'a'*12,'-f','/private/compose.json','create','--no-build','--pull','never','volume-init','disk'],'compose_create','initial_helpers')]
        for args,operation,category in cases:
            with self.subTest(operation=operation,category=category),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();directory=root/'engine-1-12345678';directory.mkdir(mode=0o700)
                script=root/'native';script.write_text('#!'+sys.executable+'\nimport sys\nsys.stderr.write("private-key-email-DSN-query")\nsys.exit(125)\n');script.chmod(0o700)
                engine=benign_engine(directory);engine.invocation=script;engine.cli=script
                native=script.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(script))
                engine.anon=root/'private-anon';engine.endpoint='unix:///private/daemon.sock';engine.identity={}
                with patch.object(engine,'identify',return_value={}),self.assertRaisesRegex(lifecycle.Refusal,'command_failed'):
                    engine.call(args)
                public=evidence.native_failures(root)['samples'][0]
                self.assertEqual(public['native_exit'],125)
                self.assertEqual(public['operation'],operation);self.assertEqual(public['argument_category'],category)
                self.assertEqual(public['stderr_category'],'unclassified')
                progress=evidence.native_operations(root)['samples'][0]
                self.assertEqual(progress,{'operation':operation,'argument_category':category,'status':'failed'})
                encoded=json.dumps([public,progress]);self.assertNotIn('private',encoded);self.assertNotIn(pin,encoded)
                self.assertEqual((directory/'failure-1-stderr.private').read_text(),'private-key-email-DSN-query')
                record=json.loads((directory/'failure.json').read_text())
                for field,value in [('operation','private-key'),('argument_category','DSN'),('stderr_category','secret')]:
                    lifecycle.private_json(directory/'failure.json',{**record,field:value})
                    with self.assertRaises(ValueError):evidence.native_failures(root)

    def test_stderr_classification_is_exact_and_never_echoes_untrusted_text(self):
        self.assertEqual(lifecycle.stderr_category(b'unknown flag: --platform\n'),'unknown_platform_flag')
        for raw in (b'unknown flag: --platform\nsecret',b'private-key',b'\xff',b''):
            self.assertEqual(lifecycle.stderr_category(raw),'unclassified')

    def test_operation_projection_rejects_untrusted_categories_and_extra_fields(self):
        good={'operation':'image_pull','argument_category':'amd64_digest_reference','status':'started'}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();directory=root/'engine-1-12345678';directory.mkdir(mode=0o700)
            for bad in ({**good,'operation':'private-key'},{**good,'argument_category':'DSN'},
                        {**good,'status':'unknown'},{**good,'stderr':'secret'}):
                lifecycle.private_json(directory/'native-operation.json',bad)
                with self.assertRaises(ValueError):evidence.native_operations(root)

    def test_successful_actual_call_records_completion_without_publishing_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();directory=root/'engine-1-12345678';directory.mkdir(mode=0o700)
            script=root/'native';script.write_text('#!'+sys.executable+'\nprint("private-output")\n');script.chmod(0o700)
            engine=benign_engine(directory);engine.invocation=script;engine.cli=script
            native=script.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(script))
            engine.anon=root/'anon';engine.endpoint='unix:///private/daemon.sock';engine.identity={}
            with patch.object(engine,'identify',return_value={}):self.assertEqual(engine.call(['private-argument']),'private-output\n')
            self.assertEqual(evidence.native_operations(root)['samples'],[{'operation':'unknown','argument_category':'unknown','status':'succeeded'}])
            self.assertFalse(evidence.native_failures(root)['available'])


if __name__=='__main__':unittest.main()
