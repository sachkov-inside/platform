"""Pinned native executable materialization cleans only its own new file."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import native_asset


def archive():
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as stream:
        entry=tarfile.TarInfo('mcp-victoriametrics');entry.size=7
        stream.addfile(entry,io.BytesIO(b'fixture'))
    return output.getvalue()


class NativeExecutable(unittest.TestCase):
    def test_new_executable_is_removed_on_refusal_and_preexisting_file_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();output.chmod(0o700)
            with self.assertRaises(RuntimeError):
                with native_asset.unpack(output,archive()) as executable:
                    self.assertEqual(executable.read_bytes(),b'fixture')
                    raise RuntimeError('private-caddy-sentinel')
            self.assertEqual(list(output.iterdir()),[])
            foreign=output/'mcp-victoriametrics';foreign.write_bytes(b'preserve')
            with self.assertRaises(ValueError):
                with native_asset.unpack(output,archive()):self.fail('preexisting executable was accepted')
            self.assertEqual(foreign.read_bytes(),b'preserve')
