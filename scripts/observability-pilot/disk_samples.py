"""Bounded same-read observations; closure never proves monitor liveness."""
import threading

MAX_BYTES = 2**63-1
MAX_ID = 65535


class DiskSamples:
    """Only current/final immutable tuples cross the owning memory boundary."""
    def __init__(self):
        self._lock=threading.Lock()
        self._state=('unavailable','not_started',None,None,None,'unavailable',None)
        self._final=None
        self._sealed=False
        self._next=1

    @property
    def current(self):
        with self._lock:return self._state

    @property
    def final(self):
        with self._lock:return self._final

    def _refuse_locked(self,reason):
        if not self._sealed and self._state[0]!='refused':
            self._state=('refused',reason,*self._state[2:5],'refused',None)

    def _baseline(self,free):
        with self._lock:
            if type(free) is not int or not 0<=free<=MAX_BYTES:
                self._refuse_locked('numeric_refused');return
            point=(0,free)
            self._state=('observed','none',point,None,None,'baseline',point)

    def _point(self,free):
        with self._lock:
            if self._sealed or self._state[0]=='refused':return None
            try:
                if type(free) is not int or not 0<=free<=MAX_BYTES or self._next is None:
                    self._refuse_locked('numeric_refused');return None
                point=(self._next,free)
                self._next=self._next+1 if self._next<MAX_ID else None
                return point
            except BaseException:
                self._refuse_locked('sample_failure');return None

    def _publish(self,kind,point=None):
        with self._lock:
            if self._sealed or self._state[0]=='refused':return
            try:
                baseline,safe,stopping=self._state[2:5]
                if kind in ('safe','stopping'):
                    if point is None:
                        self._refuse_locked('sample_failure');return
                    if kind=='safe':safe=point
                    else:stopping=point
                    self._state=('observed','none',baseline,safe,stopping,kind,point)
                else:
                    self._state=('unavailable',kind,baseline,safe,None,'unavailable',None)
            except BaseException:self._refuse_locked('sample_failure')

    def _safe(self,point):self._publish('safe',point)
    def _stopping(self,point):self._publish('stopping',point)
    def _unavailable(self,reason):self._publish(reason)

    def _baseline_failure(self):
        with self._lock:self._refuse_locked('sample_failure')

    def _seal(self):
        with self._lock:
            self._sealed=True
            self._final=self._state
