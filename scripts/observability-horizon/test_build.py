"""Artifact admission is independent of the compiling command's claimed success."""
import io
import hashlib
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
    # SOURCE fixtures must stay relative to ROOT; each private parent is owned for this lifetime.
    def test_static_artifact_has_exact_sources_architecture_and_private_executable_binding(self):
        with tempfile.TemporaryDirectory(prefix='inside-horizon-fixture-',dir=horizon_build.ROOT) as root:
            output=Path(root);horizon_build.prepare(output);calls=[]
            def run(args,**kwargs):
                calls.append((args,kwargs))
                if args[-2:] in (['mod','download'],['mod','verify']):return b''
                if args[-1]=='version':return f'go version go1.26.4 {platform.system().lower()}/{horizon_build.architecture()}\n'.encode()
                self.assertIn('CGO_ENABLED=0',args);self.assertIn('GOOS=linux',args)
                Path(args[args.index('-o')+1]).write_bytes(b'\x7fELFclosed-fixture')
                return b''
            with patch.object(horizon_build.shutil,'which',return_value='/fixed/go'), \
                    patch.object(horizon_build,'parser_security_module',return_value=output/'horizon/guard.mod'):
                result=horizon_build.build(output,lambda _:self.fail('unexpected download'),run=run)
            self.assertEqual(result['target_os'],'linux');self.assertEqual(len(result['binary_sha256']),64)
            self.assertEqual(horizon_build.verify(output),result)
            self.assertTrue(all(0<options['timeout']<=120 for _,options in calls))
            self.assertTrue(any('-modfile='+str(output/'horizon/guard.mod') in args for args,_ in calls))
            self.assertFalse(any((output/'horizon'/name).exists() for name in ('mod','cache','tmp','home','sdk')))
            (output/'horizon/guard').chmod(0o700)
            with self.assertRaisesRegex(ValueError,'horizon_binary_changed'):horizon_build.verify(output)

    def test_changed_source_or_binary_cannot_reuse_the_prepared_manifest(self):
        with tempfile.TemporaryDirectory(prefix='inside-horizon-fixture-',dir=horizon_build.ROOT) as root:
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

    def test_sdk_failure_after_partial_extraction_cleans_private_files_and_preserves_primary_error(self):
        with tempfile.TemporaryDirectory(prefix='inside-horizon-fixture-',dir=horizon_build.ROOT) as root:
            output=Path(root);source=output/'source';source.mkdir()
            for name in ('go.mod','go.sum','metricsql-security.patch','metricsql-security.lock.json'):
                (source/name).write_bytes((horizon_build.SOURCE/name).read_bytes())
            blob=io.BytesIO()
            with tarfile.open(fileobj=blob,mode='w:gz') as archive:
                item=tarfile.TarInfo('go/partial');item.size=1;archive.addfile(item,io.BytesIO(b'x'))
            raw=blob.getvalue()
            (source/'toolchain.lock.json').write_text(json.dumps({'version':'go1.26.4','assets':[{
                'os':platform.system().lower(),'architecture':horizon_build.architecture(),
                'size_bytes':len(raw),'digest':'sha256:'+hashlib.sha256(raw).hexdigest()}]}))
            primary=RuntimeError('controlled_sdk_validation_failure')
            with patch.object(horizon_build,'SOURCE',source),patch.object(horizon_build.shutil,'which',return_value=None):
                horizon_build.prepare(output)
                with self.assertRaises(RuntimeError) as caught:
                    horizon_build.build(output,lambda _:raw,run=lambda *_args,**_kwargs:(_ for _ in ()).throw(primary))
                self.assertIs(caught.exception,primary)
            self.assertFalse(any((output/'horizon'/name).exists() for name in ('sdk','guard','binary.json','cache','mod','tmp','home')))

    def test_module_command_failure_cleans_caches_and_emits_no_reusable_artifact(self):
        for stage in ('download','verify','build'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory(prefix='inside-horizon-fixture-',dir=horizon_build.ROOT) as root:
                output=Path(root);horizon_build.prepare(output)
                primary=RuntimeError('controlled_build_failure')
                def run(args,**kwargs):
                    if args[-1]=='version':return f'go version go1.26.4 {platform.system().lower()}/{horizon_build.architecture()}\n'.encode()
                    if stage in args:raise primary
                    return b''
                with patch.object(horizon_build.shutil,'which',return_value='/fixed/go'), \
                        patch.object(horizon_build,'parser_security_module',return_value=output/'horizon/guard.mod'):
                    with self.assertRaises(RuntimeError) as caught:horizon_build.build(output,lambda _:b'',run=run)
                self.assertIs(caught.exception,primary)
                self.assertFalse(any((output/'horizon'/name).exists() for name in ('sdk','guard','binary.json','cache','mod','tmp','home')))

    def test_changed_official_parser_is_refused_before_module_copy_or_replacement(self):
        with tempfile.TemporaryDirectory(prefix='inside-horizon-fixture-',dir=horizon_build.ROOT) as root:
            directory=Path(root)
            upstream=directory/'mod/github.com/!victoria!metrics/metricsql@v0.87.5/parser.go'
            upstream.parent.mkdir(parents=True);upstream.write_text('package metricsql\n')
            with self.assertRaisesRegex(ValueError,'horizon_parser_source'):horizon_build.parser_security_module(directory)
            self.assertFalse((directory/'metricsql-security').exists())
            self.assertFalse((directory/'guard.mod').exists())
