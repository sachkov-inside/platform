"""Expected hosted faults require their owning outcome and exact typed absence proof."""
import math
import os
import re
import signal
import stat
import artifact
import caddy_status as status
import pilot

MODES=('baseline','failure','timeout','interruption')


def _legacy(output,name):
    if name not in ('cleanup.json','worker-outcome.json','owner.json'):artifact.refuse()
    with artifact.directory(output) as directory_fd:
        descriptor=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory_fd)
        with os.fdopen(descriptor,'rb') as stream:
            before=os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or before.st_nlink!=1
                    or stat.S_IMODE(before.st_mode) not in (0o600,0o644) or before.st_size>65536):artifact.refuse()
            raw=stream.read(65537);after=os.fstat(stream.fileno());linked=os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
            identity=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_nlink,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
            if len(raw)>65536 or identity(before)!=identity(after) or identity(after)!=identity(linked):artifact.refuse()
    return status.source_status.decode_json(raw)


def owner(output):return _legacy(output,'owner.json')


def cleanup(output):return _legacy(output,'cleanup.json')


def verify(output,mode,*,command_exit):
    if mode not in MODES[1:] or type(command_exit) is not int or command_exit!=(130 if mode=='interruption' else 1):artifact.refuse()
    run=artifact.read_run(output)
    if run is None or artifact.read(output) is not None:artifact.refuse()
    if (run['phase']!='identity' or run['cases']!={case:'passed' if case in ('logging','identity') else 'unrun' for case in run['cases']}
            or mode=='failure' and (run['state'],run['reason'])!=('failed','contract')
            or mode!='failure' and (run['state'],run['reason']) not in (('incomplete','none'),('interrupted','interrupted'))):artifact.refuse()
    cleanup=_legacy(output,'cleanup.json');outcome=_legacy(output,'worker-outcome.json')
    if (type(cleanup) is not dict or set(cleanup)!={'diagnostics','down','residue','source_freshness'}
            or any(cleanup[key]!='passed' for key in ('diagnostics','down','residue'))):artifact.refuse()
    typed=cleanup['source_freshness']
    if (type(typed) is not dict or set(typed)!={'outcome','containers','volumes','networks'} or typed['outcome']!='passed'
            or any(type(typed[key]) is not int or typed[key]!=count for key,count in (('containers',7),('volumes',4),('networks',2)))):artifact.refuse()
    if (type(outcome) is not dict or set(outcome)!={'exit_code','duration_seconds','monitor_failed','cleanup'}
            or type(outcome['exit_code']) is not int or outcome['exit_code']!=(124 if mode=='timeout' else 1)
            or outcome['monitor_failed'] is not False or outcome['cleanup']!=cleanup
            or status.clock(outcome['duration_seconds'])>pilot.PILOT_DEADLINE_SECONDS+2*pilot.WORKER_SHUTDOWN_SECONDS+1):artifact.refuse()
    if mode=='timeout' and status.clock(outcome['duration_seconds'])<pilot.PILOT_DEADLINE_SECONDS:artifact.refuse()
    return True


def inject(mode,owner):
    if mode not in MODES:artifact.refuse()
    if mode=='baseline':return
    if (type(owner) is not dict or type(owner.get('supervisor_pid')) is not int
            or owner['supervisor_pid']!=os.getppid() or owner.get('cwd')!=str(pilot.ROOT)
            or type(owner.get('project')) is not str or re.fullmatch(r'inside-observability-pilot-[0-9a-f]{12}',owner['project']) is None):artifact.refuse()
    if mode=='failure':raise ValueError('closed Caddy controlled failure')
    if mode=='interruption':os.kill(os.getppid(),signal.SIGTERM)
    # Timeout uses the existing600s outer deadline. Parent interruption uses its existing cleanup.
    while True:signal.pause()
