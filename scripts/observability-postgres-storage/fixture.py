"""One private fixed-command fixture child, tracked by the existing outside worker owner."""
import json
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
COMMANDS=('setup','connections','disconnect_one','lock','release','deadlock','reset','sampler_absent','close')


class Fixture:
    def __init__(self):self.process=None

    def start(self):
        if self.process is not None and self.process.poll() is None:raise ValueError('ownership')
        node=shutil.which('node')
        if node is None:raise ValueError('connection')
        node=Path(node).resolve()
        self.process=subprocess.Popen([str(node),str(HERE/'fixture.mjs')],cwd=HERE.parents[1],
             env={'PATH':str(node.parent)+':/usr/bin:/bin'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)

    def act(self,command,deadline):
        if command not in COMMANDS or self.process is None:raise ValueError('query_refused')
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        # All public query calls and the entire command share the decreasing caller deadline.
        wire=(json.dumps({'command':command,'budget_ms':min(10000,max(1,int(remaining*1000)))},separators=(',',':'))+'\n').encode()
        if self.process.poll() is not None:raise ValueError('query_refused')
        self.process.stdin.write(wire);self.process.stdin.flush();raw=bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout,selectors.EVENT_READ)
            while True:
                left=deadline-time.monotonic()
                if left<=0 or not selector.select(left):raise TimeoutError()
                part=self.process.stdout.read1(min(513-len(raw),512))
                if not part:raise ValueError('query_refused')
                raw.extend(part)
                if len(raw)>512:raise ValueError('malformed')
                if b'\n' in raw:break
        expected=(json.dumps({'schema':1,'command':command,'state':'done'},separators=(',',':'))+'\n').encode()
        if raw!=expected:raise ValueError('malformed')

    def close(self,deadline):
        if self.process is None:return
        primary,tb=sys.exc_info()[1:];failure=None
        try:
            try:
                remaining=deadline-time.monotonic()
                if self.process.poll() is None and remaining>4:
                    self.act('close',min(deadline-4,time.monotonic()+10))
                    # Acknowledgement precedes process exit. Retain the existing final four-second reserve.
                    graceful=deadline-time.monotonic()-4
                    if graceful>0:
                        try:self.process.wait(timeout=min(2,graceful))
                        except subprocess.TimeoutExpired:pass
            finally:
                if self.process.poll() is None:
                    self.process.terminate()
                    try:self.process.wait(timeout=max(.001,min(2,deadline-time.monotonic())))
                    except subprocess.TimeoutExpired:self.process.kill()
                status=self.process.wait(timeout=max(.001,min(2,deadline-time.monotonic())))
                if status!=0:raise ValueError('cleanup')
        except BaseException as error:failure=error
        finally:
            for stream in (self.process.stdin,self.process.stdout):
                try:stream.close()
                except BaseException as error:
                    if failure is None:failure=error
        if primary is not None:BaseException.__traceback__.__set__(primary,tb)
        elif failure is not None:raise ValueError('cleanup') from None
