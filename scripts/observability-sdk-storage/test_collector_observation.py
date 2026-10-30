"""SDK-local passive collector contracts. No Docker or application workload."""
import json
import unittest
import collector_observation as observation


class CounterProjection(unittest.TestCase):
    def test_cfs_progress_is_observation_only_and_missing_is_unknown(self):
        raw = {'cpu_stats': {'cpu_usage': {'total_usage': 71},
                            'throttling_data': {'periods': 12, 'throttled_periods': 3, 'throttled_time': 9}},
               'memory_stats': {'usage': 25, 'limit': 100}, 'private': 'never retained'}
        self.assertEqual(observation.counters(raw), dict(cpu_total_ns=71, cpu_periods=12,
            cpu_throttled_periods=3, cpu_throttled_ns=9, memory_charged_bytes=25, memory_limit_bytes=100))
        self.assertTrue(all(value is None for value in observation.counters({}).values()))

    def test_strict_json_and_finite_unsigned_values(self):
        for value in (True, -1, 2**63, 1.5, float('inf'), '4'):
            self.assertIsNone(observation.counters({'memory_stats': {'usage': value}})['memory_charged_bytes'])
        for raw in (b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":Infinity}', b'{"nested":{"x":1e999}}', b' '*1048577):
            with self.assertRaises(ValueError):
                observation.decode_engine(raw)

    def test_deltas_refuse_reset_missing_clock_and_identity_closure(self):
        a = observation.sample(0, 0, 10, dict(zip(observation.COUNTERS, [100, 10, 2, 4, 20, 30])))
        b = observation.sample(4, 1000, 1010, dict(zip(observation.COUNTERS, [150, 15, 3, 9, 20, 30])))
        self.assertEqual(observation.deltas([a,b], 'valid'),
            {'status': 'known', 'cpu_total_ns': 50, 'cpu_periods': 5, 'cpu_throttled_periods': 1, 'cpu_throttled_ns': 5})
        b['counters']['cpu_periods'] = 1
        self.assertEqual(observation.deltas([a,b], 'valid')['status'], 'reset')
        self.assertIsNone(observation.deltas([a,b], 'valid')['cpu_total_ns'])
        self.assertEqual(observation.deltas([a], 'valid')['status'], 'unknown')
        self.assertEqual(observation.deltas([a,b], 'unknown')['status'], 'unknown')
        b['start_ms'] = 0
        self.assertEqual(observation.deltas([a,b], 'valid')['status'], 'unknown')


class EngineIdentity(unittest.TestCase):
    def test_only_bound_cid_is_read_and_birth_daemon_replacement_refuses(self):
        cid='a'*64
        inspect={'Id':cid, 'Image':'sha256:'+'b'*64, 'Config':{'Image':'pinned', 'Labels':{
            'com.docker.compose.project':'owned', 'com.docker.compose.service':'alloy'}},
            'State':{'StartedAt':'2026-10-30T00:00:00.000Z','Running':True,'OOMKilled':False}, 'RestartCount':0}
        calls=[]
        def request(path, deadline):
            calls.append(path)
            if path.endswith('/info'): value={'ID':'daemon','DockerRootDir':'/storage'}
            elif path.endswith('/json'): value=inspect
            else: value={'cpu_stats': {'cpu_usage': {'total_usage': 12}}}
            return json.dumps(value).encode()
        engine=observation.FrozenEngine(dict(endpoint='unix:///owned.sock', daemon_id='daemon',storage='/storage',
            socket_device=1,socket_inode=2),dict(id=cid,image='pinned',project='owned',service='alloy'),
            request=request, socket_check=lambda: None)
        self.assertEqual(engine.acquire(10)['counters']['cpu_total_ns'],12)
        self.assertTrue(all(path in ('/v1.48/info','/v1.48/containers/'+cid+'/json',
            '/v1.48/containers/'+cid+'/stats?stream=false&one-shot=true') for path in calls))
        inspect['State']['StartedAt']='2026-10-30T00:00:01.000Z'
        with self.assertRaises(ValueError):engine.acquire(10)
        inspect['State']['StartedAt']='2026-10-30T00:00:00.000Z'
        engine.admitted['daemon_id']='replacement'
        with self.assertRaises(ValueError):engine.close(10)


class PublicArtifact(unittest.TestCase):
    def test_source_bound_owned_atomic_projection_never_projects_raw_text(self):
        import os
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory).resolve()/observation.NAME
            value=observation.empty('a'*40)
            observation.write(path,value,source='a'*40)
            self.assertEqual(observation.read(path,source='a'*40),value)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertLess(path.stat().st_size,8192)
            for bad in ({**value,'body':'secret'}, {**value,'source':'b'*40},
                        {**value,'readiness':{'raw':'secret'}}):
                with self.assertRaises(ValueError):observation.write(path,bad,source='a'*40)
            path.write_bytes(b'{"source":"secret","source":"raw"}')
            self.assertEqual(observation.load_for_collection(Path(directory),source='a'*40)['close'],'refused')
            self.assertNotIn('secret',json.dumps(observation.load_for_collection(Path(directory),source='a'*40)))
            path.unlink(); target=Path(directory)/'other'; target.write_bytes(b'{}'); path.symlink_to(target)
            with self.assertRaises(ValueError):observation.read(path,source='a'*40)

    def test_readiness_is_exact_original_alloy_row_and_offsets_only(self):
        raw=json.dumps([dict(probe='alloy_otlp', attempts=2,outcome='passed',last_http_status=200,
                             last_transport_error_type=None), {'probe':'other','private':'secret'}]).encode()
        self.assertEqual(observation.readiness(raw,-1200,-1000),
            dict(status='known',start_ms=-1200,end_ms=-1000,attempts=2,outcome='passed',http_status=200,error=None))
        for bad in (b'[]',b'[{"probe":"alloy_otlp","body":"private"}]',b' '*1048577):
            self.assertEqual(observation.readiness(bad,-2,-1)['status'],'unknown')


