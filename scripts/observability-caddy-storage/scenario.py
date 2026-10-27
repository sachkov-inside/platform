"""Linux-only genuine Caddy scenario. Protocol fixtures cannot establish native acceptance."""
import math
import http.client
import subprocess
import time
import accounting
import artifact
import caddy_mcp
import caddy_query
import caddy_status as status
import evidence
import inflight
import mcp_snapshot
import native_source
import request_hold
import traffic
import source_status_scenario as core


class AcquisitionBudgetRefusal(RuntimeError):
    def __init__(self):RuntimeError.__init__(self,'closed Caddy acquisition cap')


def failure_reason(error):
    kind=type(error)
    if kind is AcquisitionBudgetRefusal:return 'budget'
    if issubclass(kind,KeyboardInterrupt):return 'interrupted'
    if issubclass(kind,TimeoutError):return 'timeout'
    if issubclass(kind,ValueError):return 'contract'
    return 'unknown'


def reset_failure_reason(error):
    # This vocabulary diagnoses only a failure that actually escaped reset().
    # Never inspect foreign exception text, command arguments or subclasses.
    return {subprocess.CalledProcessError:'command_exit',subprocess.TimeoutExpired:'command_timeout',
            core.ScenarioFailed:'authority_refusal',http.client.RemoteDisconnected:'http_eof',
            ConnectionResetError:'http_reset',http.client.IncompleteRead:'http_body',
            http.client.BadStatusLine:'http_status',OSError:'host_io',BrokenPipeError:'host_io',
            FileNotFoundError:'host_io',PermissionError:'host_io',RuntimeError:'runtime'}.get(type(error),failure_reason(error))


