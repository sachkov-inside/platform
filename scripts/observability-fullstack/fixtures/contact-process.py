"""Benign process-group witness for the contact preparation scheduler, without Docker."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
import contact_job
import fullstack

mode=sys.argv[1];output=Path(sys.argv[2])
if mode=='contact-child':
    scenario=sys.argv[3]
    contact_job.verify(output,sys.argv[5])
    if scenario=='success':raise SystemExit(0)
    child=subprocess.Popen([sys.executable,'-c',
        'import pathlib,signal,socket,sys; p=pathlib.Path(sys.argv[1]); '
        's=socket.socket(socket.AF_UNIX); s.bind(str(p/"child.sock")); s.listen(); '
        '(p/"contact.ready").touch(); signal.pause()',str(output)])
    fullstack.pilot.await_fact(lambda:(output/'contact.ready').exists(),bool,budget=2)
    if scenario=='failure':raise SystemExit(7)
    signal.pause()
else:
    (output/'evidence.json').write_text(json.dumps({'source':'a'*40}))
    (output/'owner.json').write_text('{}')
    fullstack.pilot.await_fact(lambda:(output/'worker.json').exists(),bool,budget=2)
    with contact_job.start(output,[sys.executable,str(Path(__file__).resolve()),'contact-child',str(output),mode]) as job:
        if mode in ('main-failure','sigterm','sigkill'):
            fullstack.pilot.await_fact(lambda:(output/'contact.ready').exists(),bool,budget=2)
            if mode=='main-failure':raise ValueError('primary_preparation_failure')
            os.kill(os.getpid(),signal.SIGTERM if mode=='sigterm' else signal.SIGKILL)
        job.wait()
