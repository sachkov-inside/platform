"""Native health history remains observational through the real phase and collector."""
from contextlib import ExitStack
from datetime import datetime,timedelta,timezone
import json
import copy
from pathlib import Path
import tempfile
import threading
import time
import subprocess
import unittest
from unittest.mock import patch
import fullstack

SOURCE='a'*40
PROJECT='inside-observability-fullstack-'+'a'*12
ROLES=('mcp','material-assets-worker','profile-avatars-worker','video-deletions-worker','billing-worker','notifications-worker')


class HealthTiming(unittest.TestCase):
    def native_rows(self,states):
        now=datetime.now(timezone.utc)-timedelta(seconds=2)
        stamp=lambda delta:(now+timedelta(seconds=delta)).isoformat().replace('+00:00','Z')
        return [{'id':states[role]['id'],'project':PROJECT,'role':role,'running':True,'oom':False,'restarts':0,
                 'started':stamp(-60),'health':{'status':'healthy','history':[{'start':stamp(0),'end':stamp(0.1),'exit_code':0}]}} for role in ROLES]

    def phase(self,output,*,read=None,diagnostic=None,project=PROJECT,ownership_change=None,owner_change=None):
        (output/'owner.json').write_text(json.dumps({'project':PROJECT,'cwd':str(fullstack.ROOT)}))
        if owner_change:owner_change(output/'owner.json')
        states={role:{'id':format(i+1,'064x'),'running':True,'oom':False,'restarts':0} for i,role in enumerate((*ROLES,'loadgen'))}
        captured=[];owned=[];sampled=threading.Event();native=[]
        def capture(_):
            sampled.set();value={'at_seconds':time.monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
            captured.append(value);return value
        def ownership(*_):
            owned.append(len(captured));value=copy.deepcopy(states)
            if ownership_change and len(owned)==2:ownership_change(value)
            return value
        def load(*_,**__):
            self.assertTrue(sampled.wait(2));return json.dumps({'telegram_acknowledged':0,'completed':True,'scheduled':0,'missed':0,'slot_refusal':{'schema':1,'state':'not_refused'}})
        def inspect(compose,args,**options):
            self.assertGreaterEqual(len(captured),3,'final original counters must precede health observation')
            self.assertEqual(len(owned),2,'final original owner inspection must precede health observation')
            self.assertEqual(compose,['docker']);self.assertEqual(options,{'timeout':2})
            self.assertEqual(args[0:2],['inspect','--format']);self.assertNotIn('Output',args[2]);self.assertNotIn('Env',args[2])
            self.assertEqual(args[3:],[states[r]['id'] for r in ROLES]);native.append(args)
            rows=self.native_rows(states)
            return read(rows) if read else '\n'.join(json.dumps(row) for row in rows)
        with ExitStack() as stack:
            for target,name,value in [(fullstack.technical,'owned',ownership),(fullstack.technical,'capture',capture),(fullstack,'host',lambda:{}),(fullstack,'invoke',load),(fullstack.storage,'observe',lambda *_:{}),(fullstack.telegram,'processed',lambda *_:{'accepted':0}),(fullstack.pilot,'await_fact',lambda fn,pred,**_:fn()),(fullstack.resource_runtime,'invoke',inspect)]:stack.enter_context(patch.object(target,name,side_effect=value))
            result=fullstack.phase([],project,{'name':'idle','seconds':10,'requests_per_second':0},tuple(states),False,0,output,timing=fullstack.stage_timing.Timing(output,SOURCE),group=0,index=0,diagnostic_ordinal=diagnostic)
        return result,native,captured

    def collect(self,output,destination):
        metadata=output/'metadata';metadata.mkdir(exist_ok=True)
        for name in ('source.json','admission.json'):(metadata/name).write_text('{}')
        with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
            fullstack.collect(output,metadata,destination)

    def test_actual_phase_and_collector_retain_owned_numeric_history_after_measurement(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);result,native,counters=self.phase(output)
            self.assertEqual(len(native),1)
            leaf=result['health_probe_timing'];self.assertEqual(leaf['state'],'observed');self.assertEqual(list(leaf['roles']),list(ROLES))
            for row in leaf['roles'].values():
                self.assertEqual(row['status'],'healthy');self.assertEqual(len(row['history']),1)
                start,end,code=row['history'][0];self.assertEqual(end-start,100000);self.assertEqual(code,0)
            self.assertTrue(result['load']['completed']);self.assertEqual(result['errors'],[])
            self.assertEqual([r['counters'] for r in result['samples']],counters)
            self.assertEqual(result['loadgen_cpu_pressure']['state'],'unthrottled')
            (output/'fullstack-phase-0.json').write_text(json.dumps(result))
            self.collect(output,output/'public')
            copied=json.loads((output/'public/fullstack-phase-0.json').read_text())
            self.assertEqual(copied['health_probe_timing'],leaf)
            public=json.dumps(leaf);self.assertNotIn('id',leaf);self.assertNotIn('project',public)
            self.assertNotIn('Output',public)

    def test_optional_observer_failure_never_replaces_the_original_phase_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            def failed(_):raise ValueError('private-native-sentinel')
            result,_,_=self.phase(Path(tmp),read=failed)
            self.assertTrue(result['load']['completed']);self.assertEqual(result['errors'],[])
            self.assertEqual(result['health_probe_timing']['state'],'unavailable')
            self.assertIsNone(result['health_probe_timing']['roles'])
            self.assertNotIn('private-native-sentinel',json.dumps(result['health_probe_timing']))

    def test_actual_collector_refuses_history_before_this_container_started(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);result,_,_=self.phase(output)
            result['health_probe_timing']['roles']['mcp']['history'][0][0]=0
            (output/'fullstack-phase-0.json').write_text(json.dumps(result))
            with self.assertRaises(ValueError):self.collect(output,output/'public')

    def test_actual_collector_refuses_same_source_leaf_from_a_different_private_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);result,_,_=self.phase(output)
            (output/'fullstack-phase-0.json').write_text(json.dumps(result))
            (output/'owner.json').write_text(json.dumps({'project':'inside-observability-fullstack-'+'b'*12,'cwd':str(fullstack.ROOT)}))
            with self.assertRaises(ValueError):self.collect(output,output/'public')

    def test_native_ownership_shape_time_and_privacy_failures_are_unknown(self):
        mutations={
            'foreign project':lambda r:r[0].update(project='private-foreign'),
            'foreign id':lambda r:r[0].update(id='f'*64),
            'foreign role':lambda r:r[0].update(role='api'),
            'duplicate role':lambda r:r.append(r[0]),
            'missing role':lambda r:r.pop(),
            'restarted':lambda r:r[0].update(restarts=1),
            'stopped':lambda r:r[0].update(running=False),
            'oom':lambda r:r[0].update(oom=True),
            'private output':lambda r:r[0]['health']['history'][0].update(Output='private-sentinel'),
            'extra field':lambda r:r[0].update(private='private-sentinel'),
            'too many histories':lambda r:r[0]['health'].update(history=r[0]['health']['history']*6),
            'duplicate history':lambda r:r[0]['health'].update(history=r[0]['health']['history']*2),
            'bad status':lambda r:r[0]['health'].update(status='private-sentinel'),
            'bool exit':lambda r:r[0]['health']['history'][0].update(exit_code=True),
            'huge exit':lambda r:r[0]['health']['history'][0].update(exit_code=256),
            'zero time':lambda r:r[0]['health']['history'][0].update(start='0001-01-01T00:00:00Z'),
            'invalid date':lambda r:r[0]['health']['history'][0].update(start='2025-02-29T12:00:00Z'),
            'local offset':lambda r:r[0]['health']['history'][0].update(start='2020-01-01T00:00:00+00:00'),
            'future time':lambda r:r[0]['health']['history'][0].update(end='2099-01-01T00:00:00Z'),
            'before start':lambda r:r[0]['health']['history'][0].update(start='1970-01-01T00:00:00Z'),
            'reversed time':lambda r:r[0]['health']['history'][0].update(end=r[0]['started']),
        }
        for name,mutate in mutations.items():
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                def read(rows):mutate(rows);return '\n'.join(json.dumps(row) for row in rows)
                result,native,_=self.phase(Path(tmp),read=read)
                self.assertEqual(len(native),1);self.assertTrue(result['load']['completed']);self.assertEqual(result['errors'],[])
                leaf=result['health_probe_timing'];self.assertEqual(leaf['state'],'unavailable');self.assertIsNone(leaf['roles'])
                self.assertNotIn('private-sentinel',json.dumps(leaf))

    def test_fractional_UTC_rounds_outward_and_missing_is_distinct_from_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            def read(rows):
                rows[0].update(started='2020-02-29T12:29:00Z')
                rows[0]['health']['history']=[{'start':'2020-02-29T12:30:00.123456789Z','end':'2020-02-29T12:30:00.123456790Z','exit_code':-1}]
                rows[1]['health']=None;rows[2]['health']['history']=[]
                return '\n'.join(json.dumps(row) for row in rows)
            result,_,_=self.phase(Path(tmp),read=read);roles=result['health_probe_timing']['roles']
            self.assertEqual(roles['mcp']['history'],[[1582979400123456,1582979400123457,-1]])
            self.assertIsNone(roles[ROLES[1]]['status']);self.assertIsNone(roles[ROLES[1]]['history'])
            self.assertEqual(roles[ROLES[2]]['history'],[])

    def test_native_timeout_oversize_and_duplicate_json_do_not_change_primary(self):
        def timeout(_):raise subprocess.TimeoutExpired('private-sentinel',2)
        for read in (timeout,lambda _:'x'*32769,lambda _:'{"id":1,"id":2}',lambda _:'NaN',lambda _:'['*8000+'0'+']'*8000):
            with self.subTest(read=read),tempfile.TemporaryDirectory() as tmp:
                result,_,_=self.phase(Path(tmp),read=read)
                self.assertEqual(result['health_probe_timing']['state'],'unavailable')
                self.assertTrue(result['load']['completed']);self.assertEqual(result['errors'],[])

    def test_foreign_context_or_changed_owner_never_acquires_a_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,native,_=self.phase(Path(tmp),project='other-project')
            self.assertFalse(native);self.assertEqual(result['health_probe_timing']['reason'],'ownership_unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            result,native,_=self.phase(Path(tmp),ownership_change=lambda rows:rows['mcp'].update(id='f'*64))
            self.assertFalse(native);self.assertEqual(result['errors'],['process_replaced_or_oom'])
        for value in ({'project':PROJECT,'cwd':'/private-foreign'},{'project':'other','cwd':str(fullstack.ROOT)},{}):
            with self.subTest(owner=value),tempfile.TemporaryDirectory() as tmp:
                result,native,_=self.phase(Path(tmp),owner_change=lambda path:path.write_text(json.dumps(value)))
                self.assertFalse(native);self.assertEqual(result['health_probe_timing']['reason'],'ownership_unavailable')

    def test_interruption_propagates_and_diagnostic_does_not_acquire_observer(self):
        with tempfile.TemporaryDirectory() as tmp:
            def interrupted(_):raise KeyboardInterrupt()
            with self.assertRaises(KeyboardInterrupt):self.phase(Path(tmp),read=interrupted)
        # The existing diagnostic dispatcher stays outside this optional observer.
        with tempfile.TemporaryDirectory() as tmp,patch.object(fullstack.stability,'invoke_client',return_value={'telegram_acknowledged':0,'completed':True}):
            result,native,_=self.phase(Path(tmp),diagnostic=0)
            self.assertFalse(native);self.assertNotIn('health_probe_timing',result)

    def test_clock_step_or_nonfinite_read_is_unknown(self):
        cases=[[[1000,1000000,1002],[2000,900000,2002]],[[1000,1000000,1002],[900,1000001,902]],
               [[1000,float('nan'),1002],[2000,1001000,2002]],[[1000,True,1002],[2000,1001000,2002]],
               [[1000,2**53-1,1002],[2000,2**53-1,2002]],[[1000,1000000,1002],[3002000,4001000,3002002]]]
        for anchors in cases:
            with self.subTest(anchors=anchors),tempfile.TemporaryDirectory() as tmp:
                # Patch the observer's clock seam only; original phase clocks remain real.
                with patch.object(fullstack.health_timing,'anchor',side_effect=anchors):
                    result,_,_=self.phase(Path(tmp))
                self.assertEqual(result['health_probe_timing']['reason'],'clock_unavailable')
                self.assertTrue(result['load']['completed'])

    def test_actual_collector_refuses_forged_leaf_and_accepts_absent_optional_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);result,_,_=self.phase(output)
            mutations=[lambda v:v.update(source='b'*40),lambda v:v.update(phase=1),lambda v:v.update(output_sha256='b'*64),
                       lambda v:v.update(private='private-sentinel'),lambda v:v['roles'].update(api=v['roles']['mcp']),
                       lambda v:v['roles']['mcp']['history'][0].__setitem__(1,2**53),
                       lambda v:v['roles']['mcp'].update(status='unknown'),lambda v:v['anchors'][1].__setitem__(1,0),
                       lambda v:v['roles']['mcp']['history'][0].__setitem__(2,True)]
            for i,mutate in enumerate(mutations):
                bad=copy.deepcopy(result);mutate(bad['health_probe_timing'])
                (output/'fullstack-phase-0.json').write_text(json.dumps(bad))
                with self.subTest(mutation=i),self.assertRaises(ValueError):self.collect(output,output/('bad-'+str(i)))
            result.pop('health_probe_timing');(output/'fullstack-phase-0.json').write_text(json.dumps(result))
            self.collect(output,output/'without-optional-leaf')


if __name__=='__main__':unittest.main()