class Schedule(unittest.TestCase):
    def test_skips_missed_ticks_nonoverlap_and_late_terminal_unknown(self):
        class Clock:
            value=0
            def now(self):return self.value
            def wait(self,seconds):self.value+=seconds
        clock=Clock();calls=[]
        class Engine:
            def acquire(self,deadline):
                calls.append(clock.now());clock.value+=.8
                return {'counters':dict.fromkeys(observation.COUNTERS,12),'state':dict(running=True,oom=False,restarts=0,status=None)}
            def close(self,deadline):pass
        result=observation.observe(Engine(),source='a'*40,origin=0,now=clock.now,wait=clock.wait,terminal=lambda:False)
        self.assertEqual(calls,[0,1])
        self.assertEqual(result['missed'],[1,3])
        self.assertEqual(result['terminal'],'unknown')
        self.assertLessEqual(clock.value,3)
        self.assertEqual(result['mode'],'observations_only')

    def test_terminal_is_one_extra_read_and_original_limits_are_fixed(self):
        class Clock:
            value=0
            def now(self):return self.value
            def wait(self,seconds):self.value+=seconds
        clock=Clock();calls=[]
        class Engine:
            def acquire(self,deadline):
                calls.append((clock.now(),deadline));clock.value+=.01
                return {'counters':dict.fromkeys(observation.COUNTERS,0),'state':dict(running=True,oom=False,restarts=0,status=None)}
            def close(self,deadline):pass
        value=observation.observe(Engine(),source='a'*40,origin=0,now=clock.now,wait=clock.wait,terminal=lambda:clock.value>=.7)
        self.assertEqual([row['slot'] for row in value['samples']],[0,1,4])
        self.assertTrue(all(deadline-start<=1 for start,deadline in calls))
        self.assertLessEqual(clock.value,3)


