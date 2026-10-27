"""Prepared actual disposable PG phase driver; no mutation happens on import."""
from pathlib import Path
import sys
import time
import json
import math
import subprocess
import urllib.request
import urllib.error
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import pilot
import source_status_query
import capture
import frame
import fixture
import record
from types import ModuleType
import queries
import pg_ownership
import completion
# Caller loads this owner's oracle by its fixed file identity, avoiding cross-owner module-name aliases.
STOPPED='{{if and (eq .State.Status "exited") (not .State.Running) (not .State.Restarting) (not .State.Dead) (not .State.Paused) (not .State.OOMKilled) (eq .State.Pid 0) (eq .State.ExitCode 0) (eq .State.Error "")}}stopped{{end}}'


# Two fixed source calls only; these literals report entry, never successful completion.
BASELINE_PHASES={
    'first':{'acquire':'baseline_first_acquire', 'upload':'baseline_first_upload', 'stored_read':'baseline_first_stored_read', 'stored_oracle':'baseline_first_stored_oracle', 'stored_pending':'baseline_first_stored_pending', 'ledger':'baseline_first_ledger'},
    'second':{'acquire':'baseline_second_acquire', 'upload':'baseline_second_upload', 'stored_read':'baseline_second_stored_read', 'stored_oracle':'baseline_second_stored_oracle', 'stored_pending':'baseline_second_stored_pending', 'ledger':'baseline_second_ledger'},
}

