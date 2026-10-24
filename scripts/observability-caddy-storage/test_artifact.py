"""Only complete closed Caddy evidence reaches the public directory."""
import json
from pathlib import Path
import tempfile
import unittest
import artifact
import caddy_status
from test_observation import acquisition


class ClosedArtifact(unittest.TestCase):
    def test_atomic_canonical_roundtrip_refuses_unknown_and_unproven_positive_records(self):
        values,stamps=acquisition()
        good=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();root.chmod(0o700)
            with self.assertRaises(ValueError):artifact.write(root,good)
            good['transport']={'canonical':'passed','mcp':'passed'}
            artifact.write(root,good)
            self.assertEqual(artifact.read(root),good)
            self.assertEqual(list(root.iterdir()),[root/artifact.NAME])
            poison={**good,'private':'private-caddy-sentinel'}
            (root/artifact.NAME).write_text(json.dumps(poison))
            with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):artifact.read(root)
            self.assertNotIn('private',json.dumps(good))

    def test_directory_close_fault_attempts_every_owned_fd_and_keeps_primary_traceback(self):
        import os
        import sys
        from unittest.mock import patch
        for has_primary in (True,False):
            with self.subTest(primary=has_primary),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();root.chmod(0o700)
                actual_open=os.open;actual_close=os.close;actual_fstat=os.fstat
                opened={};attempts=[];original=[];primary=RuntimeError('private-directory-primary')
                def opened_directory(name,*args,**kwargs):
                    fd=actual_open(name,*args,**kwargs);info=actual_fstat(fd);opened[fd]=(info.st_dev,info.st_ino);return fd
                def close(fd):
                    attempts.append(fd);actual_close(fd)
                    if len(attempts)==1:raise OSError('private-directory-close')
                def origin():
                    try:raise primary
                    except BaseException:
                        original.append(sys.exc_info()[2]);raise
                try:
                    with patch.object(os,'open',side_effect=opened_directory),patch.object(os,'close',side_effect=close):
                        try:
                            with artifact.directory(root):
                                if has_primary:origin()
                        except BaseException as caught:
                            error=caught;traceback=sys.exc_info()[2]
                        else:self.fail('close failure hidden')
                    self.assertEqual(attempts,list(reversed(opened)))
                    if has_primary:
                        self.assertIs(error,primary)
                        chain=[]
                        while traceback:chain.append(traceback);traceback=traceback.tb_next
                        self.assertIn(original[0],chain)
                        self.assertNotIn('close',[tb.tb_frame.f_code.co_name for tb in chain])
                    else:
                        self.assertIs(type(error),ValueError)
                        self.assertEqual(str(error),'closed Caddy artifact refused')
                    for fd in opened:
                        with self.assertRaises(OSError):actual_fstat(fd)
                finally:
                    # Rescue only this test's still-open exact descriptor identities, even on RED.
                    for fd,identity in opened.items():
                        try:info=actual_fstat(fd)
                        except OSError:continue
                        if (info.st_dev,info.st_ino)==identity:actual_close(fd)

    def test_private_owner_primary_survives_directory_close_fault_with_all_fds_attempted(self):
        import os
        import sys
        import overlay
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()/'private';overlay.prepare(root)
            actual_open=os.open;actual_close=os.close;actual_fstat=os.fstat
            opened={};directory_fds=[];file_fds=[];attempts=[];original=[];primary=RuntimeError('private-owner-primary')
            def opened_file(name,flags,*args,**kwargs):
                fd=actual_open(name,flags,*args,**kwargs);info=actual_fstat(fd);opened[fd]=(info.st_dev,info.st_ino)
                (directory_fds if flags&os.O_DIRECTORY else file_fds).append(fd);return fd
            def fstat(fd):
                if fd in file_fds:
                    try:raise primary
                    except BaseException:
                        original.append(sys.exc_info()[2]);raise
                return actual_fstat(fd)
            def close(fd):
                attempts.append(fd);actual_close(fd)
                if fd==directory_fds[-1]:raise OSError('private-directory-close')
            try:
                with patch.object(os,'open',side_effect=opened_file),patch.object(os,'fstat',side_effect=fstat),patch.object(os,'close',side_effect=close):
                    try:overlay.private_owner(root)
                    except BaseException as caught:error=caught;traceback=sys.exc_info()[2]
                    else:self.fail('primary hidden')
                self.assertEqual(attempts,list(reversed(opened)))
                self.assertIs(error,primary)
                chain=[]
                while traceback:chain.append(traceback);traceback=traceback.tb_next
                self.assertIn(original[0],chain)
                self.assertNotIn('close',[tb.tb_frame.f_code.co_name for tb in chain])
                for fd in opened:
                    with self.assertRaises(OSError):actual_fstat(fd)
            finally:
                for fd,identity in opened.items():
                    try:info=actual_fstat(fd)
                    except OSError:continue
                    if (info.st_dev,info.st_ino)==identity:actual_close(fd)
