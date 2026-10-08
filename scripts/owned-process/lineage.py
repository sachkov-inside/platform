"""Recover macOS children by their original parent's identity after reparenting."""
import ctypes
import sys


class UniqueInfo(ctypes.Structure):
    # XNU proc_uniqidentifierinfo, PROC_PIDUNIQIDENTIFIERINFO = 17.
    # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h
    # p_orig_ppidversion is immutable, including after the launcher exits.
    _fields_ = [('uuid', ctypes.c_uint8 * 16), ('unique', ctypes.c_uint64),
                ('parent', ctypes.c_uint64), ('version', ctypes.c_int32),
                ('original_parent', ctypes.c_int32),
                ('reserve2', ctypes.c_uint64), ('reserve3', ctypes.c_uint64)]


class Lineage:
    def __init__(self, root_pid):
        self.versions = set()
        self.library = None
        if sys.platform == 'darwin':
            self.library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            self.library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int,
                                                  ctypes.c_uint64, ctypes.c_void_p,
                                                  ctypes.c_int]
            self.library.proc_pidinfo.restype = ctypes.c_int
            identity = self.identity(root_pid)
            if identity is None:
                raise RuntimeError('cannot identify owned command before reaping it')
            self.versions.add(identity[0])

    def identity(self, pid):
        info = UniqueInfo()
        size = ctypes.sizeof(info)
        # arg=1 includes zombies: a fast launcher must remain identifiable before waitpid.
        if self.library.proc_pidinfo(pid, 17, 1, ctypes.byref(info), size) != size:
            return None
        return info.version, info.original_parent

    def include(self, snapshot, tracked, groups):
        if self.library is None:
            return
        identities = {pid: identity for pid in snapshot
                      if (identity := self.identity(pid)) is not None}
        while True:
            owned = {pid for pid, (version, parent) in identities.items()
                     if version in self.versions or parent in self.versions}
            versions = {identities[pid][0] for pid in owned}
            if versions <= self.versions:
                break
            self.versions.update(versions)
        for pid in owned:
            row = snapshot[pid]
            tracked[pid] = row[3]
            if 'Z' not in row[2]:
                groups.add(row[1])
