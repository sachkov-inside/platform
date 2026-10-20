"""Owned Node producer phase controls, no production API/PG or external provider."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

import producer_phase
import producer_protocol

SOURCE='a'*40
CODE=r'''
import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const settings=JSON.parse(process.argv[1]);const original={...fs};
const directory=process.env.INSIDE_TRACKING_PRODUCER_PHASE_PATH.replace(/\/phase.json$/,'');
const translate=p=>settings.shim&&typeof p==='string'&&/^\/proc\/self\/fd\/[0-9]+(?:\/|$)/.test(p)?directory+p.replace(/^\/proc\/self\/fd\/[0-9]+/,''):p;
for(const name of ['openSync','lstatSync','statSync','unlinkSync','realpathSync'])fs[name]=(...args)=>Reflect.apply(original[name],fs,[translate(args[0]),...args.slice(1)]);
fs.renameSync=(from,to)=>original.renameSync(translate(from),translate(to));syncBuiltinESMExports();
try{
 const {createTrackingProducerPhase,admitTrackingProducerPhase}=await import(settings.phase);
 const {produce}=await import(settings.producer);
 let touched=false;const foreign=new Proxy({},{get(){touched=true;throw new Error('synthetic getter');},getPrototypeOf(){touched=true;throw new Error('synthetic prototype');}});
 if(admitTrackingProducerPhase(foreign)!==null||touched)throw new Error('closed admission');
 const observer=createTrackingProducerPhase(process.env);if(observer===null)throw new Error('controlled owner absent');
 try{await produce('invalid',()=>{},observer);}catch{process.exitCode=3;}
 original.writeFileSync(settings.report,JSON.stringify({pid:process.pid,foreign_touched:touched}));
}catch{process.exitCode=4;}
process.stdout.write('{}');
'''


class ProducerEntryPhase(unittest.TestCase):
    def test_real_entry_input_observation_preserves_native_exit_and_reaps_child(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();report=output/'fixture.json';captured=None
            settings=dict(shim=sys.platform!='linux',phase=Path(__file__).with_name('producer-phase.mjs').as_uri(),producer=Path(__file__).with_name('producer.mjs').as_uri(),report=str(report))
            try:
                with producer_phase.OwnedTrackingPhase(output,source=SOURCE) as phase:
                    try:producer_protocol.capture(argv=['node','--input-type=module','-e',CODE,json.dumps(settings)],environment=phase.environment(dict(os.environ)),budget=3)
                    except RuntimeError as error:
                        captured=error
                        raise
            except RuntimeError as observed:self.assertTrue(observed is captured,'capture primary changed')
            except BaseException:self.fail('producer source fixture failed')
            self.assertTrue(captured is not None,'native exit was lost')
            self.assertTrue(report.exists(),'closed source report missing')
            report_value=json.loads(report.read_text())
            self.assertFalse(report_value['foreign_touched'])
            with self.assertRaises(ProcessLookupError):os.kill(report_value['pid'],0)
            self.assertFalse(phase.path.parent.exists())
            value=producer_phase.read(output/producer_phase.NAME,source=SOURCE)
            self.assertEqual((value['state'],value['phase'],value['reason']),('failed','input_validation','operation_failed'))



# Fixed compiled-module/library substitutes. No genuine API, PG, timer or stored
# runtime witness is claimed; Linux still exercises the genuine marker FD path.
TRACKING_ENTRY_FIXTURE=r'''
import assert from 'node:assert/strict';import fs from 'node:fs';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';import {fileURLToPath,pathToFileURL} from 'node:url';
const settings=JSON.parse(process.argv[1]),source='a'.repeat(40);
const marker=process.env.INSIDE_TRACKING_PRODUCER_PHASE_PATH,directory=marker.slice(0,marker.lastIndexOf('/'));
const original={...fs},modules=new Map(),urls=new Map(),events=[],checkpoints=[],servers=[],ports=[],hooks=[];
const failures=settings.failure.split('+'),faults=new Map(failures.map(name=>[name,new Error('synthetic fixture failure')]));
let busy=false,completedAfterCleanup=false;
const translate=p=>settings.shim&&typeof p==='string'&&/^\/proc\/self\/fd\/[0-9]+(?:\/|$)/.test(p)?directory+p.replace(/^\/proc\/self\/fd\/[0-9]+/,''):p;
function row(){return JSON.parse(original.readFileSync(marker,'utf8'));}
function boundary(name){events.push(name);if(faults.has(name))throw faults.get(name);}
function shutdown(kind){const current=row();boundary(current.state==='running'&&current.phase===kind+'_shutdown'?kind+'_shutdown':'cleanup_'+kind);}
const token='private_tracking_token_storage_sentinel_0000000000';
const hit={eventId:'fixture-event',token,traffic:'unknown',traceparent:'00-'+source.slice(0,32)+'-'+'b'.repeat(16)+'-01',occurredAt:new Date('2030-01-01T00:00:00Z'),deliveredAt:new Date('2030-01-01T00:00:00Z')};
globalThis.__insideTrackingPhaseFixture={boundary,shutdown,hit};
const root=fileURLToPath(new URL('../../',settings.producer));
const paths={config:'config/platform-config.js',api:'entrypoints/api/create-api-application.js',prisma:'infrastructure/prisma/index.js',migration:'migrations/index.js',schema:'modules/communications/communications-schema.generated.js'};
modules.set(root+'apps/backend/dist/'+paths.config,`export function parsePlatformConfig(value){globalThis.__insideTrackingPhaseFixture.boundary('configuration');return value;}`);
modules.set(root+'apps/backend/dist/'+paths.migration,`export async function migrateToLatest(){globalThis.__insideTrackingPhaseFixture.boundary('migration');}`);
modules.set(root+'apps/backend/dist/'+paths.prisma,`const f=globalThis.__insideTrackingPhaseFixture;export function createPrismaClient(){f.boundary('prisma_acquisition');return {communicationTrackingHit:{async findMany(){f.boundary('carrier_check');return [f.hit];},async findUniqueOrThrow(){f.boundary('delivery_wait');return f.hit;}},async $disconnect(){f.shutdown('prisma');}};}`);
modules.set(root+'apps/backend/dist/'+paths.schema,`export const requestSchema={parse(value){return value;}};`);
modules.set(root+'apps/backend/dist/'+paths.api,`import {createServer} from 'node:http';import {once} from 'node:events';const f=globalThis.__insideTrackingPhaseFixture;
export async function createApiApplication(config){f.boundary('api_acquisition');const server=createServer(async (request,response)=>{
request.resume();const endpoint=config.TELEGRAM_COMMUNICATIONS_ENDPOINT;const headers={'content-type':'application/json',authorization:'Bearer '+config.TELEGRAM_COMMUNICATIONS_SECRET};
const resolved=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({operation:'tracking.resolve',payload:{token:f.hit.token}})});const target=await resolved.json();
await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({operation:'tracking.recordHit',operationId:f.hit.eventId,payload:{eventId:f.hit.eventId,token:f.hit.token,traffic:'unknown',occurredAt:f.hit.occurredAt.toISOString()}})});
response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({kind:'resolved',safeUrl:target.safeUrl}));
});return {async listen(port,address){f.boundary('api_listen');server.listen(port,address);await once(server,'listening');},async getUrl(){f.boundary('http_request');return 'http://127.0.0.1:'+server.address().port;},async close(){f.shutdown('api');if(server.listening)await new Promise(resolve=>server.close(()=>resolve()));}};}`);
for(const [path,code] of modules)urls.set(pathToFileURL(path).href,code);
for(const name of ['openSync','lstatSync','statSync','unlinkSync'])fs[name]=(...args)=>Reflect.apply(original[name],fs,[translate(args[0]),...args.slice(1)]);
fs.realpathSync=(path,...args)=>modules.has(path)?path:original.realpathSync(translate(path),...args);
fs.readFileSync=(path,...args)=>modules.has(path)?Buffer.from(modules.get(path)):original.readFileSync(path,...args);
fs.renameSync=(from,to)=>original.renameSync(translate(from),translate(to));
fs.writeFileSync=(target,value,...args)=>{if(typeof value==='string'){try{const record=JSON.parse(value);if(record.scope==='tracking'){if(record.state==='running')checkpoints.push(record.phase);if(record.state==='completed')completedAfterCleanup=events.at(-1)==='cleanup_hooks';}}catch{}}return original.writeFileSync(target,value,...args);};
const fixture=registerHooks({resolve(specifier,context,next){const url=specifier.startsWith('file:')?specifier:context.parentURL?new URL(specifier,context.parentURL).href:'';if(urls.has(url))return {url,shortCircuit:true};return next(specifier,context);},load(url,context,next){if(urls.has(url)){if(busy&&url.endsWith('platform-config.js'))boundary('imports');return {format:'module',source:urls.get(url),shortCircuit:true};}return next(url,context);}});
const module=await import('node:module'),originalRegister=module.default.registerHooks;
module.default.registerHooks=(options)=>{if(busy)boundary('hooks_setup');const handle=originalRegister(options);hooks.push(handle);return {deregister(){if(busy)boundary('cleanup_hooks');handle.deregister();}};};
const http=await import('node:http'),originalServer=http.default.createServer;
http.default.createServer=(...args)=>{const server=originalServer(...args);servers.push(server);server.on('listening',()=>{const address=server.address();if(address&&typeof address==='object')ports.push(address.port);});if(servers.length===1){const listen=server.listen;server.listen=function(...args){if(busy)boundary('provider_acquisition');return Reflect.apply(listen,this,args);};const close=server.closeAllConnections;server.closeAllConnections=function(){if(busy)boundary('cleanup_provider');return Reflect.apply(close,this,[]);};}return server;};
const assertionOriginals={};
for(const name of ['match','ok','equal','deepEqual']){assertionOriginals[name]=assert[name];assert[name]=(...args)=>{if(busy&&original.existsSync(marker)){const current=row();if(current.state==='running'&&['input_validation','http_contract','delivery_contract'].includes(current.phase)&&events.at(-1)!==current.phase)boundary(current.phase);}return Reflect.apply(assertionOriginals[name],assert,args);};}
syncBuiltinESMExports();
let report={identity:false,normal:false,pid:process.pid,ports,events,checkpoints,completed_after_cleanup:false};
try{
const {createTrackingProducerPhase}=await import(settings.phase);const {produce}=await import(settings.producer);
const observer=createTrackingProducerPhase(process.env);if(observer===null)throw new Error('controlled owner absent');busy=true;
try{const result=await produce('postgresql://tracking:tracking_fixture@127.0.0.1:15432/tracking',name=>{if(name==='module_map_ready')boundary('module_map');},observer);report.normal=result?.schema===1;report.identity=settings.failure==='success';}
catch(error){const lastCleanup=failures.filter(name=>name.startsWith('cleanup_')).at(-1);report.identity=error===faults.get(lastCleanup??failures[0]);process.exitCode=3;}
report.completed_after_cleanup=completedAfterCleanup;
}catch{process.exitCode=4;}
finally{busy=false;for(const server of servers){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(()=>resolve()));}for(const handle of hooks)handle.deregister();fixture.deregister();original.writeFileSync(settings.report,JSON.stringify(report));}
process.stdout.write('{}');
'''


class TrackingAllEntryPhases(unittest.TestCase):
    def test_actual_entrypoint_phase_and_original_nested_finally_order(self):
        import socket
        operations=('input_validation','hooks_setup','imports','migration','prisma_acquisition','provider_acquisition','configuration',
                    'api_acquisition','api_listen','http_request','http_contract','carrier_check','delivery_wait','delivery_contract',
                    'api_shutdown','prisma_shutdown','module_map')
        cleanup=('cleanup_api','cleanup_prisma','cleanup_provider','cleanup_hooks')
        cases=('success',)+operations+('cleanup_provider','cleanup_hooks','http_contract+cleanup_api',
                                      'http_contract+cleanup_prisma','http_contract+cleanup_api+cleanup_prisma')
        for failure in cases:
            with self.subTest(phase=failure),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();report=output/'fixture.json';primary=None
                settings=dict(shim=sys.platform!='linux',failure=failure,producer=Path(__file__).with_name('producer.mjs').as_uri(),phase=Path(__file__).with_name('producer-phase.mjs').as_uri(),report=str(report))
                try:
                    with producer_phase.OwnedTrackingPhase(output,source=SOURCE) as owner:
                        try:producer_protocol.capture(argv=['node','--input-type=module','-e',TRACKING_ENTRY_FIXTURE,json.dumps(settings)],environment=owner.environment(dict(os.environ)),budget=3)
                        except RuntimeError as error:
                            primary=error
                            raise
                except RuntimeError as observed:self.assertTrue(observed is primary,'capture primary identity changed')
                except BaseException:self.fail('controlled tracking phase fixture failed')
                self.assertTrue(report.exists(),'controlled tracking report missing')
                observed=json.loads(report.read_text())
                self.assertTrue(observed['identity'],'original nested producer error/return changed')
                with self.assertRaises(ProcessLookupError):os.kill(observed['pid'],0)
                for port in observed['ports']:
                    with socket.socket() as listener:
                        listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                        try:listener.bind(('127.0.0.1',port));listener.listen(1)
                        except OSError:self.fail('owned fixture listener remained')
                self.assertFalse(owner.path.parent.exists())
                value=producer_phase.read(output/producer_phase.NAME,source=SOURCE)
                if failure=='success':
                    self.assertTrue(observed['normal'],'original producer result changed')
                    self.assertTrue(observed['completed_after_cleanup'],'completion preceded cleanup')
                    self.assertEqual(observed['checkpoints'],list(operations+cleanup))
                    self.assertEqual((value['state'],value['phase']),('completed','result_ready'))
                else:
                    self.assertTrue(primary is not None,'native exit was lost')
                    self.assertEqual((value['state'],value['phase']),('failed',failure.split('+')[0]))


class TrackingCaptureOutcomes(unittest.TestCase):
    def test_actual_capture_exit_deadline_interrupt_cap_and_outer_failure(self):
        sdk=Path(__file__).parent.parent/'observability-sdk-storage'
        sys.path.insert(0,str(sdk))
        from test_emitter_phase import capture_phase_outcomes
        capture_phase_outcomes(self,'tracking')

if __name__=='__main__':unittest.main()
