"""Actual private-overlay filesystem/identity seam; no container or external runtime."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import overlay


class PrivateOwner(unittest.TestCase):
    def test_registered_owner_drift_refuses_before_any_further_runtime_read(self):
        import owned
        from test_ownership_diagnostics import Runtime
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory)
            targets=owned.Targets(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read)
            witness=(runtime.output/'source-freshness-owned.json').read_bytes()
            before=runtime.commands.copy()
            (runtime.output/'config.alloy').chmod(0o640)
            with self.assertRaises(ValueError):targets.check('gateway')
            self.assertEqual(runtime.commands,before)
            self.assertEqual((runtime.output/'source-freshness-owned.json').read_bytes(),witness)
            self.assertEqual(runtime.fake.changes,[])
            (runtime.output/'config.alloy').chmod(0o600)
            uid,gid=overlay.private_owner(runtime.output)
            with patch.object(overlay,'private_owner',return_value=(uid,(gid+1)%4294967295)):
                with self.assertRaises(ValueError):targets.check('gateway')
            self.assertEqual(runtime.commands,before)

    def test_each_protected_file_refuses_real_mode_link_symlink_and_nonregular_objects(self):
        for name in ('config.alloy','Caddyfile','auth.json'):
            for kind in ('mode','link','symlink','directory','fifo','missing'):
                with self.subTest(name=name,kind=kind),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory).resolve()/'private';overlay.prepare(output);file=output/name
                    if kind=='mode':file.chmod(0o640)
                    elif kind=='link':os.link(file,output/'additional-link')
                    else:
                        file.unlink()
                        if kind=='symlink':file.symlink_to('compose.json')
                        elif kind=='directory':file.mkdir(mode=0o600)
                        elif kind=='fifo':os.mkfifo(file,0o600)
                    with self.assertRaises(ValueError):overlay.plan(output)

    def test_invalid_role_refuses_before_protected_owner_or_runtime_reads(self):
        import owned
        from test_ownership_diagnostics import Runtime
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);targets=owned.Targets(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read)
            before=runtime.commands.copy()
            with patch.object(overlay,'private_owner',side_effect=AssertionError('unexpected filesystem read')):
                for role in (None,True,[],{},'foreign'):
                    with self.subTest(role_type=type(role).__name__),self.assertRaises(ValueError):targets.check(role)
            self.assertEqual(before,runtime.commands)

    def test_owner_type_bounds_and_group_equality_are_checked_without_payload_reads(self):
        from types import SimpleNamespace
        fields=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output)
            original_open=os.open;original_fstat=os.fstat;original_stat=os.stat;actual_uid=os.getuid();actual_gid=(output/'auth.json').stat().st_gid
            for uid,gid,drift,valid in ((0,0,False,True),(4294967294,4294967294,False,True),
                    (actual_uid,actual_gid,True,False),(actual_uid,-1,False,False),
                    (actual_uid,4294967295,False,False),(actual_uid,True,False,False),
                    (True,actual_gid,False,False),(4294967295,actual_gid,False,False)):
                opened={}
                def opened_file(name,*args,**kwargs):
                    fd=original_open(name,*args,**kwargs)
                    if name in ('config.alloy','Caddyfile','auth.json'):opened[fd]=name
                    return fd
                def info(value,name=None):
                    values={field:getattr(value,field) for field in fields};values['st_uid']=uid
                    if name is not None:values['st_gid']=gid+1 if drift and name=='Caddyfile' else gid
                    return SimpleNamespace(**values)
                def fstat(fd):return info(original_fstat(fd),opened.get(fd))
                def stat(name,*args,**kwargs):
                    value=original_stat(name,*args,**kwargs)
                    return info(value,name) if kwargs.get('dir_fd') is not None else value
                with self.subTest(uid_type=type(uid).__name__,gid_type=type(gid).__name__,drift=drift), \
                     patch.object(os,'open',side_effect=opened_file),patch.object(os,'fstat',side_effect=fstat), \
                     patch.object(os,'stat',side_effect=stat),patch.object(os,'getuid',return_value=uid), \
                     patch.object(os,'read',side_effect=AssertionError('private payload read')):
                    if valid:self.assertEqual(overlay.private_owner(output),(uid,gid))
                    else:
                        with self.assertRaises(ValueError):overlay.private_owner(output)

    def test_metadata_drift_or_replaced_name_refuses_after_complete_descriptor_acquisition(self):
        from types import SimpleNamespace
        fields=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output)
            actual_open=os.open;actual_fstat=os.fstat;actual_stat=os.stat
            for field in fields:
                for boundary in ('fstat','name'):
                    opened={};calls={}
                    def opened_file(name,*args,**kwargs):
                        fd=actual_open(name,*args,**kwargs)
                        if name in ('config.alloy','Caddyfile','auth.json'):opened[fd]=name
                        return fd
                    def changed(value):
                        values={key:getattr(value,key) for key in fields};values[field]+=1;return SimpleNamespace(**values)
                    def fstat(fd):
                        value=actual_fstat(fd);calls[fd]=calls.get(fd,0)+1
                        return changed(value) if boundary=='fstat' and fd in opened and calls[fd]==2 else value
                    def stat(name,*args,**kwargs):
                        value=actual_stat(name,*args,**kwargs)
                        return changed(value) if boundary=='name' and kwargs.get('dir_fd') is not None else value
                    with self.subTest(field=field,boundary=boundary),patch.object(os,'open',side_effect=opened_file), \
                         patch.object(os,'fstat',side_effect=fstat),patch.object(os,'stat',side_effect=stat):
                        with self.assertRaises(ValueError):overlay.private_owner(output)
                    self.assertEqual(len(opened),3)
                    for fd in opened:
                        with self.assertRaises(OSError):actual_fstat(fd)

    def test_owned_descriptor_cleanup_keeps_primary_and_exposes_failure_without_primary(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output)
            actual_open=os.open;actual_fstat=os.fstat;actual_close=os.close
            for fail_primary in (True,False):
                opened=[];closed=[];primary=RuntimeError('private-controlled-owner')
                def opened_file(name,*args,**kwargs):
                    fd=actual_open(name,*args,**kwargs)
                    if name in ('config.alloy','Caddyfile','auth.json'):opened.append(fd)
                    return fd
                def fstat(fd):
                    if fail_primary and len(opened)==2 and fd==opened[-1]:raise primary
                    return actual_fstat(fd)
                def close(fd):
                    actual_close(fd)
                    if fd in opened:
                        closed.append(fd)
                        if len(closed)==1:raise OSError('private-controlled-close')
                with self.subTest(primary=fail_primary),patch.object(os,'open',side_effect=opened_file), \
                     patch.object(os,'fstat',side_effect=fstat),patch.object(os,'close',side_effect=close):
                    try:overlay.private_owner(output)
                    except BaseException as error:
                        if fail_primary:self.assertIs(error,primary)
                        else:self.assertIs(type(error),ValueError);self.assertEqual(str(error),'closed Caddy artifact refused')
                    else:self.fail('cleanup failure hidden')
                self.assertEqual(set(closed),set(opened))
                for fd in opened:
                    with self.assertRaises(OSError):actual_fstat(fd)