class OwnedObserver(unittest.TestCase):
    def test_blocked_reader_is_stopped_reaped_and_cannot_replace_producer_error(self):
        import os
        from pathlib import Path
        import tempfile
        import time
        import signal
        class BlockedEngine:
            def acquire(self,deadline):signal.pause()
            def close(self,deadline):signal.pause()
        with tempfile.TemporaryDirectory() as directory:
            owned=observation.OwnedCollector(Path(directory).resolve(),source='a'*40,admitted={},target={},
                engine_factory=lambda:BlockedEngine())
            started=time.monotonic();owned.start();pid=owned.pid
            owned.finish()
            self.assertLess(time.monotonic()-started,3)
            with self.assertRaises(ChildProcessError):os.waitpid(pid,os.WNOHANG)
            self.assertIsNone(owned.pid)
            self.assertEqual(observation.load_for_collection(Path(directory),source='a'*40)['mode'],'observations_only')

    def test_emitter_launch_precedes_observer_and_original_error_survives(self):
        from unittest.mock import patch
        import sdk_storage
        order=[];original=RuntimeError('original fixture')
        class Collector:
            def start(self,**kwargs):order.append('observer');raise ValueError('diagnostic only')
            def finish(self):order.append('close');raise ValueError('diagnostic only')
        class Child:
            stdout=None
            def poll(self):return 0
            def wait(self,**kwargs):return 0
        def launch(*args,**kwargs):order.append('producer');return Child()
        with patch.object(sdk_storage.subprocess,'Popen',launch):
            with self.assertRaises(AssertionError):sdk_storage.emitter(collector=Collector())
        self.assertEqual(order,['producer','observer','close'])
        class Selector:
            def __enter__(self):raise original
            def __exit__(self,*args):pass
        import io
        child=Child();child.stdout=io.BytesIO()
        with patch.object(sdk_storage.subprocess,'Popen',lambda *a,**k:child),patch.object(sdk_storage.selectors,'DefaultSelector',Selector):
            try:sdk_storage.emitter(collector=Collector())
            except RuntimeError as caught:self.assertIs(caught,original)
            else:self.fail('producer failure disappeared')

    def test_long_producer_does_not_keep_observer_alive_past_budget(self):
        import os
        from pathlib import Path
        import tempfile
        import time
        import signal
        class BlockedEngine:
            def acquire(self,deadline):signal.pause()
            def close(self,deadline):signal.pause()
        with tempfile.TemporaryDirectory() as directory:
            owned=observation.OwnedCollector(Path(directory).resolve(),source='a'*40,admitted={},target={},
                engine_factory=lambda:BlockedEngine())
            owned.start();self.addCleanup(owned.finish);pid=owned.pid
            # Drive the same nonblocking supervision seam the emitter uses while running.
            while owned.pid is not None:
                delay=owned.poll()
                if owned.pid is not None:
                    import select
                    select.select([],[],[],delay)
            self.assertLess(time.monotonic()-owned.origin,3)
            with self.assertRaises(ChildProcessError):os.waitpid(pid,os.WNOHANG)
            owned.finish()


class RefusalMatrix(unittest.TestCase):
    def test_each_owned_identity_field_is_revalidated(self):
        import copy
        cid='a'*64
        original={'Id':cid,'Image':'sha256:'+'b'*64,'Config':{'Image':'pinned','Labels':{
            'com.docker.compose.project':'owned','com.docker.compose.service':'alloy'}},
            'State':{'StartedAt':'2026-10-30T00:00:00.000Z','Running':True,'OOMKilled':False,'Status':'running'},'RestartCount':0}
        for field in ('cid','config_image','image_id','project','service','birth','restart','daemon','stats_id','socket'):
            with self.subTest(field=field):
                row=copy.deepcopy(original); daemon={'ID':'daemon','DockerRootDir':'/storage'};stats={};swapped=False
                def socket_check():
                    if swapped and field=='socket':raise ValueError('changed')
                def request(path,deadline):
                    return json.dumps(daemon if path.endswith('/info') else row if path.endswith('/json') else stats).encode()
                engine=observation.FrozenEngine(dict(endpoint='unix:///owned.sock',daemon_id='daemon',storage='/storage',
                    socket_device=1,socket_inode=2),dict(id=cid,image='pinned',project='owned',service='alloy'),
                    request=request,socket_check=socket_check)
                engine.acquire(10);swapped=True
                if field=='cid':row['Id']='c'*64
                elif field=='config_image':row['Config']['Image']='other'
                elif field=='image_id':row['Image']='sha256:'+'c'*64
                elif field=='project':row['Config']['Labels']['com.docker.compose.project']='other'
                elif field=='service':row['Config']['Labels']['com.docker.compose.service']='other'
                elif field=='birth':row['State']['StartedAt']='2026-10-30T00:00:01.000Z'
                elif field=='restart':row['RestartCount']=1
                elif field=='daemon':daemon['ID']='other'
                elif field=='stats_id':stats['id']='c'*64
                with self.assertRaises(ValueError):engine.acquire(10)

    def test_public_schema_rejects_boolean_delta_unknown_fields_and_oversize(self):
        import copy
        base=observation.empty('a'*40)
        for mutate in (lambda value:value.update(raw='secret'),
                       lambda value:value['delta'].update(cpu_periods=True),
                       lambda value:value['samples'].append({'private':'secret'}),
                       lambda value:value['readiness'].update(attempts=True)):
            value=copy.deepcopy(base);mutate(value)
            with self.assertRaises((ValueError,TypeError)):observation.validate(value,source='a'*40)

    def test_nonmonotonic_clock_and_failed_read_are_unknown(self):
        class Engine:
            def acquire(self,deadline):raise TimeoutError()
            def close(self,deadline):raise TimeoutError()
        values=iter([0,-1])
        result=observation.observe(Engine(),source='a'*40,origin=0,now=lambda:next(values))
        self.assertEqual(result['close'],'refused')
        self.assertEqual(result['delta']['status'],'unknown')