class Scenario:
    def __init__(self,targets,token,executable,progress):
        self.targets,self.token,self.executable,self.progress=targets,token,executable,progress
        self.deadline=time.monotonic()+600
        self.journal=accounting.Traffic()
        self.acquisitions=0
        self.last_report=None
        self._reset_error=None
        self._mcp_startup_error=None

    def remaining(self):
        remaining=self.deadline-time.monotonic()
        if not 0<remaining<=600:raise TimeoutError()
        return remaining

    def phase(self,name):self.progress('phase',name)
    def passed(self,name):self.progress('case',name)

    def _partition_checkpoint(self,name):self.progress('partition_checkpoint',name)

    def _inflight_checkpoint(self,name):self.progress('inflight_checkpoint',name)

    def _recovery_checkpoint(self,name,*,_primary=None):
        self._optional_checkpoint('recovery_checkpoint',name,_primary=_primary)

    def _reset_checkpoint(self,name,*,_primary=None):
        self._optional_checkpoint('reset_checkpoint',name,_primary=_primary)

    def _optional_checkpoint(self,kind,name,*,_primary=None):
        try:self.progress(kind,name)
        except Exception:pass  # Optional diagnostics cannot block service restoration or replace its failure.
        except BaseException:
            if _primary is None:raise  # An operator interrupt still wins when no failure is active.

    def _mcp_startup_failed(self,error):self._mcp_startup_error=error

    def failed(self,error):
        if error is self._mcp_startup_error:
            reason={RuntimeError:'runtime',BrokenPipeError:'host_io',OSError:'host_io',
                    FileNotFoundError:'host_io',PermissionError:'host_io'}.get(type(error),failure_reason(error))
            self.progress('failure',reason)
            return
        self.progress('failure',reset_failure_reason(error) if error is self._reset_error else failure_reason(error))

    def _cohort_pause(self,value):
        if value[0]['state']!='observed':return 5
        stamp=self.stamp(value[1]);completed=status.clock(value[1]['completed_at'])
        # A validated source clock is only a scheduling hint. Query after the next
        # predicted frame's clock at a strictly later integer E, leaving at least5 quiet seconds after completion.
        periods=max(1,math.ceil((completed+5-stamp)/5))
        return float(max(5,math.floor(stamp+5*periods)+1-completed))

    def _until(self,read,predicate,*,deadline=None,poll_seconds=.25):
        if deadline is None:deadline=time.monotonic()+min(60,self.remaining())
        while time.monotonic()<deadline:
            self.remaining()
            value=read()
            if time.monotonic()>=deadline:raise TimeoutError()
            if predicate(value):return value
            time.sleep(min(poll_seconds,self.remaining(),max(0,deadline-time.monotonic())))
        raise TimeoutError()

    def _one(self,case):
        self.remaining()
        value=traffic.perform(case,self.token)
        self.journal.record(value['started'],value['completed'],value['method'],value['code'])
        return value

    def ready(self,*,_recovery=False):
        def read():
            if _recovery:self._recovery_checkpoint('gateway_recovery_ready')
            try:return self._one('recovery')
            except ConnectionRefusedError:
                if _recovery:self._recovery_checkpoint('gateway_recovery_refused')
                return None  # No accepted HTTP request; no counter admission inferred.
            except http.client.RemoteDisconnected as error:
                if type(error) is not http.client.RemoteDisconnected:raise
                if _recovery:self._recovery_checkpoint('gateway_recovery_eof')
                # Docker may accept the published socket before Caddy can answer HTTP.
                # No response/counter admission is invented; native comparisons stay strict.
                return None
            except BaseException as error:
                if _recovery:
                    phase={ConnectionResetError:'gateway_recovery_reset',TimeoutError:'gateway_recovery_timeout',
                           ValueError:'gateway_recovery_contract'}.get(type(error),'gateway_recovery_other')
                    self._recovery_checkpoint(phase,_primary=error)
                raise
        return self._until(read,lambda value:value is not None and value['code']==200)

    def seed(self,*,_partition_baseline=None):
        self.phase('seed')
        if _partition_baseline is not None:
            # Native vmauth deliberately spends2-3s rejecting an invalid token.
            # Schedule the unchanged corpus after the next projected scrape;
            # only later whole journal verification can admit the actual frames.
            point=math.floor(self.stamp(_partition_baseline)+5)+1
            time.sleep(min(max(0,point-time.time()),self.remaining()))
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

    def snapshot(self,previous=None,*,evaluated_at=None,deadline=None):
        if self.acquisitions>=128:raise AcquisitionBudgetRefusal()
        # A prior acquisition's completion cannot be later than the new fixed evaluation time.
        while previous is not None and math.floor(time.time())<math.ceil(previous['completed_at']):
            time.sleep(min(.05,self.remaining()))
        self.acquisitions+=1
        started=time.time()
        query_seconds=min(10,self.remaining())
        if deadline is not None:
            query_seconds=min(query_seconds,deadline-time.monotonic())
            if query_seconds<=0:raise TimeoutError()
        report,acquired=caddy_query.read_snapshot(self.token,previous=previous,
            deadline_seconds=query_seconds,diagnose=True,
            **({} if evaluated_at is None else {'evaluated_at':evaluated_at}))
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
        # Leave a full scrape interval quiet after a completed query, outside its
        # journal window. A start-to-start cadence can lock samples inside slow reads.
        if not _partition:
            return self._until(lambda:self.snapshot(previous),lambda value:value[0]['state']=='observed'
                and self.stamp(value[1])>status.clock(cut) and self.journal.boundary_clear(self.stamp(value[1])),poll_seconds=5)
        self._partition_checkpoint('partition_initial_acquire')
        deadline=time.monotonic()+min(60,self.remaining())
        next_read=None;followup_end=None
        def read():
            nonlocal cut,next_read,followup_end
            while next_read is not None:
                time.sleep(min(max(0,next_read-time.monotonic()),self.remaining(),max(0,deadline-time.monotonic())))
                now=time.monotonic()
                if now>=deadline:raise TimeoutError()
                if followup_end is None or now<followup_end:break
                # Expiry bounds query start, even if the OS overslept. No request
                # has begun; prepare a fresh quiet interval before another read.
                cut=max(status.clock(cut),status.clock(time.time())+5)
                next_read=now+5;followup_end=None
            if time.monotonic()>=deadline:raise TimeoutError()
            return self.snapshot(previous)
        def check(value):
            nonlocal cut,next_read,followup_end
            if value[0]['state']!='observed':
                self.last_report=value[0]
                self._partition_checkpoint('partition_initial_state')
            elif not self.stamp(value[1])>status.clock(cut):
                self._partition_checkpoint('partition_initial_after_cut')
            elif not self.journal.boundary_clear(self.stamp(value[1])):
                self._partition_checkpoint('partition_initial_boundary')
            else:return True
            now=time.monotonic()
            if value[0]['state']=='observed' and followup_end is not None and now<followup_end:
                # A valid old frame can precede publication by milliseconds. Keep
                # this pre-seed cut fixed for at most one scrape interval.
                next_read=now+.25
            else:
                pause=self._cohort_pause(value)
                cut=max(status.clock(cut),status.clock(value[1]['completed_at'])+5)
                next_read=now+pause
                followup_end=next_read+5 if value[0]['state']=='observed' else None
            return False
        return self._until(read,check,deadline=deadline,poll_seconds=0)

    def matching(self,canonical,*,previous=None,read=None):
        if read is None:
            report,mcp=mcp_snapshot.read_snapshot(self.executable,self.token,evaluated_at=canonical['evaluated_at'],
                previous=previous,progress=lambda phase:self.phase(phase),failure=self._mcp_startup_failed)
        else:report,mcp=read(evaluated_at=canonical['evaluated_at'],previous=previous)
        self.phase('mcp_compare')
        if report['state']!='observed':
            phase='mcp_compare_'+report['state']
            if phase in evidence.MCP_COMPARE_PHASES:self.phase(phase)
            status.refuse()
        expected_values,expected_stamps=status.acquire(**canonical)
        actual_values,actual_stamps=status.acquire(**mcp)
        for differs,phase in ((expected_values.keys()!=actual_values.keys(),'keys'),
                              (expected_values!=actual_values,'values'),
                              (expected_stamps!=actual_stamps,'timestamps')):
            if differs:
                self.phase('mcp_compare_'+phase);status.refuse()
        report['transport']['canonical']='passed'
        self.last_report=artifact.validate(report)
        return mcp

    def partition(self,cut):
        self.phase('partition')
        with mcp_snapshot.session(self.executable,self.token,progress=lambda phase:self.phase(phase),failure=self._mcp_startup_failed) as read:
            self.phase('partition')
            _,baseline=self.fresh_after(max(cut,time.time()),_partition=True)
            # Warmup precedes both sides of the accounting interval, not only the final query.
            batch_cut=self.seed(_partition_baseline=baseline)
            self.phase('partition')
            self._partition_checkpoint('partition_compare_acquire')
            def check(value):
                report,acquired=value
                if report['state']!='observed':
                    self._partition_checkpoint('partition_compare_state');return False
                if self.journal.verify(baseline,acquired) is not True:
                    self._partition_checkpoint('partition_compare_journal');return False
                return True
            deadline=time.monotonic()+min(60,self.remaining())
            while True:
                # Read the next historical cohort after its following scrape.
                # Its actual timestamp, completion age and journal must still pass.
                evaluated=math.floor(self.stamp(baseline)+10)
                def compare_read():
                    time.sleep(min(max(0,evaluated+1-time.time()),self.remaining(),max(0,deadline-time.monotonic())))
                    if time.monotonic()>=deadline:raise TimeoutError()
                    return self.snapshot(baseline,evaluated_at=evaluated)
                _,current=self._until(compare_read,check,deadline=deadline,poll_seconds=5)
                if self.stamp(current)>status.clock(batch_cut):break
                self._partition_checkpoint('partition_compare_after_cut')
                baseline=current
            self.matching(current,read=read)
        self.passed('partition');self.passed('mcp')
        source=self.targets.native_metrics()
        if source is None or source['request_errors_total']<1:status.refuse()
        self.passed('native_labels');self.passed('privacy')

    def held(self):
        self.phase('inflight')
        self._inflight_checkpoint('inflight_baseline')
        baseline=self.targets.native_raw()
        initial=native_source.parse(baseline)
        if initial is None or initial['in_flight']!=0:status.refuse()
        with mcp_snapshot.session(self.executable,self.token,progress=lambda phase:self.phase(phase),failure=self._mcp_startup_failed) as read:
            self.phase('inflight')
            self._inflight_checkpoint('inflight_open')
            with request_hold.Held(self.token) as held:
                # These registry reads are srv1 only. No8080 observation is sent before this exact1 witness.
                self._inflight_checkpoint('inflight_raw_held')
                held.assert_holding()
                raw=self.targets.native_raw()
                independent=native_source.parse(raw)
                held.assert_holding()
                if independent is None or independent['in_flight']!=1:status.refuse()
                registry_base=raw
                # Exclude a scrape already in progress before R. The registry's
                # sole active handler must first be this owned native read.
                self._inflight_checkpoint('inflight_registry_quiet')
                while native_source.scrape_registry(registry_base)['in_flight']!=1:
                    held.assert_holding();time.sleep(min(.25,self.remaining()))
                    registry_base=self.targets.native_raw()
                    held.assert_holding()
                self._inflight_checkpoint('inflight_registry_scrape')
                own_reads=0
                while True:
                    held.assert_holding()
                    current=self.targets.native_raw();own_reads+=1
                    held.assert_holding()
                    if inflight.scraped(registry_base,current,own_reads):break
                    time.sleep(min(.25,self.remaining()))
                # Freeze a historical integer E only after the proved scrape can
                # belong to E. This clock boundary never substitutes for the scrape.
                self._inflight_checkpoint('inflight_boundary')
                cut=math.ceil(time.time())
                while time.time()<cut:
                    held.assert_holding();time.sleep(min(.05,self.remaining()))
                publication_deadline=time.monotonic()+min(caddy_query.QUERY_SECONDS,self.remaining())
                self._inflight_checkpoint('inflight_release')
                held.finish()
                evaluated=math.floor(held.finished_at)
            def stored(value):
                report,canonical=value
                return (report['state']=='observed' and report['observation']['in_flight']>=1
                    and status.clock(held.started_at)<self.stamp(canonical)<status.clock(held.finished_at))
            self._inflight_checkpoint('inflight_stored')
            _,canonical=self._until(lambda:self.snapshot(evaluated_at=evaluated,deadline=publication_deadline),
                stored,deadline=publication_deadline)
            mcp=self.matching(canonical,read=read)
            self._inflight_checkpoint('inflight_cohort')
            inflight.validate(baseline=baseline,raw_held=raw,canonical=canonical,mcp=mcp,
                r_received=held.started_at,f_sent=held.finished_at)
        self.passed('inflight')

    def outages(self):
        self.phase('gateway_outage')
        self.targets.change('gateway','stop')
        outage_error=None
        try:
            unavailable=caddy_query.query(self.token)
            if unavailable['state']!='query_unavailable' or unavailable['observation'] is not None:status.refuse()
            try:
                mcp_snapshot.read_snapshot(self.executable,self.token,evaluated_at=math.floor(time.time()),
                    progress=lambda phase:self.phase(phase),failure=self._mcp_startup_failed)
            except caddy_mcp.QueryUnavailable:pass
            else:status.refuse()
            self.passed('gateway_unavailable')
        except BaseException as error:
            outage_error=error
            self.failed(error);raise
        finally:
            try:self._recovery_checkpoint('gateway_recovery_start',_primary=outage_error)
            finally:self.targets.change('gateway','start')
        self.ready(_recovery=True)
        recovered=self.seed()  # Restarted native counters/groups are lazy and must all be reseeded.
        self._recovery_checkpoint('gateway_recovery_fresh')
        self.fresh_after(recovered)
        self.phase('alloy_stale')
        self.targets.change('alloy','stop')
        try:
            self._until(self.snapshot,lambda value:value[0]['state'] in ('stale','missing'),poll_seconds=5)
            self.passed('alloy_stale')
        except BaseException as error:
            self.failed(error);raise
        finally:self.targets.change('alloy','start')
        self.fresh_after(time.time())

    def reset(self):
        self.phase('reset')
        try:
            self._reset_checkpoint('reset_load')
            for _ in range(64):last=self._one('http_get')
            self._reset_checkpoint('reset_old_fresh')
            _,old=self.fresh_after(last['completed'])
            self._reset_checkpoint('reset_stop')
            self.targets.change('gateway','stop')
            try:self._reset_checkpoint('reset_start')
            finally:self.targets.change('gateway','start')
            self._reset_checkpoint('reset_ready')
            self.ready()
            cut=self.seed()
            self._reset_checkpoint('reset_mcp_open')
            with mcp_snapshot.session(self.executable,self.token,progress=lambda phase:self.phase(phase),failure=self._mcp_startup_failed) as read:
                self._reset_checkpoint('reset_new_fresh')
                report,current=self.fresh_after(cut,previous=old)
                self._reset_checkpoint('reset_compare')
                if report['comparison']['state']!='reset_observed':status.refuse()
                self.matching(current,previous=old,read=read)
            self.passed('counter_reset')
        except BaseException as error:
            self._reset_error=error
            raise

    def run(self):
        self.ready()
        cut=self.seed()
        self.partition(cut)
        self.held()
        self.outages()
        self.reset()
        return self.last_report
