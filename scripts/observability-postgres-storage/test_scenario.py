"""Owning phase/decreasing-deadline controls; no PG/container/storage execution."""
import subprocess
from contextlib import ExitStack, contextmanager
import time
import unittest
from unittest.mock import patch
import scenario


@contextmanager
def baseline_ports(test, fault=None, primary=None, secondary=None, waiting=False):
    """Fixed external boundaries, independent of the phase being tested."""
    from types import SimpleNamespace
    from test_oracle import EXPECTED
    driver=scenario.Scenario(None,['compose'],'fixed',None)
    events=[];counts={};clock=[0];raised_tb=[None,None]
    stop=RuntimeError('stop after original baseline')
    def hit(port):
        counts[port]=counts.get(port,0)+1;events.append((port,counts[port]))
        if fault==(port,counts[port]):
            try:raise primary
            except BaseException as error:raised_tb[0]=error.__traceback__;raise
    def start():hit('start')
    def act(name,deadline):
        test.assertEqual(deadline,110)
        if name=='connections':hit('connections');raise stop
        test.assertEqual(name,'setup');hit('setup')
    def close(deadline):
        import sys
        raised_tb[1]=sys.exc_info()[2]
        test.assertEqual(deadline,280);hit('close')
        if secondary is not None:raise secondary
    driver.actors=SimpleNamespace(start=start,act=act,close=close)
    def acquire():
        hit('acquire');value=EXPECTED.copy();value['sample_us']+=counts['acquire']*1000
        if waiting and counts['acquire']==2:value['waiting_locks']=1
        return value
    def upload(value):
        hit('upload');test.assertEqual(value,scenario.frame.payload(sample(counts['acquire'])))
    def sample(index):
        value=EXPECTED.copy();value['sample_us']+=index*1000
        if waiting and index==2:value['waiting_locks']=1
        return value
    def read(token,verify,*,budget):
        test.assertEqual(token,'fixed');test.assertEqual(verify,driver.verify_storage);test.assertEqual(budget,10)
        hit('read');return ('raw','stamps','evaluated',0)
    def evaluate(*args,**kwargs):
        hit('oracle');test.assertEqual(kwargs['expected'],sample(counts['acquire']))
        return {'freshness':'missing' if counts['oracle']%2 else 'fresh','points':7,'age_seconds':0}
    ledger=driver.ledger.accept
    def accept(value):hit('ledger');return ledger(value)
    def monotonic():clock[0]+=1;return 100.0
    def sleep(delay):test.assertEqual(delay,scenario.pilot.POLL_INTERVAL_SECONDS);hit('pending')
    driver.oracle=SimpleNamespace(evaluate=evaluate)
    with ExitStack() as stack:
        for target,name,replacement in ((driver,'acquire',acquire),(driver,'upload',upload),
                (scenario.queries,'read',read),(driver.ledger,'accept',accept),
                (scenario.time,'monotonic',monotonic),(scenario.time,'sleep',sleep)):
            stack.enter_context(patch.object(target,name,side_effect=replacement))
        yield driver,events,clock,raised_tb,stop