class IntegrationBoundary(unittest.TestCase):
    def test_worker_adapts_real_normalized_owned_target_before_producer(self):
        from contextlib import ExitStack, nullcontext
        import os
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        import sdk_storage
        pilot=sdk_storage.pilot
        scenario=sdk_storage.source_status_scenario
        project='inside-observability-pilot-012345abcdef';source='a'*40
        admitted={'endpoint':'unix:///owned.sock','daemon_id':'fixture','storage':'/owned'}
        stopped=RuntimeError('producer boundary reached')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();output.chmod(0o700)
            auth=output/'auth.json';auth.write_text(json.dumps({'users':[{'bearer_token':'fixture'}]}));auth.chmod(0o600)
            owner={'supervisor_pid':os.getppid(),'project':project}
            (output/'owner.json').write_text(json.dumps(owner))
            auth_owner=auth.stat()
            images=json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images']
            plan=pilot.compose_plan(pilot.CONFIG,output,images,credential_owner=(auth_owner.st_uid,auth_owner.st_gid))
            (output/'compose.json').write_text(json.dumps(plan))
            compose=['docker','compose','-p',project,'-f',str(output/'compose.json')]
            ids={role:f'{index+1:064x}' for index,role in enumerate(scenario.CORE_ROLES)}
            inspected=[]
            def command(argv,**_):
                if argv in (compose+['config','--quiet'],compose+['up','-d']):return ''
                for role,cid in ids.items():
                    if argv==compose+['ps','-q',role]:return cid
                    if argv==['docker','inspect','--format',scenario.INSPECT,cid]:
                        inspected.append(role);mounts=[]
                        for value in plan['services'][role].get('volumes',[]):
                            origin,destination,*options=value.split(':');volume=origin in plan['volumes']
                            mounts.append({'Type':'volume' if volume else 'bind','Name':project+'_'+origin if volume else '',
                                'Source':'/data' if volume else origin,'Destination':destination,'RW':'ro' not in options})
                        return json.dumps({'id':cid,'image':plan['services'][role]['image'],'project':project,
                            'service':role,'config_files':compose[5],'mounts':mounts,
                            'networks':{project+'_'+name:{'NetworkID':('b' if name=='pilot' else 'c')*64}
                                for name in plan['services'][role]['networks']}})
                if argv==['docker','inspect','--format','{{.HostConfig.LogConfig.Type}}',ids['alloy']]:return 'none'
                if (argv[:3]==['docker','inspect','--format'] and argv[-1]==ids['traces']
                        and argv[3].startswith('{{if and (eq (index .Config.Labels ')):return 'owned|none'
                self.fail('unexpected external command: '+repr(argv))
            # The real registry validates all eight roles and returns only normalized fields.
            normalized=scenario.OwnedTargets(output,compose,plan,command).targets['alloy']
            self.assertEqual(set(normalized),{'id','image','mounts','networks'})
            self.assertEqual(inspected,list(scenario.CORE_ROLES));inspected.clear()
            def read_source(argv):
                self.assertEqual(argv,['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
                return source
            # Acquisition touches native resources; ownership, logging and readiness stay real.
            with ExitStack() as patches:
                for name,value in (('worker_storage_guard',lambda *a,**k:nullcontext()),
                                   ('install_horizon',lambda *a:None),('install_plugin',lambda *a:None),
                                   ('assert_docker_identity',lambda **k:None),('command',command),
                                   ('request',lambda *a,**k:(200,''))):
                    patches.enter_context(patch.object(pilot,name,value))
                patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',admitted['endpoint']))
                patches.enter_context(patch.object(pilot,'FROZEN_DOCKER_IDENTITY',admitted))
                patches.enter_context(patch.object(sdk_storage.ci,'read_command',side_effect=read_source))
                constructor=patches.enter_context(patch.object(observation,'OwnedCollector',wraps=observation.OwnedCollector))
                producer=patches.enter_context(patch.object(sdk_storage,'producer_observation',side_effect=stopped))
                with self.assertRaises(RuntimeError) as caught:sdk_storage.worker(output)
            self.assertIs(caught.exception,stopped)
            self.assertEqual(inspected,list(scenario.CORE_ROLES))
            constructor.assert_called_once()
            self.assertEqual(constructor.call_args.args,(output,))
            self.assertEqual(constructor.call_args.kwargs['target'],{
                'id':ids['alloy'],'image':images['alloy'],'project':project,'service':'alloy'})
            self.assertIs(constructor.call_args.kwargs['admitted'],admitted)
            self.assertEqual(constructor.call_args.kwargs['source'],source)
            self.assertIsInstance(producer.call_args.kwargs['collector'],observation.OwnedCollector)
            self.assertEqual(json.loads((output/'trace-store-logging.json').read_text())['outcome'],'passed')
            self.assertEqual(json.loads((output/'sdk-storage.json').read_text())['stage'],'producer')

    def inactive_import_probe(self, mode):
        """Exercise actual dynamic imports in an isolated process, before native launch."""
        from pathlib import Path
        import subprocess
        import sys
        import textwrap
        root=Path(__file__).resolve().parents[2]
        code=textwrap.dedent('''
            import hashlib
            import importlib.util
            from pathlib import Path
            import shutil
            import subprocess
            import sys
            import tempfile
            import time
            import types
            from unittest.mock import patch
            source=Path(sys.argv[1]);mode=sys.argv[2]
            def load(name,path):
                spec=importlib.util.spec_from_file_location(name,path)
                module=importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                return module
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();sdk=root/'scripts/observability-sdk-storage'
                sdk.mkdir(parents=True)
                for path in (source/'scripts/observability-sdk-storage').glob('*.py'):
                    shutil.copyfile(path,sdk/path.name)
                observer=sdk/'collector_observation.py';before=hashlib.sha256(observer.read_bytes()).hexdigest()
                marker=root/'observer-executed';accesses=[]
                if mode=='foreign':
                    class Foreign(types.ModuleType):
                        def __getattribute__(self,name):
                            accesses.append(name)
                            raise AssertionError('foreign observer accessed: '+name)
                    foreign=Foreign('collector_observation')
                    foreign.__file__='/foreign/unadmitted/collector_observation.py'
                    sys.modules['collector_observation']=foreign
                elif mode=='changed':
                    observer.write_text('from pathlib import Path\\nPath('+repr(str(marker))+').touch()\\nraise AssertionError("changed observer executed")\\n')
                    assert hashlib.sha256(observer.read_bytes()).hexdigest()!=before
                else:raise AssertionError('unknown probe')
                sys.path[:0]=[str(sdk),str(source/'scripts/observability-pilot')]
                module=load('_inactive_sdk',sdk/'sdk_storage.py')
                # The real SDK emitter uses its default collector=None and owns this tiny child.
                assert module.emitter(argv=[sys.executable,'-I','-B','-c','print("{}")'],budget=2)=={}
                witness=load('_actual_representative_witness',source/'scripts/observability-fullstack/representative_witness.py')
                witness.ROOT=root
                stopped=RuntimeError('native launch boundary reached')
                def before_native(*args,**kwargs):raise stopped
                with patch.object(module.emitter_phase,'OwnedSdkPhase',side_effect=before_native), \\
                     patch.object(subprocess,'Popen',side_effect=AssertionError('native launch forbidden')):
                    try:witness._emit_sdk(root,'a'*40,time.monotonic()+30)
                    except RuntimeError as error:assert error is stopped
                    else:raise AssertionError('representative path did not reach native boundary')
                assert not accesses,accesses
                assert not marker.exists(),'changed observer executed'
                if mode=='foreign':assert sys.modules['collector_observation'] is foreign
                else:assert 'collector_observation' not in sys.modules
        ''')
        result=subprocess.run([sys.executable,'-I','-B','-c',code,str(root),mode],
                              capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_inactive_dynamic_sdk_and_representative_never_access_foreign_observer(self):
        self.inactive_import_probe('foreign')

    def test_inactive_dynamic_sdk_and_representative_never_execute_changed_observer(self):
        self.inactive_import_probe('changed')

    def test_active_sdk_admission_binds_observer_source_bytes(self):
        import hashlib
        import io
        import os
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        import sdk_storage
        observer=Path(observation.__file__).resolve()
        inputs=sdk_storage.source_inputs()
        self.assertIn(observer,inputs)
        source='a'*40
        def external_command(argv):
            if argv==['git','-C',str(sdk_storage.ci.ROOT),'rev-parse','HEAD']:return source
            if argv==['git','-C',str(sdk_storage.ci.ROOT),'rev-parse','HEAD^{tree}']:return 'b'*40
            if argv==['git','-C',str(sdk_storage.ci.ROOT),'status','--porcelain']:return ''
            if argv==['docker','info','--format','{{.DockerRootDir}}']:raise OSError('Engine unavailable in source model')
            self.fail('unexpected external command')
        with tempfile.TemporaryDirectory() as directory:
            metadata=Path(directory)/'metadata'
            with patch.object(sdk_storage.ci,'read_command',side_effect=external_command), \
                 patch.dict(os.environ,{'GITHUB_SHA':source}),patch('sys.stdout',new_callable=io.StringIO):
                # Actual admission writes source evidence before the refused Engine check.
                self.assertEqual(sdk_storage.ci.admission(metadata,inputs=inputs,scope=sdk_storage.SCOPE),1)
            bound=json.loads((metadata/'source.json').read_text())
            name='scripts/observability-sdk-storage/collector_observation.py'
            self.assertEqual(bound['inputs'][name],hashlib.sha256(observer.read_bytes()).hexdigest())
            self.assertEqual(bound['scope'],sdk_storage.SCOPE)

    def test_observer_setup_never_renews_emitter_deadline_or_hides_interrupt(self):
        import io
        from unittest.mock import patch
        import sdk_storage
        class Clock:
            value=0
            def now(self):return self.value
        clock=Clock()
        class Child:
            stdout=io.BytesIO()
            def poll(self):return 0
            def wait(self,**kwargs):return 0
        class Collector:
            def start(self,*,origin):clock.value=31
            def poll(self):return .05
            def finish(self):raise ValueError('observer')
        class Selector:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def register(self,*args):pass
        with patch.object(sdk_storage.subprocess,'Popen',lambda *a,**k:Child()),patch.object(sdk_storage.time,'monotonic',clock.now),patch.object(sdk_storage.selectors,'DefaultSelector',Selector):
            with self.assertRaises(TimeoutError):sdk_storage.emitter(collector=Collector())
        original=KeyboardInterrupt()
        class InterruptedSelector(Selector):
            def __enter__(self):raise original
        clock.value=0
        with patch.object(sdk_storage.subprocess,'Popen',lambda *a,**k:Child()),patch.object(sdk_storage.selectors,'DefaultSelector',InterruptedSelector):
            try:sdk_storage.emitter(collector=Collector())
            except KeyboardInterrupt as caught:self.assertIs(caught,original)
            else:self.fail('interrupt disappeared')
        self.assertEqual(sdk_storage.EMITTER_SECONDS,30)
        self.assertEqual(sdk_storage.STORAGE_SECONDS,60)

    def test_sdk_curation_excludes_raw_observer_and_writes_validated_projection(self):
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        import sdk_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700)
            public=root/'public';calls=[]
            def collect(_output,_metadata,destination,*,artifacts):
                calls.append(artifacts);destination.mkdir(mode=0o700)
            with patch.object(sdk_storage,'collect_unacquired',return_value=False),patch.object(sdk_storage.emitter_phase,'source_from_metadata',return_value='a'*40),patch.object(sdk_storage.diagnostics,'read',return_value={}),patch.object(sdk_storage.diagnostics,'write'),patch.object(sdk_storage.emitter_phase,'load_for_collection',return_value={}),patch.object(sdk_storage.emitter_phase,'write'),patch.object(sdk_storage.ci,'collect',collect):
                sdk_storage.collect(output,root/'metadata',public)
            self.assertNotIn(observation.NAME,calls[0])
            self.assertIn(observation.NAME,sdk_storage.ARTIFACTS)
            self.assertEqual(sdk_storage.COLLECTOR_ARTIFACT,observation.NAME)
            self.assertEqual(observation.read(public/observation.NAME,source='a'*40)['close'],'unknown')
