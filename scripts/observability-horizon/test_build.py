"""Artifact admission is independent of the compiling command's claimed success."""
import io
import json
from pathlib import Path
import platform
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import horizon_build


class GuardAcquisition(unittest.TestCase):
    def test_static_artifact_has_exact_sources_architecture_and_private_executable_binding(self):
        with tempfile.TemporaryDirectory(dir=horizon_build.ROOT/'.reports') as root:
            output=Path(root);horizon_build.prepare(output);calls=[]
            def run(args,**kwargs):
                calls.append((args,kwargs))
                if args[-2:]==['mod','download']:return b''
                if args[-1]=='version':return f'go version go1.26.4 {platform.system().lower()}/{horizon_build.architecture()}\n'.encode()
                self.assertIn('CGO_ENABLED=0',args);self.assertIn('GOOS=linux',args)
                Path(args[args.index('-o')+1]).write_bytes(b'\x7fELFclosed-fixture')
                return b''
            with patch.object(horizon_build.shutil,'which',return_value='/fixed/go'), \
                    patch.object(horizon_build,'parser_overlay',return_value=output/'horizon/overlay.json'):
                result=horizon_build.build(output,lambda _:self.fail('unexpected download'),run=run)
            self.assertEqual(result['target_os'],'linux');self.assertEqual(len(result['binary_sha256']),64)
            self.assertEqual(horizon_build.verify(output),result)
            self.assertTrue(all(0<options['timeout']<=120 for _,options in calls))
            self.assertTrue(any('-overlay='+str(output/'horizon/overlay.json') in args for args,_ in calls))
            self.assertFalse(any((output/'horizon'/name).exists() for name in ('mod','cache','tmp','home','sdk')))
            (output/'horizon/guard').chmod(0o700)
            with self.assertRaisesRegex(ValueError,'horizon_binary_changed'):horizon_build.verify(output)

    def test_changed_source_or_binary_cannot_reuse_the_prepared_manifest(self):
        with tempfile.TemporaryDirectory(dir=horizon_build.ROOT/'.reports') as root:
            output=Path(root);horizon_build.prepare(output)
            source=output/'horizon/source.json';value=json.loads(source.read_text());value['inputs']['foreign']='changed';source.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'horizon_source_changed'):
                horizon_build.build(output,lambda _:self.fail('download after source mismatch'),run=lambda *_args,**_kwargs:self.fail('command after source mismatch'))

    def test_sdk_escaping_paths_and_symlinks_are_refused_before_extraction(self):
        for name,kind in (('../foreign',tarfile.REGTYPE),('go/bin/go',tarfile.SYMTYPE)):
            with self.subTest(name=name,kind=kind),tempfile.TemporaryDirectory() as root:
                blob=io.BytesIO()
                with tarfile.open(fileobj=blob,mode='w:gz') as archive:
                    item=tarfile.TarInfo(name);item.type=kind;item.linkname='/foreign';archive.addfile(item)
                with self.assertRaisesRegex(ValueError,'horizon_sdk_path'):horizon_build.unpack_sdk(blob.getvalue(),Path(root))
