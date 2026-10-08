"""Read macOS/Linux process identity and ancestry without spawning ps."""
import ctypes
import os
from pathlib import Path
import sys


class BsdInfo(ctypes.Structure):
    # proc_bsdinfo from the macOS SDK's sys/proc_info.h (PROC_PIDTBSDINFO = 3).
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid',
        'rgid', 'svuid', 'svgid', 'reserved',
    )] + [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in (
            'nfiles', 'pgid', 'jobc', 'tdev', 'tpgid',
        )
    ] + [('nice', ctypes.c_int32), ('start_sec', ctypes.c_uint64),
         ('start_usec', ctypes.c_uint64)]


LIBPROC = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True) if sys.platform == 'darwin' else None
if LIBPROC is not None:
    LIBPROC.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                    ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_pidinfo.restype = ctypes.c_int
    LIBPROC.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_listallpids.restype = ctypes.c_int


def process_row(pid):
    """Return (parent, group, state, birth identity), or None after exit/reap."""
    if LIBPROC is not None:
        info = BsdInfo()
        size = ctypes.sizeof(info)
        if LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) != size:
            return None
        return (info.ppid, info.pgid, {1: 'I', 2: 'R', 3: 'S', 4: 'T', 5: 'Z'}.get(info.status, '?'),
                (info.start_sec, info.start_usec))
    try:
        # comm may contain spaces and parentheses; fields after its closing ')' are stable.
        fields = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
        return int(fields[1]), int(fields[2]), fields[0], int(fields[19])
    except (FileNotFoundError, ProcessLookupError):
        return None


def process_snapshot():
    if LIBPROC is not None:
        # The process table can grow between the size query and the read.
        capacity = LIBPROC.proc_listallpids(None, 0) + 64
        while True:
            buffer = (ctypes.c_int * capacity)()
            count = LIBPROC.proc_listallpids(buffer, ctypes.sizeof(buffer))
            if count < 0:
                raise OSError(ctypes.get_errno(), 'proc_listallpids')
            if count < capacity:
                pids = list(buffer[:count])
                break
            capacity *= 2
    else:
        pids = [int(path.name) for path in Path('/proc').iterdir() if path.name.isdecimal()]
    return {pid: row for pid in pids if (row := process_row(pid)) is not None}


def adopt_orphans():
    """Linux reparents escaped descendants to this supervisor, not PID 1."""
    if sys.platform == 'linux':
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, *([ctypes.c_ulong] * 4)]
        libc.prctl.restype = ctypes.c_int
        # PR_SET_CHILD_SUBREAPER from linux/prctl.h.
        if libc.prctl(36, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')
