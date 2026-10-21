"""Linux-only genuine Caddy scenario. Protocol fixtures cannot establish native acceptance."""
import math
import time
import accounting
import artifact
import caddy_mcp
import caddy_query
import caddy_status as status
import inflight
import mcp_snapshot
import native_source
import request_hold
import traffic


class AcquisitionBudgetRefusal(RuntimeError):
    def __init__(self):RuntimeError.__init__(self,'closed Caddy acquisition cap')


def failure_reason(error):
    kind=type(error)
    if kind is AcquisitionBudgetRefusal:return 'budget'
    if issubclass(kind,KeyboardInterrupt):return 'interrupted'
    if issubclass(kind,TimeoutError):return 'timeout'
    if issubclass(kind,ValueError):return 'contract'
    return 'unknown'


class Scenario:
    def __init__(self,targets,token,executable,progress):
        self.targets,self.token,self.executable,self.progress=targets,token,executable,progress
        self.deadline=time.monotonic()+600
        self.journal=accounting.Traffic()
        self.acquisitions=0
        self.last_report=None

    def remaining(self):
        remaining=self.deadline-time.monotonic()
        if not 0<remaining<=600:raise TimeoutError()
        return remaining

    def phase(self,name):self.progress('phase',name)
    def passed(self,name):self.progress('case',name)

    def _partition_checkpoint(self,name):self.progress('partition_checkpoint',name)

    def failed(self,error):
        self.progress('failure',failure_reason(error))

    def _until(self,read,predicate):
        deadline=time.monotonic()+min(60,self.remaining())
        while time.monotonic()<deadline:
            self.remaining()
            value=read()
            if predicate(value):return value
            time.sleep(min(.25,self.remaining(),max(0,deadline-time.monotonic())))
        raise TimeoutError()

    def _one(self,case):
        self.remaining()
        value=traffic.perform(case,self.token)
        self.journal.record(value['started'],value['completed'],value['method'],value['code'])
        return value

    def ready(self):
        def read():
            try:return self._one('recovery')
            except ConnectionRefusedError:return None  # No accepted HTTP request; no counter admission inferred.
        return self._until(read,lambda value:value is not None and value['code']==200)

    def seed(self):
        self.phase('seed')
        for case in ('http_get','http_post','unauthorized','fallback','body_limit','privacy'):
            self._one(case)
            if case!='privacy':self.passed(case)
        self.targets.change('vmauth','stop')
        try:
            self._one('upstream_error');self.passed('upstream_error')
        except BaseException as error:
            self.failed(error);raise
        finally:self.targets.change('vmauth','start')
        return self.ready()['completed']

    def snapshot(self,previous=None):
        if self.acquisitions>=128:raise AcquisitionBudgetRefusal()
        # A prior acquisition's completion cannot be later than the new fixed evaluation time.
        while previous is not None and math.floor(time.time())<math.ceil(previous['completed_at']):
            time.sleep(min(.05,self.remaining()))
        self.acquisitions+=1
        started=time.time()
        report,acquired=caddy_query.read_snapshot(self.token,previous=previous,
            deadline_seconds=min(10,self.remaining()))
        if acquired is None or report['state']=='malformed' or report['transport']['canonical']!='passed':
            raise ValueError('closed Caddy canonical query refused')
        self.journal.record(started,time.time(),'GET',200,count=2)
        return report,acquired

    @staticmethod
    def stamp(acquired):
        _,stamps=status.acquire(**acquired)
        if not stamps or len(set(stamps.values()))!=1:status.refuse()
        return next(iter(stamps.values()))

    def fresh_after(self,cut,previous=None,*,_partition=False):
        if not _partition:
            return self._until(lambda:self.snapshot(previous),lambda value:value[0]['state']=='observed'
                and self.stamp(value[1])>status.clock(cut) and self.journal.boundary_clear(self.stamp(value[1])))
        self._partition_checkpoint('partition_initial_acquire')
        def check(value):
            if value[0]['state']!='observed':
                self._partition_checkpoint('partition_initial_state');return False
            if not self.stamp(value[1])>status.clock(cut):
                self._partition_checkpoint('partition_initial_after_cut');return False
            if not self.journal.boundary_clear(self.stamp(value[1])):
                self._partition_checkpoint('partition_initial_boundary');return False
            return True
        return self._until(lambda:self.snapshot(previous),check)

    def matching(self,canonical,*,previous=None):
        report,mcp=mcp_snapshot.read_snapshot(self.executable,self.token,evaluated_at=canonical['evaluated_at'],
            previous=previous,progress=lambda phase:self.phase(phase))
        if report['state']!='observed' or status.acquire(**canonical)!=status.acquire(**mcp):status.refuse()
        report['transport']['canonical']='passed'
        self.last_report=artifact.validate(report)
        return mcp

    def partition(self,cut):
        self.phase('partition')
        _,baseline=self.fresh_after(cut,_partition=True)
        # Repeat every controlled response class inside a journaled interval, including recovery502s.
        batch_cut=self.seed()
        self.phase('partition')
        self._partition_checkpoint('partition_compare_acquire')
        def check(value):
            report,acquired=value
            if report['state']!='observed':
                self._partition_checkpoint('partition_compare_state');return False
            if self.journal.verify(baseline,acquired) is not True:
                self._partition_checkpoint('partition_compare_journal');return False
            return True
        while True:
            _,current=self._until(lambda:self.snapshot(baseline),check)
            if self.stamp(current)>status.clock(batch_cut):break
            self._partition_checkpoint('partition_compare_after_cut')
            baseline=current
        self.matching(current)
        self.passed('partition');self.passed('mcp')
        source=self.targets.native_metrics()
        if source is None or source['request_errors_total']<1:status.refuse()
        self.passed('native_labels');self.passed('privacy')

    def held(self):
        self.phase('inflight')
        baseline=self.targets.native_raw()
        initial=native_source.parse(baseline)
        if initial is None or initial['in_flight']!=0:status.refuse()
        with request_hold.Held(self.token) as held:
            # These registry reads are srv1 only. No8080 observation is sent before this exact1 witness.
            held.assert_holding()
            raw=self.targets.native_raw()
            independent=native_source.parse(raw)
            held.assert_holding()
            if independent is None or independent['in_flight']!=1:status.refuse()
            while True:
                held.assert_holding()
                report,canonical=self.snapshot()
                if (report['state']=='observed' and report['observation']['in_flight']>=1
                        and self.stamp(canonical)>status.clock(held.started_at)):
                    mcp=self.matching(canonical)
                    held.finish()
                    inflight.validate(baseline=baseline,raw_held=raw,canonical=canonical,mcp=mcp,
                        r_received=held.started_at,f_sent=held.finished_at)
                    break
                time.sleep(min(.05,self.remaining()))
        self.passed('inflight')

    def outages(self):
        self.phase('gateway_outage')
        self.targets.change('gateway','stop')
        try:
            unavailable=caddy_query.query(self.token)
            if unavailable['state']!='query_unavailable' or unavailable['observation'] is not None:status.refuse()
            try:
                mcp_snapshot.read_snapshot(self.executable,self.token,evaluated_at=math.floor(time.time()),
                    progress=lambda phase:self.phase(phase))
            except caddy_mcp.QueryUnavailable:pass
            else:status.refuse()
            self.passed('gateway_unavailable')
        except BaseException as error:
            self.failed(error);raise
        finally:self.targets.change('gateway','start')
        self.ready()
        recovered=self.seed()  # Restarted native counters/groups are lazy and must all be reseeded.
        self.fresh_after(recovered)
        self.phase('alloy_stale')
        self.targets.change('alloy','stop')
        try:
            self._until(self.snapshot,lambda value:value[0]['state'] in ('stale','missing'))
            self.passed('alloy_stale')
        except BaseException as error:
            self.failed(error);raise
        finally:self.targets.change('alloy','start')
        self.fresh_after(time.time())

    def reset(self):
        self.phase('reset')
        for _ in range(64):last=self._one('http_get')
        _,old=self.fresh_after(last['completed'])
        self.targets.change('gateway','stop')
        self.targets.change('gateway','start')
        self.ready()
        cut=self.seed()
        self.phase('reset')
        report,current=self.fresh_after(cut,previous=old)
        if report['comparison']['state']!='reset_observed':status.refuse()
        self.matching(current,previous=old)
        self.passed('counter_reset')

    def run(self):
        self.ready()
        cut=self.seed()
        self.partition(cut)
        self.held()
        self.outages()
        self.reset()
        return self.last_report
