"""Find owned macOS descendants after exec, detachment and intermediary reaping."""
import ctypes
import os
import secrets
import struct
import sys

TOKEN_PREFIX = 'INSIDE_OWNED_PROCESS_'


class ProcessOwnership:
    def __init__(self):
        token = secrets.token_hex(24)
        key = f'{TOKEN_PREFIX}{token}'
        # A nested supervisor keeps every outer ownership marker.
        self.environment = dict(os.environ, **{key: '1'})
        self.marker = f'{key}=1'.encode()
        self.library = None
        if sys.platform == 'darwin':
            self.library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
            self.library.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                                            ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
                                            ctypes.c_void_p, ctypes.c_size_t]
            self.library.sysctl.restype = ctypes.c_int
            # CTL_KERN / KERN_ARGMAX from the macOS SDK sys/sysctl.h.
            mib = (ctypes.c_int * 2)(1, 8)
            limit = ctypes.c_int()
            size = ctypes.c_size_t(ctypes.sizeof(limit))
            if self.library.sysctl(mib, 2, ctypes.byref(limit), ctypes.byref(size), None, 0):
                raise OSError(ctypes.get_errno(), 'read kern.argmax')
            self.argument_limit = limit.value
            self.buffer = ctypes.create_string_buffer(self.argument_limit)

    def carries_marker(self, pid):
        # CTL_KERN / KERN_PROCARGS2 returns argc, executable, argv, then environment.
        # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c
        mib = (ctypes.c_int * 3)(1, 49, pid)
        buffer = self.buffer
        size = ctypes.c_size_t(len(buffer))
        if self.library.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0):
            return None  # Concurrent exit or unavailable native process arguments.
        data = ctypes.string_at(buffer, size.value)
        if len(data) < 4:
            return None
        argc = struct.unpack_from('i', data)[0]
        offset = data.find(b'\0', 4) + 1
        while offset < len(data) and data[offset] == 0:
            offset += 1
        for _ in range(argc):
            end = data.find(b'\0', offset)
            if end < 0:
                return None
            offset = end + 1
        environment = [entry for entry in data[offset:].split(b'\0') if entry]
        if not environment:
            return None  # Includes restricted targets whose environment XNU omits.
        return self.marker in environment

    def include(self, snapshot, tracked, groups):
        if self.library is None:
            return
        candidates = {pid: row for pid, row in snapshot.items()
                      if 'Z' not in row[2] and self.carries_marker(pid) is True}
        # exec/exit can race procargs: bind positive evidence to the same birth identity.
        from lock import process_snapshot
        current = process_snapshot()
        for pid, row in candidates.items():
            if pid in current and current[pid][3] == row[3]:
                tracked[pid] = row[3]
                groups.add(current[pid][1])
