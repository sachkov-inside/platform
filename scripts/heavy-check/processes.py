"""Read macOS/Linux process identity and ancestry without spawning ps."""
import ctypes
import errno
import os
import select
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
    LIBPROC.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32,
                                    ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_listpids.restype = ctypes.c_int


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


def _darwin_group_members(group):
    # PROC_PGRP_ONLY includes zombies and other UIDs without proc_pidinfo access.
    capacity = LIBPROC.proc_listpids(2, group, None, 0) // ctypes.sizeof(ctypes.c_int) + 64
    while True:
        buffer = (ctypes.c_int * capacity)()
        ctypes.set_errno(0)
        size = LIBPROC.proc_listpids(2, group, buffer, ctypes.sizeof(buffer))
        if size < 0 or (size == 0 and ctypes.get_errno()):
            raise OSError(ctypes.get_errno(), 'proc_listpids group')
        count = size // ctypes.sizeof(ctypes.c_int)
        if count < capacity:
            return set(buffer[:count])
        capacity *= 2


def darwin_group_exited(group):
    """Confirm native exit and exclude members forked during exit observation."""
    members = _darwin_group_members(group)
    queue = select.kqueue()
    try:
        for pid in members:
            try:
                events = queue.control([select.kevent(
                    pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT,
                )], 1, 0)
            except ProcessLookupError:
                continue
            except PermissionError:
                return False  # An unreadable live member is not proof of exit.
            exited = False
            for event in events:
                if event.ident != pid:
                    continue
                if event.flags & select.KQ_EV_ERROR:
                    # Registration receipts retain the requested NOTE_EXIT bit.
                    # Only ESRCH proves exit; EPERM/EACCES do not.
                    if event.data != errno.ESRCH:
                        return False
                    exited = True
                elif event.filter == select.KQ_FILTER_PROC and event.fflags & select.KQ_NOTE_EXIT:
                    exited = True
            if not exited:
                return False
    finally:
        queue.close()
    # Once every old member exited, none can fork after this final census.
    return _darwin_group_members(group) <= members


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
