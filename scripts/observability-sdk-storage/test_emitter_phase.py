"""Closed SDK phase file ownership controls; no Docker or application runtime."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import emitter_phase as phase

SOURCE = 'a' * 40


def record(state='running', name='input_validation', reason='none'):
    return dict(schema=1, scope='sdk', source=SOURCE, state=state, phase=name, reason=reason)


class SdkPhaseTest(unittest.TestCase):
    def test_exact_schema_matrix_and_no_foreign_payload(self):
        for state, name, reason in [('running','input_validation','none'),('failed','cleanup_sdk','operation_failed'),
                                    ('completed','result_ready','none'),('unknown','unknown','unavailable'),('refused','unknown','contract')]:
            value=record(state,name,reason)
            self.assertEqual(phase.validate(value,source=SOURCE),value)
        invalid=[]
        for key in record():
            value=record(); del value[key]; invalid.append(value)
        for key,value in [('schema',True),('scope','tracking'),('source','b'*40),('state','private'),
                          ('phase','migration'),('phase','result_ready'),('reason','operation_failed')]:
            invalid.append({**record(),key:value})
        invalid += [{**record(),'private':'secret'},record('completed','input_validation'),record('failed','input_validation','none')]
        for value in invalid:
            with self.assertRaisesRegex(ValueError,'closed SDK phase refused'):
                phase.validate(value,source=SOURCE)

    def test_canonical_owned_roundtrip_and_child_parent_separation(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve(); path=output/phase.NAME
            phase.write(path,record(),source=SOURCE)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.read_bytes(),(json.dumps(record(),sort_keys=True,separators=(',',':'))+'\n').encode())
            self.assertEqual(phase.read(path,source=SOURCE),record())
            for state,reason in [('unknown','unavailable'),('refused','contract')]:
                phase.write(path,record(state,'unknown',reason),source=SOURCE)
                with self.assertRaises(ValueError):phase.read_child(path,source=SOURCE)
            self.assertFalse((output/'phase.json.new').exists())

    def test_strict_bounded_reader_refuses_private_duplicates_links_and_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve(); path=output/phase.NAME
            for raw in [b'{}',b'{"schema":1,"schema":1}',b'{"x":NaN}',b' '*513,b'['*600]:
                path.write_bytes(raw);path.chmod(0o600)
                with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();target=output/'private';target.write_bytes(b'private');path.symlink_to(target)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();os.link(target,path)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)
            path.unlink();phase.write(path,record(),source=SOURCE);path.chmod(0o644)
            with self.assertRaises(ValueError):phase.read(path,source=SOURCE)

    def test_missing_is_unknown_and_invalid_child_cannot_replace_primary(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE),record('unknown','unknown','unavailable'))
            original=RuntimeError('synthetic private primary')
            try:
                with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                    marker=owned.path
                    environment=owned.environment({'fixture':'unchanged'})
                    self.assertEqual(set(environment),{'fixture','INSIDE_SDK_EMITTER_PHASE_PATH','INSIDE_SDK_EMITTER_PHASE_SOURCE'})
                    self.assertEqual(environment['INSIDE_SDK_EMITTER_PHASE_SOURCE'],SOURCE)
                    self.assertEqual(marker.parent.stat().st_mode & 0o777,0o700)
                    marker.write_bytes(b'private');marker.chmod(0o600)
                    raise original
            except RuntimeError as observed:
                self.assertTrue(observed is original,'primary identity changed')
            self.assertFalse(marker.parent.exists())
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE),record('refused','unknown','contract'))

    def test_failed_child_exit_zero_refuses_success_after_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with self.assertRaises(ValueError):
                with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                    phase.write(owned.path,record('failed','modules_import','operation_failed'),source=SOURCE)
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE)['state'],'failed')

    def test_source_authority_rejects_unknown_fields_or_mismatched_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            metadata=Path(directory).resolve();path=metadata/'source.json'
            value=dict(checkout_sha=SOURCE,checkout_tree='b'*40,repository=None,run_id=None,run_attempt=None,event=None,
                       provider_execution_sha=SOURCE,provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={},scope='fixture')
            path.write_text(json.dumps(value));path.chmod(0o600)
            self.assertEqual(phase.source_from_metadata(metadata),SOURCE)
            for field,item in [('provider_execution_sha','c'*40),('private','secret'),('inputs',{'x':'invalid'})]:
                path.write_text(json.dumps({**value,field:item}))
                with self.assertRaises(ValueError):phase.source_from_metadata(metadata)



class SdkOwnershipFailureTest(unittest.TestCase):
    def test_temp_collision_and_recreated_foreign_inode_are_never_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME;temporary=output/'phase.json.new'
            temporary.write_bytes(b'foreign');temporary.chmod(0o600)
            with self.assertRaises(ValueError):phase.write(path,record(),source=SOURCE)
            self.assertEqual(temporary.read_bytes(),b'foreign')
            temporary.unlink()
            def replaced(*_args,**_kwargs):
                temporary.unlink();temporary.write_bytes(b'recreated');temporary.chmod(0o600)
                raise OSError('synthetic replace refusal')
            with patch.object(phase.os,'replace',side_effect=replaced),self.assertRaises(ValueError):
                phase.write(path,record(),source=SOURCE)
            self.assertEqual(temporary.read_bytes(),b'recreated')

    def test_reader_rejects_inode_replacement_and_fixed_child_name(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME
            phase.write(path,record(),source=SOURCE)
            original_read=os.read
            def replaced(fd,count):
                raw=original_read(fd,count)
                new=output/'replacement';new.write_bytes(path.read_bytes());new.chmod(0o600);os.replace(new,path)
                return raw
            with patch.object(phase.os,'read',side_effect=replaced),self.assertRaises(ValueError):
                phase.read(path,source=SOURCE)
            arbitrary=output/'arbitrary';arbitrary.write_bytes(path.read_bytes());arbitrary.chmod(0o600)
            with self.assertRaises(ValueError):phase.read_child(arbitrary,source=SOURCE)

    def test_secondary_same_or_different_error_cannot_override_primary_traceback(self):
        import sys
        class Primary(RuntimeError):
            def with_traceback(self,_traceback):
                raise AssertionError('foreign override called')
        for same in (False,True):
            with self.subTest(same=same),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();original=Primary('synthetic primary')
                secondary=original if same else OSError('synthetic marker failure')
                with patch.object(phase,'read_child',side_effect=secondary):
                    try:
                        with phase.OwnedSdkPhase(output,source=SOURCE) as owned:
                            try:raise original
                            except Primary:
                                captured=sys.exc_info()[2]
                                raise
                    except BaseException as observed:
                        self.assertTrue(observed is original,'primary identity changed')
                        traceback=BaseException.__getattribute__(observed,'__traceback__')
                        while traceback is not None and traceback is not captured:
                            self.assertNotEqual(traceback.tb_frame.f_code.co_name,'_execute_mock_call','secondary traceback leaked')
                            traceback=traceback.tb_next
                        self.assertTrue(traceback is captured,'primary traceback changed')
                    else:self.fail('primary not restored')
                self.assertFalse(owned.path.parent.exists())


class SdkCapturePhaseTest(unittest.TestCase):
    def test_opt_in_scope_projects_only_after_capture_and_defaults_allocate_nothing(self):
        import sdk_storage
        diagnostic=type('Diagnostic',(),{'start':lambda *_:None,'observed':lambda *_:None,'fail':lambda *_:None})()
        observed={'runtime_modules':{}}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();environment={'fixture':'unchanged'}
            def capture(*,environment,diagnostic):
                self.assertFalse((output/phase.NAME).exists())
                marker=Path(environment['INSIDE_SDK_EMITTER_PHASE_PATH'])
                phase.write(marker,record('completed','result_ready'),source=SOURCE)
                return {}
            with patch.object(sdk_storage,'emitter',side_effect=capture),patch.object(sdk_storage,'witness',return_value=observed),patch.object(sdk_storage.pilot,'write_json'):
                self.assertEqual(sdk_storage.producer_observation(output,environment=environment,diagnostic=diagnostic,phase_source=SOURCE),observed)
            self.assertEqual(phase.read(output/phase.NAME,source=SOURCE)['state'],'completed')
            with patch.object(sdk_storage,'emitter',return_value={}) as emitter,patch.object(sdk_storage,'witness',return_value=observed),patch.object(sdk_storage.pilot,'write_json'),patch.object(phase,'OwnedSdkPhase',side_effect=AssertionError('default observer allocation')):
                sdk_storage.producer_observation(output,environment=environment,diagnostic=diagnostic)
                self.assertTrue(emitter.call_args.kwargs['environment'] is environment)

    def test_collection_refuses_phase_or_source_before_public_destination(self):
        import sdk_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=root/'metadata';metadata.mkdir(mode=0o700);destination=root/'public'
            with patch.object(sdk_storage.diagnostics,'read',return_value={}),patch.object(sdk_storage.ci,'collect') as collect:
                with self.assertRaises(ValueError):sdk_storage.collect(output,metadata,destination)
                collect.assert_not_called()
            self.assertFalse(destination.exists())


# This fixture substitutes fixed compiled module/library boundaries. It does not
# certify compiled production modules, native SDK export, OS anchoring on Mac or PG.
SDK_ENTRY_FIXTURE = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {createServer,Server} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const setup=JSON.parse(process.argv[1]);
const source='a'.repeat(40), marker=process.env.INSIDE_SDK_EMITTER_PHASE_PATH;
const directory=marker.slice(0,marker.lastIndexOf('/'));
const original={...fs};const modules=new Map();const urls=new Map();
const bodyError=new Error('synthetic body'),cleanupError=new Error('synthetic cleanup');
const failures=setup.failure.split('+');const events=[],servers=[],ports=[],hooks=[];
let busy=false,shutdowns=0,completedAfterCleanup=false;
const translate=p=>setup.shim&&typeof p==='string'&&/^\/proc\/self\/fd\/[0-9]+(?:\/|$)/.test(p)?directory+p.replace(/^\/proc\/self\/fd\/[0-9]+/,''):p;
function boundary(name){
  events.push(name);
  if(failures.includes(name))throw name.startsWith('cleanup_')?cleanupError:bodyError;
}
globalThis.__insideSdkPhaseFixture={boundary,source,shutdown(){const row=JSON.parse(original.readFileSync(marker,'utf8'));boundary(row.state==='failed'||row.phase==='cleanup_sdk'?'cleanup_sdk':'sdk_shutdown');}};
const root=fileURLToPath(new URL('../../',setup.emitter));
const runtime=root+'apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js';
const telemetry=root+'apps/backend/dist/infrastructure/observability/technical-telemetry.js';
const storage=root+'apps/backend/dist/infrastructure/object-storage/s3-object-storage.js';
const observation=root+'apps/backend/dist/infrastructure/object-storage/s3-request-observation.js';
modules.set(telemetry,'export const controlled=true;');modules.set(observation,'export const controlled=true;');
modules.set(runtime,`import './technical-telemetry.js';
 const b=globalThis.__insideSdkPhaseFixture.boundary;
 export function technicalTelemetryFromEnvironment(){b('sdk_acquisition');let count=0;return {
 startHttp(){return {run:async work=>{b('scoped_read');return work();},finish(){}};},
 correlation(){return {traceId:'a'.repeat(32),spanId:'b'.repeat(16)};},
 async flush(){b('sdk_flush');},diagnostics(){b('sdk_diagnostics');return {droppedSpans:0,failedTraceExports:0,failedMetricExports:0};},
 async shutdown(){globalThis.__insideSdkPhaseFixture.shutdown();}};}`);
modules.set(storage,`import './s3-request-observation.js';const b=globalThis.__insideSdkPhaseFixture.boundary;
 export function createS3ObjectStorage(config){b('storage_acquisition');return {async read(){
 const response=await fetch(config.endpoint+'/sdk-storage-private-protected/assets/sdk-storage-private',{headers:{authorization:'private-access-key'}});
 return {body:new Uint8Array(await response.arrayBuffer()),checksumSha256:'sdk-storage-private',contentLength:19,contentType:'application/octet-stream'};}};}`);
for(const [path,code] of modules)urls.set(pathToFileURL(path).href,code);
for(const name of ['openSync','lstatSync','statSync','unlinkSync'])fs[name]=(...args)=>Reflect.apply(original[name],fs,[translate(args[0]),...args.slice(1)]);
fs.realpathSync=(path,...args)=>modules.has(path)?path:original.realpathSync(translate(path),...args);
fs.readFileSync=(path,...args)=>modules.has(path)?Buffer.from(modules.get(path)):original.readFileSync(path,...args);
fs.renameSync=(from,to)=>original.renameSync(translate(from),translate(to));
fs.writeFileSync=(target,value,...args)=>{if(typeof value==='string'){try{const row=JSON.parse(value);if(row.scope==='sdk'&&row.state==='completed')completedAfterCleanup=events.at(-1)==='cleanup_hooks';}catch{}}return original.writeFileSync(target,value,...args);};
const fixture=registerHooks({resolve(specifier,context,next){
 const url=specifier.startsWith('file:')?specifier:context.parentURL?new URL(specifier,context.parentURL).href:'';
 if(urls.has(url))return {url,shortCircuit:true};return next(specifier,context);
},load(url,context,next){if(urls.has(url)){if(busy&&url.endsWith('technical-telemetry-runtime.js'))boundary('modules_import');return {format:'module',source:urls.get(url),shortCircuit:true};}return next(url,context);}});
const module=await import('node:module');const originalRegister=module.default.registerHooks;
module.default.registerHooks=(options)=>{if(busy)boundary('hooks_setup');const handle=originalRegister(options);hooks.push(handle);return {deregister(){if(busy)boundary('cleanup_hooks');handle.deregister();}};};
const http=await import('node:http');const originalServer=http.default.createServer;
http.default.createServer=(...args)=>{const server=originalServer(...args);servers.push(server);server.on('listening',()=>{const address=server.address();if(address&&typeof address==='object')ports.push(address.port);});const listen=server.listen;server.listen=function(...args){if(busy)boundary('provider_acquisition');return Reflect.apply(listen,this,args);};const close=server.closeAllConnections;server.closeAllConnections=function(){if(busy)boundary('cleanup_provider');return Reflect.apply(close,this,[]);};return server;};
const assertionOriginals={};
for(const name of ['match','ok','equal','deepEqual']){assertionOriginals[name]=assert[name];assert[name]=(...args)=>{
 if(busy&&original.existsSync(marker)){const row=JSON.parse(original.readFileSync(marker,'utf8'));if(row.state==='running'&&['input_validation','read_contract','witness_contract'].includes(row.phase)&&events.at(-1)!==row.phase)boundary(row.phase);}
 return Reflect.apply(assertionOriginals[name],assert,args);
};}
syncBuiltinESMExports();
let report={identity:false,normal:false,pid:process.pid,ports,events,completed_after_cleanup:false};
try{
 const {createSdkEmitterPhase}=await import(setup.phase);
 const {emit}=await import(setup.emitter);
 const owner=createSdkEmitterPhase(process.env);
 if(owner===null)throw new Error('controlled observer absent');
 busy=true;
 try{const value=await emit('http://127.0.0.1:14318',source,owner);report.normal=value?.schema===2&&value?.provider_requests===1;report.identity=failures[0]==='success';}
 catch(error){report.identity=error===(failures.some(x=>x.startsWith('cleanup_'))?cleanupError:bodyError);process.exitCode=3;}
 report.completed_after_cleanup=completedAfterCleanup;
}catch{process.exitCode=4;}
finally{
 busy=false;
 for(const server of servers){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(()=>resolve()));}
 for(const handle of hooks)handle.deregister();fixture.deregister();
 original.writeFileSync(setup.report,JSON.stringify(report));
}
process.stdout.write('{}');
'''


class SdkEntrypointPhaseTest(unittest.TestCase):
    def test_every_original_entrypoint_checkpoint_first_failure_and_cleanup_order(self):
        import socket
        import sys
        import sdk_storage
        phases=('input_validation','hooks_setup','modules_import','provider_acquisition','sdk_acquisition',
                'storage_acquisition','scoped_read','read_contract','sdk_flush','sdk_diagnostics','sdk_shutdown',
                'witness_contract','cleanup_sdk','cleanup_provider','cleanup_hooks')
        for failure in ('success',)+phases+('read_contract+cleanup_provider','read_contract+cleanup_sdk'):
            with self.subTest(phase=failure),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();report=output/'fixture.json';original=None
                settings=dict(failure=failure,shim=sys.platform!='linux',emitter=Path(__file__).with_name('emitter.mjs').as_uri(),phase=Path(__file__).with_name('emitter-phase.mjs').as_uri(),report=str(report))
                try:
                    with phase.OwnedSdkPhase(output,source=SOURCE) as owner:
                        try:sdk_storage.emitter(argv=['node','--input-type=module','-e',SDK_ENTRY_FIXTURE,json.dumps(settings)],environment=owner.environment(dict(os.environ)),budget=3)
                        except RuntimeError as error:
                            original=error
                            raise
                except RuntimeError as observed:
                    self.assertTrue(observed is original,'capture primary identity changed')
                except BaseException:
                    self.fail('controlled SDK phase fixture failed')
                self.assertTrue(report.exists(),'controlled SDK report missing')
                observed=json.loads(report.read_text())
                self.assertTrue(observed['identity'],'original producer error/return changed')
                self.assertFalse(owner.path.parent.exists())
                with self.assertRaises(ProcessLookupError):os.kill(observed['pid'],0)
                for port in observed['ports']:
                    with socket.socket() as listener:
                        # Closed loopback connections may retain TIME_WAIT. A new
                        # listening socket proves no live listener owns this port.
                        listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                        try:
                            listener.bind(('127.0.0.1',port));listener.listen(1)
                        except OSError:self.fail('owned fixture listener remained')
                value=phase.read(output/phase.NAME,source=SOURCE)
                if failure=='success':
                    self.assertTrue(observed['normal'],'original producer return changed')
                    self.assertTrue(observed['completed_after_cleanup'],'completion preceded original cleanup')
                    self.assertEqual(value,record('completed','result_ready'))
                    self.assertEqual(set(observed['events']),set(phases))
                else:
                    self.assertTrue(original is not None,'native nonzero outcome missing')
                    self.assertEqual(value,record('failed',failure.split('+')[0],'operation_failed'))

CAPTURE_PHASE_FIXTURE=r'''
import fs from 'node:fs';import {createServer} from 'node:http';import {syncBuiltinESMExports} from 'node:module';
const setup=JSON.parse(process.argv[1]),original={...fs};
const marker=process.env[setup.path_key],directory=marker.slice(0,marker.lastIndexOf('/'));
const translate=p=>setup.shim&&typeof p==='string'&&/^\/proc\/self\/fd\/[0-9]+(?:\/|$)/.test(p)?directory+p.replace(/^\/proc\/self\/fd\/[0-9]+/,''):p;
for(const name of ['openSync','lstatSync','statSync','unlinkSync','realpathSync'])fs[name]=(...args)=>Reflect.apply(original[name],fs,[translate(args[0]),...args.slice(1)]);
fs.renameSync=(from,to)=>original.renameSync(translate(from),translate(to));syncBuiltinESMExports();
const module=await import(setup.phase),phase=module[setup.factory](process.env);
if(phase===null)process.exit(4);
const server=createServer();server.listen(0,'127.0.0.1',()=>{
 const address=server.address();original.writeFileSync(setup.report,JSON.stringify({pid:process.pid,port:address.port}));
 phase.enter('input_validation');process.stderr.write('private-phase-sentinel');
 if(setup.ending==='deadline')process.on('SIGTERM',()=>{});
 else if(setup.ending==='interruption')process.stdout.write('x');
 else if(setup.ending==='cap')process.stdout.write('x'.repeat(setup.cap+1));
 else if(setup.ending==='exit')process.exit(3);
 else if(setup.ending==='invalid_exit'){original.writeFileSync(marker,'private-invalid-phase');process.exit(3);}
 else if(setup.ending==='failed_zero'){phase.failed();server.close(()=>process.stdout.write('{}'));}
 else server.close(()=>{phase.completed();if(setup.ending==='completed_exit')process.exit(3);process.stdout.write(setup.ending==='decode'?'{':'{}');});
});
'''


def capture_phase_outcomes(test,scope):
    """Existing SDK/tracking capture owners; no new process group/transport/budget."""
    import socket
    import sys
    import sdk_storage
    if scope=='sdk':
        owner=phase.OwnedSdkPhase;module=phase;capture=sdk_storage.emitter;selector=sdk_storage.selectors
        helper=Path(__file__).with_name('emitter-phase.mjs');factory='createSdkEmitterPhase';path_key='INSIDE_SDK_EMITTER_PHASE_PATH';cap=sdk_storage.CHILD_BYTES
    else:
        import producer_phase
        import producer_protocol
        owner=producer_phase.OwnedTrackingPhase;module=producer_phase;capture=producer_protocol.capture;selector=producer_protocol.selectors
        helper=Path(__file__).parent.parent/'observability-tracking-storage/producer-phase.mjs';factory='createTrackingProducerPhase';path_key='INSIDE_TRACKING_PRODUCER_PHASE_PATH';cap=producer_protocol.CHILD_BYTES
    for ending in ('success','exit','deadline','interruption','cap','invalid_exit','failed_zero','completed_exit','decode'):
        with test.subTest(scope=scope,ending=ending),tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();report=output/'fixture.json';primary=None;observed=None
            settings=dict(shim=sys.platform!='linux',phase=helper.as_uri(),factory=factory,path_key=path_key,report=str(report),ending=ending,cap=cap)
            try:
                with owner(output,source=SOURCE) as owned:
                    environment=owned.environment(dict(os.environ))
                    def run():
                        return capture(argv=['node','--input-type=module','-e',CAPTURE_PHASE_FIXTURE,json.dumps(settings)],environment=environment,budget=.4 if ending=='deadline' else 3)
                    try:
                        if ending=='interruption':
                            original=selector.DefaultSelector.select
                            def interrupt(select,timeout):
                                original(select,timeout)
                                raise KeyboardInterrupt()
                            with patch.object(selector.DefaultSelector,'select',interrupt):run()
                        else:run()
                    except BaseException as error:
                        primary=error
                        raise
            except BaseException as error:observed=error
            if ending=='success':test.assertTrue(observed is None,'successful capture changed')
            elif ending=='failed_zero':test.assertTrue(type(observed) is ValueError,'failed child exit-zero contradiction admitted')
            else:test.assertTrue(observed is primary and observed is not None,'capture primary identity changed')
            test.assertTrue(report.exists(),'owned capture report missing')
            process=json.loads(report.read_text())
            with test.assertRaises(ProcessLookupError):os.kill(process['pid'],0)
            with socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                try:listener.bind(('127.0.0.1',process['port']));listener.listen(1)
                except OSError:test.fail('capture listener remained')
            test.assertFalse(owned.path.parent.exists())
            value=module.read(output/module.NAME,source=SOURCE)
            expected='refused' if ending=='invalid_exit' else 'failed' if ending=='failed_zero' else 'completed' if ending in ('success','completed_exit','decode') else 'running'
            test.assertEqual(value['state'],expected)
            test.assertNotIn('private-phase-sentinel',json.dumps(value))


class SdkCaptureOutcomes(unittest.TestCase):
    def test_actual_capture_exit_deadline_interrupt_cap_and_outer_failure(self):
        capture_phase_outcomes(self,'sdk')


class SdkAtomicOwnershipTest(unittest.TestCase):
    def test_recreated_temp_after_close_cannot_be_committed_as_writer_owned(self):
        import stat
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();temporary=root/'phase.json.new';path=root/phase.NAME
            original_close=os.close;swapped=False
            def close(fd):
                nonlocal swapped
                regular=stat.S_ISREG(os.fstat(fd).st_mode)
                original_close(fd)
                if regular and not swapped:
                    swapped=True
                    os.replace(temporary,root/'writer-inode')
                    temporary.write_bytes(b'foreign-recreated');temporary.chmod(0o600)
            with patch.object(phase.os,'close',side_effect=close),self.assertRaises(ValueError):
                phase.write(path,record(),source=SOURCE)
            self.assertEqual(temporary.read_bytes(),b'foreign-recreated')
            self.assertFalse(path.exists())

class SdkMetadataAndCollectionTest(unittest.TestCase):
    def metadata(self,root):
        metadata=root/'metadata';metadata.mkdir(mode=0o700)
        value=dict(checkout_sha=SOURCE,checkout_tree='b'*40,repository=None,run_id=None,run_attempt=None,event=None,
                   provider_execution_sha=SOURCE,provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={'tracked/path':'c'*64},scope='fixture')
        path=metadata/'source.json';path.write_text(json.dumps(value));path.chmod(0o600)
        return metadata,path,value

    def test_complete_bounded_source_receipt_and_duplicate_keys_never_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();metadata,path,value=self.metadata(root)
            invalid=[b' '*1_048_577,b'{"checkout_sha":"'+SOURCE.encode()+b'","checkout_sha":"'+SOURCE.encode()+b'"}',b'{"private":NaN}',b'['*2000]
            for raw in invalid:
                path.write_bytes(raw)
                with self.assertRaises(ValueError):phase.source_from_metadata(metadata)
            for field,item in [('checkout_sha','A'*40),('checkout_tree','b'*39),('provider_pr_head_sha',False),('provider_pr_base_sha','private'),('scope',None),('repository',{}),('inputs',{'x'*1025:'d'*64})]:
                path.write_text(json.dumps({**value,field:item}))
                with self.assertRaises(ValueError):phase.source_from_metadata(metadata)
            path.write_text(json.dumps({**value,'inputs':{'x'*1024:'d'*64}}))
            self.assertEqual(phase.source_from_metadata(metadata),SOURCE)
            path.unlink();foreign=root/'foreign';foreign.write_text(json.dumps(value));foreign.chmod(0o600);path.symlink_to(foreign)
            with self.assertRaises(ValueError):phase.source_from_metadata(metadata)

    def test_collection_prevalidates_and_rewrites_canonical_without_raw_phase_copy(self):
        import sdk_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();metadata,_,_=self.metadata(root)
            output=root/'private';output.mkdir(mode=0o700);destination=root/'public'
            expected=record('completed','result_ready')
            raw=json.dumps(expected,indent=4)+'\n\n';(output/phase.NAME).write_text(raw);(output/phase.NAME).chmod(0o600)
            with patch.object(sdk_storage.diagnostics,'read',return_value=sdk_storage.diagnostics.unknown('sdk')),patch.object(sdk_storage.diagnostics,'write'):
                def collect(_output,_metadata,target,*,artifacts):
                    self.assertNotIn(phase.NAME,artifacts)
                    self.assertEqual(set(artifacts),{'evidence.json','cleanup.json','worker-outcome.json','sdk-storage.json','runtime-modules.json','recovery.json'})
                    target.mkdir(mode=0o700)
                with patch.object(sdk_storage.ci,'collect',side_effect=collect):sdk_storage.collect(output,metadata,destination)
            canonical=(destination/phase.NAME).read_bytes()
            self.assertEqual(canonical,(json.dumps(expected,sort_keys=True,separators=(',',':'))+'\n').encode())
            self.assertLess(len(canonical),len(raw))
            invalid={**expected,'private':'private-corpus-marker'};(output/phase.NAME).write_text(json.dumps(invalid));(output/phase.NAME).chmod(0o600)
            with patch.object(sdk_storage.diagnostics,'read',return_value={}),patch.object(sdk_storage.ci,'collect') as collect:
                with self.assertRaises(ValueError):sdk_storage.collect(output,metadata,root/'refused')
                self.assertTrue(collect.call_count==0,'raw private phase reached public collection')
            self.assertFalse((root/'refused').exists())

    def test_legacy_absent_marker_requires_admission_source_before_public_copy(self):
        import sdk_storage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();metadata,path,value=self.metadata(root)
            output=root/'private';output.mkdir(mode=0o700)
            # Reproduce the former direct collection boundary: generic copying did not
            # interpret source authority when passed the application artifact list.
            path.write_text(json.dumps({**value,'provider_execution_sha':None}))
            legacy=root/'legacy'
            sdk_storage.ci.collect(output,metadata,legacy,artifacts=())
            self.assertIsNone(json.loads((legacy/'source.json').read_text())['provider_execution_sha'])
            for index,receipt in enumerate([None,{**value,'provider_execution_sha':None},value]):
                if receipt is None:path.unlink()
                else:path.write_text(json.dumps(receipt))
                destination=root/('public-'+str(index))
                if receipt!=value:
                    with self.assertRaises(ValueError):sdk_storage.collect(output,metadata,destination)
                    self.assertFalse(destination.exists())
                else:
                    sdk_storage.collect(output,metadata,destination)
                    self.assertEqual(phase.read(destination/phase.NAME,source=SOURCE),record('unknown','unknown','unavailable'))
                    self.assertEqual(json.loads((destination/'source.json').read_text()),value)

    def test_unobservable_parent_and_disappearing_present_file_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            with self.assertRaises(ValueError):phase.read(root/'absent'/phase.NAME,source=SOURCE)
            path=root/phase.NAME;phase.write(path,record(),source=SOURCE)
            original=os.read
            def disappear(fd,count):
                value=original(fd,count)
                path.unlink(missing_ok=True)
                return value
            with patch.object(phase.os,'read',side_effect=disappear),self.assertRaises(ValueError):phase.read(path,source=SOURCE)

if __name__=='__main__':unittest.main()