class Driver(unittest.TestCase):
    def test_restart_readiness_uses_only_frozen_postgres_and_same_remaining_deadline(self):
        driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
        calls=[];deadlines=[];cid='a'*64
        def read(args):
            calls.append(args)
            if len(calls)==1:raise subprocess.CalledProcessError(1,args)
            return ''
        with patch.object(driver,'verify_pg',side_effect=deadlines.append),patch.object(driver,'read',side_effect=read), \
             patch.object(scenario.time,'sleep'):
            driver.await_postgres(cid)
        self.assertEqual(calls,[['docker','exec',cid,'pg_isready','-h','127.0.0.1','-p','5432','-t','1','-U','tracking','-d','tracking']]*2)
        self.assertEqual(len(set(deadlines)),1)
        self.assertLessEqual(deadlines[0],time.monotonic()+10)

    def test_restart_waits_for_final_tcp_not_temporary_unix_with_one_owned_deadline(self):
        from types import SimpleNamespace
        for expires in (False,True):
            with self.subTest(expires=expires):
                driver=scenario.Scenario(None,[],'fixed',None);driver.end=250
                cid='a'*64;clock=[100.0];state=['temporary'];caps=[];probes=[];owned=[]
                driver.targets=SimpleNamespace(postgres=lambda:cid)
                def daemon(*,deadline):owned.append(deadline)
                def command(args,*,timeout):
                    self.assertEqual(args[:4],['docker','exec',cid,'pg_isready'])
                    flags=dict(zip(args[4::2],args[5::2]))
                    self.assertEqual(flags['-U'],'tracking');self.assertEqual(flags['-d'],'tracking')
                    caps.append(timeout)
                    self.assertAlmostEqual(timeout,110-clock[0])
                    clock[0]+=min(.5,timeout)
                    if '-h' not in flags:
                        probes.append('temporary_unix_accepts');return ''
                    self.assertEqual(flags['-h'],'127.0.0.1');self.assertEqual(flags['-p'],'5432')
                    self.assertEqual(flags['-t'],'1')
                    if state[0]=='temporary':
                        probes.append('temporary_tcp_refuses');raise subprocess.CalledProcessError(1,args)
                    probes.append('persistent_tcp_accepts');return ''
                def sleep(delay):
                    self.assertGreater(delay,0);self.assertLessEqual(delay,scenario.pilot.POLL_INTERVAL_SECONDS)
                    clock[0]+=delay
                    if not expires:state[0]='persistent'
                with patch.object(scenario.time,'monotonic',side_effect=lambda:clock[0]), \
                     patch.object(scenario.time,'sleep',side_effect=sleep), \
                     patch.object(scenario.pilot,'assert_docker_identity',side_effect=daemon), \
                     patch.object(scenario.pilot,'command',side_effect=command):
                    if expires:
                        with self.assertRaises(TimeoutError):driver.await_postgres(cid)
                    else:
                        driver.await_postgres(cid)
                        self.assertEqual(probes,['temporary_tcp_refuses','persistent_tcp_accepts'])
                        self.assertEqual(state[0],'persistent')
                self.assertGreaterEqual(len(caps),2)
                self.assertTrue(all(a>b for a,b in zip(caps,caps[1:])))
                self.assertEqual(set(owned),{110.0});self.assertEqual(len(owned),len(probes))
        driver=scenario.Scenario(None,[],'fixed',None);driver.end=time.monotonic()+150
        primary=ValueError('ownership')
        with patch.object(scenario.pilot,'assert_docker_identity',side_effect=primary), \
             patch.object(scenario.pilot,'command') as command:
            try:driver.await_postgres('a'*64)
            except ValueError as error:self.assertIs(error,primary)
            else:self.fail('daemon ownership refusal suppressed')
        command.assert_not_called()

    def test_only_parent_verified_failed_acquisition_emits_current_zero_without_advancing_ledger(self):
        import capture
        for status in ('verified','unproved','cleanup','upload_failure'):
            driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
            primary=ValueError('cleanup') if status=='cleanup' else capture.ClosedClientFailure()
            if isinstance(primary,capture.ClosedClientFailure):primary.verified=status in ('verified','upload_failure')
            secondary=RuntimeError('controlled emission failure');uploads=[]
            def upload(value,*,deadline=None):
                uploads.append(value)
                if status=='upload_failure':raise secondary
            with self.subTest(status=status),patch.object(scenario.capture,'acquire',side_effect=primary), \
                 patch.object(scenario.time,'time_ns',return_value=1790000000000000000),patch.object(driver,'upload',side_effect=upload):
                try:driver.acquire()
                except ValueError as caught:self.assertIs(caught,primary)
                else:self.fail('failed acquisition returned a sample')
            self.assertIsNone(driver.ledger.last)
            if status in ('verified','upload_failure'):
                self.assertEqual(len(uploads),1)
                metrics=uploads[0]['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
                self.assertEqual(len(metrics),1);self.assertEqual(metrics[0]['name'],'inside.postgresql.server.available')
                self.assertEqual(metrics[0]['gauge']['dataPoints'],[{'attributes':[],'timeUnixNano':'1790000000000000000','asInt':'0'}])
            else:self.assertEqual(uploads,[])

    def test_stopped_owned_zero_requires_client_settlement_frozen_identity_and_exact_terminal_state(self):
        from types import SimpleNamespace
        for fault in (None,'cleanup','live_actor','before_owner','stop_error','wrong_stop','after_owner','state_error','running','oversize','expired','upload_error'):
            driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
            cid='a'*64;target={'id':cid,'image':'pinned-private'};calls=[];uploads=[];primary=RuntimeError('controlled first')
            def close(deadline):
                calls.append('close')
                if fault=='cleanup':raise primary
            actor=SimpleNamespace(close=close,process=SimpleNamespace(poll=lambda:None if fault=='live_actor' else 0))
            driver.actors=actor
            def inspect(role,identity):
                calls.append('inspect');self.assertEqual((role,identity),('postgres',cid))
                if fault=='after_owner':return {'id':'b'*64}
                return target
            driver.targets=SimpleNamespace(targets={'postgres':target},inspect=inspect)
            def verify(deadline):
                calls.append('verify')
                if fault=='before_owner':raise primary
            def read(args):
                calls.append(args)
                if args[:2]==['docker','stop']:
                    if fault=='stop_error':raise primary
                    return 'b'*64 if fault=='wrong_stop' else cid+'\n'
                self.assertEqual(args,['docker','inspect','--format',scenario.STOPPED,cid])
                if fault=='state_error':raise primary
                if fault=='expired':driver.end=time.monotonic()-1
                return 'running' if fault=='running' else 'x'*17 if fault=='oversize' else 'stopped\n'
            def upload(value,*,deadline=None):
                uploads.append(value)
                if fault=='upload_error':raise primary
            with self.subTest(fault=fault),patch.object(driver,'verify_pg',side_effect=verify),patch.object(driver,'read',side_effect=read), \
                 patch.object(driver,'upload',side_effect=upload),patch.object(scenario.pilot,'assert_docker_identity'), \
                 patch.object(scenario.time,'time_ns',return_value=1790000000000000000):
                if fault is None:self.assertEqual(driver.stop_postgres(),cid)
                else:
                    try:driver.stop_postgres()
                    except Exception as error:
                        if fault in ('cleanup','before_owner','stop_error','state_error','upload_error'):self.assertIs(error,primary)
                    else:self.fail('invalid stop proof admitted')
            self.assertEqual(len(uploads),1 if fault in (None,'upload_error') else 0)
            if uploads:
                metrics=uploads[0]['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
                self.assertEqual([(m['name'],m['gauge']['dataPoints'][0]) for m in metrics],
                    [('inside.postgresql.server.available',{'attributes':[],'timeUnixNano':'1790000000000000000','asInt':'0'})])
            if fault is None:
                self.assertEqual(calls[:3],['close','verify',['docker','stop','--time','2',cid]])
                self.assertEqual(calls[3],'inspect');self.assertEqual(len(calls),5)
            self.assertIsNone(driver.ledger.last)

    def test_real_stop_upload_composition_has_one_alarm_and_the_original_decreasing_deadline(self):
        import json
        import signal
        from pathlib import Path
        import postgres_source
        import source_status_scenario
        for fault in (None,'poisoned_state','poisoned_owner','expired','http_failure','expired_response'):
            clock=[100.0];requests=[];identity_deadlines=[];stopped=[False];primary=RuntimeError('controlled HTTP first')
            driver=scenario.Scenario(None,['docker','compose','-p','inside-observability-pilot-'+'a'*12,'-f','/task/compose.json'],'fixed',None)
            driver.end=250;driver.clock_deadline=110
            roles=('postgres','alloy','metrics','gateway');ids={role:f'{index+1:064x}' for index,role in enumerate(roles)}
            plan={'services':{role:{'image':'fixture/'+role+'@sha256:'+'a'*64,'networks':['pilot','ingress']} for role in roles},'volumes':{}}
            targets=postgres_source.ownership.Targets.__new__(postgres_source.ownership.Targets)
            targets.output=Path('/task');targets.compose=driver.compose;targets.project=driver.compose[3];targets.plan=plan;targets.read=driver.read
            targets._ownership_observer=None;targets._ownership_callback_error=None;targets.targets={};driver.targets=targets
            def daemon(args,**kwargs):
                self.assertLessEqual(kwargs['timeout'],10)
                if args[:6]==driver.compose:return ids[args[-1]]
                if args[:2]==['docker','stop']:
                    self.assertEqual(args,['docker','stop','--time','2',ids['postgres']]);stopped[0]=True;clock[0]=102;return ids['postgres']+'\n'
                self.assertEqual(args[:3],['docker','inspect','--format'])
                role=next(role for role in roles if ids[role]==args[-1])
                if args[3]==scenario.STOPPED:
                    self.assertTrue(stopped[0])
                    if fault=='expired':clock[0]=111
                    return 'unknown' if fault=='poisoned_state' else 'stopped\n'
                self.assertEqual(args[3],source_status_scenario.INSPECT)
                image=plan['services'][role]['image']
                if fault=='poisoned_owner' and stopped[0] and role=='postgres':image='foreign'
                return json.dumps({'id':ids[role],'image':image,'project':targets.project,'service':role,
                    'config_files':driver.compose[5],'mounts':[],'networks':{targets.project+'_'+name:{'NetworkID':key*64} for name,key in (('pilot','b'),('ingress','c'))}})
            def identity(**kwargs):identity_deadlines.append(kwargs['deadline'])
            class Response:
                status=200
                def __enter__(self):return self
                def __exit__(self,*_):return False
                def read(self,cap):
                    if fault=='expired_response':clock[0]=111
                    return b'{}'
            class Opener:
                def open(inner,request,timeout):
                    self.assertTrue(stopped[0]);self.assertLess(clock[0],110)
                    self.assertEqual(driver.clock_deadline,110);self.assertEqual(timeout,8)
                    self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0],0)
                    self.assertEqual(request.full_url,'http://127.0.0.1:14318/v1/metrics')
                    requests.append(request)
                    if fault=='http_failure':raise primary
                    return Response()
            with self.subTest(fault=fault),patch.object(scenario.time,'monotonic',side_effect=lambda:clock[0]), \
                 patch.object(scenario.pilot,'command',side_effect=daemon),patch.object(scenario.pilot,'assert_docker_identity',side_effect=identity), \
                 patch.object(scenario.urllib.request,'build_opener',return_value=Opener()):
                for role in roles:targets.targets[role]=targets.inspect(role,ids[role])
                if fault is None:self.assertEqual(driver.stop_postgres(),ids['postgres'])
                else:
                    try:driver.stop_postgres()
                    except Exception as error:
                        if fault=='http_failure':self.assertIs(error,primary)
                    else:self.fail('invalid composed stop returned success')
            self.assertEqual(requests!=[],fault in (None,'http_failure','expired_response'))
            self.assertTrue(all(deadline==110 for deadline in identity_deadlines))
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))

    def test_privacy_case_records_actual_completion_verdict_without_a_new_stored_query(self):
        from types import SimpleNamespace
        from test_oracle import EXPECTED
        driver=scenario.Scenario(None,['compose'],'fixed',None);observations={};counter=[0]
        verdict={'freshness':'fresh','continuity':'same_epoch','count_complete':True,'points':7,'age_seconds':0}
        def observe(*args,**kwargs):
            if counter[0]<2:
                self.assertEqual(kwargs,{'_baseline':('first','second')[counter[0]]});phase='baseline'
            else:
                self.assertEqual(kwargs,{});phase=driver.phase
            observations[phase]=observations.get(phase,0)+1;counter[0]+=1
            value=EXPECTED.copy();value['sample_us']+=counter[0]*1000
            if phase=='deadlocks':value['deadlocks']=EXPECTED['deadlocks']+1
            if phase in ('reset','restart','stale'):value['stats_reset_us']+=1000;value['deadlocks']=0
            if phase in ('restart','stale'):value['postmaster_us']+=1000
            state=driver.ledger.accept(value)
            return value,{**verdict,'continuity':state['continuity'],'count_complete':state['count_complete']}
        final={**verdict,'age_seconds':.125}
        driver.actors=SimpleNamespace(start=lambda:None,close=lambda deadline:None)
        driver.oracle=SimpleNamespace(evaluate=lambda *args,**kwargs:{'freshness':'unavailable' if driver.phase=='restart' else 'stale'})
        with patch.object(driver,'command'),patch.object(driver,'observe',side_effect=observe), \
                patch.object(driver,'stop_postgres',return_value='a'*64),patch.object(driver,'await_postgres'),patch.object(driver,'read'), \
                patch.object(scenario.queries,'read',return_value=('','','',0)),patch.object(driver,'stored',side_effect=AssertionError('new stored query forbidden')), \
                patch.object(scenario.time,'sleep'):
            cases=driver.run(lambda source:final)
        self.assertEqual(cases[-1],{**final,'phase':'privacy'})


    def test_baseline_entered_stage_preserves_first_failure_for_every_fixed_boundary(self):
        golden=(
            (('start',1),'baseline_actor_start'),(('setup',1),'baseline_setup'),
            (('acquire',1),'baseline_first_acquire'),(('upload',1),'baseline_first_upload'),
            (('read',1),'baseline_first_stored_read'),(('oracle',1),'baseline_first_stored_oracle'),
            (('pending',1),'baseline_first_stored_pending'),(('ledger',1),'baseline_first_ledger'),
            (('acquire',2),'baseline_second_acquire'),(('upload',2),'baseline_second_upload'),
            (('read',3),'baseline_second_stored_read'),(('oracle',3),'baseline_second_stored_oracle'),
            (('pending',2),'baseline_second_stored_pending'),(('ledger',2),'baseline_second_ledger'),
            (None,'baseline_waiting_locks'))
        order=[('start',1),('setup',1),('acquire',1),('upload',1),('read',1),('oracle',1),('pending',1),
            ('read',2),('oracle',2),('ledger',1),('acquire',2),('upload',2),('read',3),('oracle',3),
            ('pending',2),('read',4),('oracle',4),('ledger',2)]
        for fault,phase in golden:
            for kind in (RuntimeError,KeyboardInterrupt,SystemExit):
                for same in (False,True):
                    primary=kind('controlled first');secondary=primary if same else SystemExit('controlled cleanup')
                    with self.subTest(phase=phase,kind=kind,same=same), \
                            baseline_ports(self,fault,primary,secondary,waiting=fault is None) as (driver,events,clock,tb,stop):
                        try:driver.run(lambda _:self.fail('privacy reached'))
                        except BaseException as caught:
                            if fault is None:self.assertIs(type(caught),ValueError);self.assertEqual(caught.args,('query_refused',))
                            else:
                                self.assertIs(caught,primary)
                                self.assertIs(caught.__traceback__.tb_next,tb[1])
                                tail=tb[1]
                                while tail.tb_next is not None:tail=tail.tb_next
                                self.assertIs(tail,tb[0])
                        else:self.fail('controlled baseline failure returned')
                        self.assertEqual(driver.phase,phase);self.assertEqual(driver.cases,[])
                        expected=order if fault is None else order[:order.index(fault)+1]
                        self.assertEqual(events,expected+[('close',1)])

    def test_successful_baseline_keeps_original_order_counts_and_case_phase(self):
        with baseline_ports(self) as (driver,events,clock,tb,stop):
            with self.assertRaises(RuntimeError) as caught:driver.run(lambda _:self.fail('privacy reached'))
            self.assertIs(caught.exception,stop)
            self.assertEqual(events,[('start',1),('setup',1),('acquire',1),('upload',1),('read',1),('oracle',1),
                ('pending',1),('read',2),('oracle',2),('ledger',1),('acquire',2),('upload',2),('read',3),
                ('oracle',3),('pending',2),('read',4),('oracle',4),('ledger',2),('connections',1),('close',1)])
            self.assertEqual(clock[0],25)
            self.assertEqual(driver.phase,'connections')
            self.assertEqual(driver.cases,[{'freshness':'fresh','continuity':'same_epoch','count_complete':True,
                'points':7,'age_seconds':0,'phase':'baseline'}])

    def test_default_observe_and_stored_emit_no_baseline_checkpoint(self):
        for method in ('observe','stored'):
            with self.subTest(method=method),baseline_ports(self) as (driver,events,clock,tb,stop):
                driver.end=250;driver.phase='original'
                if method=='observe':driver.observe()
                else:
                    from test_oracle import EXPECTED
                    # The fixed external acquisition count supplies the original sample to the oracle.
                    value=driver.acquire();driver.stored(value)
                self.assertEqual(driver.phase,'original');self.assertEqual(driver.cases,[])
                self.assertEqual(events[-1],('ledger',1) if method=='observe' else ('oracle',2))

    def test_invalid_baseline_enum_refuses_before_work(self):
        for value in ('','third','baseline_first_acquire',[],{},True,1,object()):
            for method in ('observe','stored'):
                with self.subTest(value=type(value),method=method),baseline_ports(self) as (driver,events,clock,tb,stop):
                    driver.end=250;driver.phase='original'
                    with self.assertRaises(ValueError):
                        if method=='observe':driver.observe(_baseline=value)
                        else:driver.stored({},_baseline=value)
                    self.assertEqual(events,[]);self.assertEqual(clock,[0]);self.assertEqual(driver.phase,'original')

    def test_only_failed_setup_adopts_a_closed_owned_stage_and_preserves_primary(self):
        from types import SimpleNamespace
        phases=('baseline_setup_connect','baseline_setup_identity','baseline_setup_reader',
            'baseline_setup_grant_connect','baseline_setup_read_only','baseline_setup_schema',
            'baseline_setup_table','baseline_setup_rows','baseline_setup_reset')
        for phase in phases:
            for primary in (ValueError('query_refused'),KeyboardInterrupt(),SystemExit()):
                with self.subTest(phase=phase,kind=type(primary).__name__):
                    driver=scenario.Scenario(None,[],'fixed',None);driver.end=time.monotonic()+150
                    driver.phase='baseline_setup';seen=[];deadlines=[]
                    def act(name,deadline):
                        self.assertEqual(name,'setup');deadlines.append(deadline)
                        try:raise primary
                        except BaseException:seen.append(primary.__traceback__);raise
                    driver.actors=SimpleNamespace(act=act,setup_phase=phase)
                    try:driver.command('setup')
                    except BaseException as error:
                        self.assertIs(error,primary);trace=error.__traceback__
                        while trace is not None and trace is not seen[0]:trace=trace.tb_next
                        self.assertIs(trace,seen[0])
                    else:self.fail('setup failure suppressed')
                    self.assertEqual(driver.phase,phase);self.assertEqual(len(deadlines),1)
        for name,phase,failed in [('setup','baseline_setup_unknown',True),('setup',None,True),
                ('setup',[],True),('setup',True,True),('connections',phases[0],True),('setup',phases[0],False)]:
            driver=scenario.Scenario(None,[],'fixed',None);driver.end=time.monotonic()+150;driver.phase='baseline_setup'
            primary=ValueError('query_refused')
            def act(_name,_deadline):
                if failed:raise primary
            driver.actors=SimpleNamespace(act=act,setup_phase=phase)
            if failed:
                with self.assertRaises(ValueError):driver.command(name)
            else:driver.command(name)
            self.assertEqual(driver.phase,'baseline_setup')