class Scenario:
    def __init__(self,targets,compose,token,oracle):
        self.targets,self.compose,self.token,self.oracle=targets,compose,token,oracle
        self.phase='acquisition';self.clock_deadline=None;self.end=None;self.cleanup_end=None;self.last_attempt=None
        self.actors=fixture.Fixture();self.ledger=frame.Ledger();self.cases=[];self.oracle_failure_reason=None;self.upload_operation=None;self.visibility=[];self.visibility_overflow=False
        self.restart_down=None
        self.published_sample=None

    def note_visibility(self,step,started,value,observed=None,previous=False,*,finished=None,completed_us=None):
        # Closed built-in numbers only. No transport/provider content enters this witness.
        if len(self.visibility)>=64:self.visibility_overflow=True;return
        finished=time.monotonic() if finished is None else finished
        completed_us=time.time_ns()//1000 if completed_us is None else completed_us
        age=observed.get('age_seconds') if observed is not None else None
        sample=value.get('sample_us') if type(value) is dict else None
        expected_age=int((completed_us-sample)/1000) if type(sample) is int else None
        if expected_age is not None and not -2000<=expected_age<=180000:expected_age=None
        self.visibility.append({'phase':self.phase,'step':step,'elapsed_ms':max(0,int((finished-started)*1000)),
            'expected_age_ms':expected_age,
            'stored_age_ms':int(age*1000) if type(age) in (int,float) and math.isfinite(age) else None,
            'freshness':observed['freshness'] if observed is not None else None,'previous_committed':previous})

    def remaining(self,cap=10):
        value=min(cap,self.end-time.monotonic())
        if value<=0:raise TimeoutError()
        return value

    def read(self,args,**kwargs):
        deadline=self.clock_deadline
        if deadline is None:raise ValueError('ownership')
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        return pilot.command(args,timeout=min(kwargs.get('timeout',remaining),remaining))

    def verify_pg(self,deadline):
        self.clock_deadline=deadline
        pilot.assert_docker_identity(deadline=deadline)
        try:self.targets.postgres()
        except Exception:raise ValueError('ownership') from None
        if time.monotonic()>=deadline:raise TimeoutError()

    def verify_storage(self,deadline):
        self.clock_deadline=deadline;pilot.assert_docker_identity(deadline=deadline)
        # Batch only discovery; every fixed role still receives its complete identity inspection.
        roles=('alloy','metrics','gateway')
        current=self.read(self.compose+['ps','-q',*roles]).splitlines()
        expected=[self.targets.targets[role]['id'] for role in roles]
        if len(current)!=len(expected) or set(current)!=set(expected):raise ValueError('ownership')
        for role in roles:
            target=self.targets.targets[role]
            if self.targets.inspect(role,target['id'])!=target:raise ValueError('ownership')
        if time.monotonic()>=deadline:raise TimeoutError()

    def await_postgres(self,cid):
        deadline=time.monotonic()+self.remaining()
        while True:
            self.verify_pg(deadline)
            try:self.read(['docker','exec',cid,*pg_ownership.PG_READY_COMMAND])
            except subprocess.CalledProcessError:
                left=min(pilot.POLL_INTERVAL_SECONDS,deadline-time.monotonic())
                if left<=0:raise TimeoutError()
                time.sleep(left)
            else:return

    def command(self,name):
        try:self.actors.act(name,time.monotonic()+self.remaining())
        except BaseException:
            if name=='setup':
                phase=getattr(self.actors,'setup_phase',None)
                if type(phase) is str and phase in fixture.SETUP_PHASES.values():self.phase=phase
            raise

    def acquire(self):
        if self.last_attempt is not None:
            left=2-(time.monotonic()-self.last_attempt)
            if left>0:
                if left>=self.remaining():raise TimeoutError()
                # Rate bounds only: a fresh admitted SQL/owned storage fact ends each phase, never this pause.
                time.sleep(left)
        self.last_attempt=time.monotonic()
        try:value=capture.acquire(self.verify_pg,lambda deadline:self.actors.act('sampler_absent',deadline),budget=self.remaining(4))
        except capture.ClosedClientFailure as primary:
            tb=sys.exc_info()[2]
            try:
                if primary.verified:self.upload(frame.unavailable_payload(time.time_ns()//1000))
            except BaseException:pass
            finally:BaseException.__traceback__.__set__(primary,tb)
            raise
        self.remaining()
        return value

    def before_unsafe_upload(self):
        # Existing finite service guard, bounded by this phase's remaining work, never a fresh allowance.
        with source_status_query._deadline(self.remaining()):
            pilot.verify_trace_store_logging(self.targets.output,self.compose,service='alloy')
        self.remaining()

    def upload(self,value,*,deadline=None):
        self.upload_operation={'schema':1,'phase':self.phase,'step':'deadline','outcome':'running','error':None,'http_status':None,'returncode':None}
        try:
            # One decreasing publication deadline covers ACK and the fixture-only barrier.
            if deadline is None:deadline=min(self.end,time.monotonic()+10)
            self._upload(value,deadline=deadline)
            self.upload_operation['step']='controlled_flush'
            completion._flush(self,deadline)
            completion.remaining(deadline)
            self.upload_operation.update(step='controlled_publication',outcome='passed')
        except BaseException as error:
            code=getattr(error,'returncode',None)
            status=error.code if isinstance(error,urllib.error.HTTPError) else self.upload_operation['http_status']
            category=('timeout' if isinstance(error,(TimeoutError,subprocess.TimeoutExpired)) else
                'http_status' if isinstance(error,urllib.error.HTTPError) else
                'transport' if isinstance(error,(urllib.error.URLError,OSError)) else
                'command_failed' if isinstance(error,subprocess.CalledProcessError) else
                'interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else
                'invalid_result' if isinstance(error,ValueError) else 'operation_failed')
            self.upload_operation.update(outcome='failed',error=category,
                http_status=status if type(status) is int and 100<=status<=599 else None,
                returncode=code if type(code) is int and -128<=code<=255 else None)
            raise

    def _upload(self,value,*,deadline=None):
        now=time.monotonic()
        if deadline is None:deadline=min(self.end,now+10)
        if type(deadline) not in (int,float) or not math.isfinite(deadline) or deadline>self.end or deadline-now>10:raise ValueError('collector')
        if deadline<=now:raise TimeoutError()
        self.upload_operation['step']='owner_before'
        self.verify_storage(deadline)
        self.upload_operation['step']='payload'
        body=json.dumps(value,separators=(',',':'),allow_nan=False).encode()
        if len(body)>65536:raise ValueError('malformed')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),source_status_query.NoRedirect())
        request=urllib.request.Request('http://127.0.0.1:14318/v1/metrics',data=body,method='POST',headers={'Content-Type':'application/json'})
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        with source_status_query._deadline(remaining):
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError()
            self.upload_operation['step']='http_open'
            with opener.open(request,timeout=remaining) as response:
                self.upload_operation['http_status']=response.status if type(response.status) is int and 100<=response.status<=599 else None
                self.upload_operation['step']='http_body'
                raw=response.read(4097)
                if response.status!=200 or len(raw)>4096:raise ValueError('collector')
                try:ack=record.decode(raw)
                except ValueError:raise ValueError('collector') from None
                if ack not in ({},{'partialSuccess':{}}):raise ValueError('collector')
        self.upload_operation['step']='owner_after'
        self.verify_storage(deadline)
        self.upload_operation['step']='complete'
        if time.monotonic()>=deadline:raise TimeoutError()

    def stored(self,value,*,_baseline=None):
        self.oracle_failure_reason=None
        if _baseline is not None and (type(_baseline) is not str or _baseline not in BASELINE_PHASES):raise ValueError('query_refused')
        phases=None if _baseline is None else BASELINE_PHASES[_baseline]
        deadline=time.monotonic()+min(30,self.remaining(30))
        while time.monotonic()<deadline:
            self.oracle_failure_reason=None
            if phases is not None:self.phase=phases['stored_read']
            query_started=time.monotonic();query_deadline=min(deadline,query_started+10)
            raw,stamps,evaluated,completed=queries.read(self.token,self.verify_storage,budget=query_deadline-time.monotonic())
            if phases is not None:self.phase=phases['stored_oracle']
            observed=self.oracle.evaluate(raw,stamps,evaluated_at=evaluated,completed_us=completed,expected=value,**({} if phases is None else {'diagnose':True}))
            previous_pending=(observed['freshness']=='stale' and self.ledger.last is not None and type(self.oracle) is ModuleType
                and self.oracle.previous_committed_pending(raw,stamps,evaluated_at=evaluated,completed_us=completed,previous=self.ledger.last,expected=value))
            down_pending=(self.phase=='restart_observe' and self.restart_down is not None and self.ledger.last is not None
                and type(self.oracle) is ModuleType and self.oracle.controlled_down_pending(raw,stamps,
                    evaluated_at=evaluated,completed_us=completed,previous=self.ledger.last,expected=value,down=self.restart_down))
            fragments_pending=(observed['freshness']=='malformed' and self.published_sample==value and self.ledger.last is not None
                and type(self.oracle) is ModuleType and self.oracle.acknowledged_fragments_pending(raw,stamps,
                    evaluated_at=evaluated,completed_us=completed,previous=self.ledger.last,expected=value,
                    down=self.restart_down if self.phase=='restart_observe' else None))
            query_finished=time.monotonic()
            if time.monotonic()>=query_deadline:raise TimeoutError()
            if phases is not None:self.note_visibility('stored',query_started,value,observed,previous_pending,finished=query_finished,completed_us=completed)
            if observed['freshness']=='fresh':return observed
            if observed['freshness'] not in ('missing',) and not previous_pending and not down_pending and not fragments_pending:
                if phases is not None and type(self.oracle) is ModuleType:
                    try:
                        reason=self.oracle.diagnostic_reason(observed)
                        if type(reason) is str and reason in record.ORACLE_REASONS:self.oracle_failure_reason=reason
                    except BaseException:pass
                raise ValueError('storage')
            if phases is not None:self.phase=phases['stored_pending']
            left=min(pilot.POLL_INTERVAL_SECONDS,deadline-time.monotonic())
            if left>0:time.sleep(left)
        raise TimeoutError()

    def observe(self,predicate=lambda _:True,settle_before_publish=None,*,_baseline=None):
        if _baseline is not None and (type(_baseline) is not str or _baseline not in BASELINE_PHASES):raise ValueError('query_refused')
        phases=None if _baseline is None else BASELINE_PHASES[_baseline]
        deadline=time.monotonic()+self.remaining()
        while True:
            if time.monotonic()>=deadline:raise TimeoutError()
            if phases is not None:self.phase=phases['acquire']
            acquire_started=time.monotonic()
            value=self.acquire()
            if phases is not None:self.note_visibility('acquired',acquire_started,value)
            if predicate(value):break
        if settle_before_publish is not None:settle_before_publish()
        if phases is not None:self.phase=phases['upload']
        upload_started=time.monotonic()
        self.upload(frame.payload(value))
        if phases is not None:self.note_visibility('controlled_publication',upload_started,value)
        self.published_sample=value.copy()
        try:observed=self.stored(value) if phases is None else self.stored(value,_baseline=_baseline)
        finally:self.published_sample=None
        if phases is not None:self.phase=phases['ledger']
        continuity=self.ledger.accept(value)
        return value,{**observed,'continuity':continuity['continuity'],'count_complete':continuity['count_complete']}

    def case(self,phase,observation):
        self.cases.append({key:observation[key] for key in ('freshness','continuity','count_complete','points','age_seconds')}|{'phase':phase})

    def stop_postgres(self):
        """Only an explicitly owned graceful stop with settled clients may emit controlled-down zero."""
        deadline=time.monotonic()+self.remaining()
        self.phase='restart_close_clients'
        self.actors.close(deadline)
        if self.actors.process is not None and self.actors.process.poll()!=0:raise ValueError('cleanup')
        self.phase='restart_stop_identity'
        self.verify_pg(deadline);cid=self.targets.targets['postgres']['id']
        self.clock_deadline=deadline
        self.phase='restart_stop_command'
        stopped=self.read(['docker','stop','--timeout','2',cid])
        if type(stopped) is not str or len(stopped.encode('utf-8'))>65 or stopped not in (cid,cid+'\n'):raise ValueError('ownership')
        pilot.assert_docker_identity(deadline=deadline)
        self.phase='restart_stopped_identity'
        if self.targets.inspect('postgres',cid)!=self.targets.targets['postgres']:raise ValueError('ownership')
        self.phase='restart_stopped_state'
        state=self.read(['docker','inspect','--format',STOPPED,cid])
        # Logical cap on the fixed daemon-side boolean projection, not a general subprocess allocation cap.
        if type(state) is not str or len(state.encode('utf-8'))>16 or state not in ('stopped','stopped\n'):raise ValueError('ownership')
        if time.monotonic()>=deadline:raise TimeoutError()
        self.remaining()
        self.phase='restart_unavailable_upload'
        self.upload(frame.unavailable_payload(time.time_ns()//1000),deadline=deadline)
        self.actors=fixture.Fixture()
        return cid

    def run(self,privacy):
        """privacy is the one source-specific protocol driver, separately reviewed before wiring."""
        started=time.monotonic();self.end=started+150;self.cleanup_end=started+180
        primary=None;primary_tb=None
        try:
            self.phase='baseline_actor_start'
            self.actors.start()
            self.phase='baseline_setup'
            self.command('setup')
            baseline,_=self.observe(_baseline='first');baseline,verdict=self.observe(_baseline='second')
            self.phase='baseline_waiting_locks'
            if baseline['waiting_locks']!=0:raise ValueError('query_refused')
            self.phase='baseline'
            self.case('baseline',verdict)
            self.phase='connections'
            self.command('connections');connected,_=self.observe(lambda value:value['connected_backends']>=baseline['connected_backends']+2)
            self.command('disconnect_one');_,verdict=self.observe(lambda value:baseline['connected_backends']<=value['connected_backends']<connected['connected_backends'])
            self.case('connections',verdict)
            self.phase='locks'
            self.command('lock');self.observe(lambda value:value['waiting_locks']>=1,lambda:self.command('release'))
            _,verdict=self.observe(lambda value:value['waiting_locks']==0)
            self.case('locks',verdict)
            self.phase='deadlocks'
            before=self.ledger.last
            self.command('deadlock');deadlock,verdict=self.observe(lambda value:value['deadlocks']==before['deadlocks']+1)
            if deadlock['postmaster_us']!=before['postmaster_us'] or deadlock['stats_reset_us']!=before['stats_reset_us']:raise ValueError('reset')
            self.case('deadlocks',verdict)
            self.phase='reset'
            self.command('reset');reset,verdict=self.observe(lambda value:value['stats_reset_us']!=deadlock['stats_reset_us'] and value['deadlocks']==0)
            if verdict['continuity']!='statistics_reset' or verdict['count_complete']:raise ValueError('reset')
            self.case('reset',verdict)
            self.phase='restart'
            cid=self.stop_postgres()
            self.phase='restart_unavailable_read'
            unavailable_deadline=time.monotonic()+self.remaining()
            while True:
                self.oracle_failure_reason=None
                if time.monotonic()>=unavailable_deadline:raise TimeoutError()
                values,stamps,evaluated,completed=queries.read(self.token,self.verify_storage,budget=min(10,unavailable_deadline-time.monotonic()))
                down=self.oracle.evaluate(values,stamps,evaluated_at=evaluated,completed_us=completed,expected=reset,diagnose=True)
                if down['freshness']=='unavailable':
                    self.restart_down=(values,stamps,evaluated,completed)
                    break
                if down['freshness'] not in ('fresh','missing'):
                    if type(self.oracle) is ModuleType:
                        try:
                            reason=self.oracle.diagnostic_reason(down)
                            if type(reason) is str and reason in record.ORACLE_REASONS:self.oracle_failure_reason=reason
                        except BaseException:pass
                    raise ValueError('storage')
                # Old retained healthy rows are pending in this controlled down phase, never a successful down verdict.
                time.sleep(min(.25,max(0,unavailable_deadline-time.monotonic())))
            self.phase='restart_start_command'
            self.clock_deadline=time.monotonic()+self.remaining();self.read(['docker','start',cid])
            self.phase='restart_ready'
            self.await_postgres(cid)
            self.actors.start()
            self.phase='restart_observe'
            restarted,verdict=self.observe(lambda value:value['postmaster_us']!=reset['postmaster_us'])
            if verdict['continuity']!='server_restart' or verdict['count_complete']:raise ValueError('reset')
            self.case('restart',verdict)
            self.phase='stale'
            # No sampler is a daemon: stop publication and observe retained data age past ten seconds.
            end=time.monotonic()+self.remaining(12);stale=None
            while time.monotonic()<end:
                values,stamps,evaluated,completed=queries.read(self.token,self.verify_storage,budget=min(10,end-time.monotonic()))
                stale=self.oracle.evaluate(values,stamps,evaluated_at=evaluated,completed_us=completed,expected=restarted)
                if stale['freshness'] in ('stale','missing'):break
                if stale['freshness']!='fresh':raise ValueError('storage')
                time.sleep(min(.25,max(0,end-time.monotonic())))
            if stale is None or stale['freshness'] not in ('stale','missing'):raise ValueError('stale')
            _,verdict=self.observe();self.case('stale',verdict)
            self.phase='privacy'
            self.case('privacy',privacy(self))
        except BaseException as error:
            primary,primary_tb=error,sys.exc_info()[2]
            raise
        finally:
            try:self.actors.close(self.cleanup_end)
            except BaseException:
                if primary is None:raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,primary_tb)
        return self.cases
