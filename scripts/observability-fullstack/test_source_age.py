"""Actual phase client and public JSON capture; native HTTP is controlled, never executed."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import fullstack


PRELOAD = r'''
import fs from 'node:fs';
import http from 'node:http';
import timers from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
const setup=JSON.parse(process.env.INSIDE_SOURCE_AGE_TEST),read=fs.readFileSync;
let clock=0,rounds=0,diagnosticCalls=0,sourceCalls=0;
const cuts=[],timeouts=[];let release;
const observed=new Promise(resolve=>release=resolve);
Object.defineProperty(globalThis,'performance',{value:{now:()=>clock},configurable:true});
// Deliberately distinct from native cut1000; diagnostic must never use client wall time.
Date.now=()=>2000000+clock;
fs.readFileSync=(path,...args)=>path==='/resource/full-profile.json'?read(setup.profile,...args)
 :path==='/private/umami.json'?JSON.stringify({site:'synthetic-site',key:'synthetic-key'})
 :path==='/query/key'?'synthetic-key':read(path,...args);
timers.setTimeout=async milliseconds=>{
 if(milliseconds>=1000){await observed;clock=10000;return;}
 if(milliseconds!==500)throw new Error('unexpected phase pause');
 if(++rounds>=setup.rounds)release();
 await new Promise(resolve=>setImmediate(resolve));
};
const realTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,milliseconds,...args)=>{
 timeouts.push(milliseconds);
 return realTimeout(callback,setup.kind==='timeout'&&milliseconds===2000?0:milliseconds,...args);
};
const vector=value=>({status:'success',data:{resultType:'vector',result:[{metric:{},value:[1000,String(value)]}]}});
function cache(){const cut=1000+sourceCalls-1;return {status:'success',data:{resultType:'vector',result:[
 {metric:{job:'source_cache_ready',source:'cohort'},value:[cut,setup.kind==='success'?'2':'1']},
 {metric:{job:'source_cache_evaluation',source:'cohort'},value:[cut,String(cut)]},
 ...['postgresql','caddy'].flatMap(source=>[
 {metric:{job:'source_cache_available',source},value:[cut,source==='postgresql'&&setup.kind==='unavailable'?'0':'1']},
 {metric:{job:'source_cache_observed',source},value:[cut,String(cut-(source==='postgresql'&&setup.kind!=='success'?12:5))]},
 {metric:{job:'source_cache_age',source},value:[cut,source==='postgresql'&&setup.kind!=='success'?'12':'5']},
 ])]}};}
function sample(){
 const value={status:'success',data:{resultType:'vector',result:['postgresql','caddy'].flatMap(source=>[
 {metric:{job:'source_cache_sample_value',source},value:[1000,'997']},
 {metric:{job:'source_cache_sample_time',source},value:[1000,'998.5']},
 ])},stats:{seriesFetched:'2',executionTimeMsec:1}};
 const rows=value.data.result;
 if(setup.kind==='during_scrape'){rows[0].value[1]='999.9';rows[1].value[1]='999.8';}
 if(setup.kind==='future_value')rows[0].value[1]='1000.1';
 if(setup.kind==='fractional_stats')value.stats.executionTimeMsec=1.5;
 if(setup.kind==='wrong_source')rows[0].metric.source='private-source';
 if(setup.kind==='private_label')rows[0].metric.private='private-sentinel';
 if(setup.kind==='extra')value.private='private-sentinel';
 if(setup.kind==='duplicate')rows[3]=structuredClone(rows[0]);
 if(setup.kind==='missing')rows.pop();
 if(setup.kind==='nonfinite')rows[1].value[1]='Infinity';
 if(setup.kind==='wrong_cut')rows[1].value[0]=1001;
 if(setup.kind==='old_sample')rows[1].value[1]='969';
 if(setup.kind==='future')rows[1].value[1]='1001';
 return value;
}
http.request=(options,callback)=>{
 const path=new URL(options.path,'http://controlled.invalid'),query=path.searchParams.get('query')??'';
 let value={},status=200,hang=false;
 if(options.hostname==='umami-query')value={pageviews:1};
 else if(path.pathname.includes('jaeger'))value={data:[]};
 else if(query.includes('source_cache_ready')){sourceCalls++;value=cache();if(setup.kind==='source_http'){status=503;value='private-sentinel';}}
 else if(query.includes('source_cache_sample_value')){
  diagnosticCalls++;cuts.push(path.searchParams.get('time'));
  if(setup.kind==='throw')throw new Error('private-sentinel');
  if(options.hostname!=='gateway'||options.port!==8080||path.searchParams.get('nocache')!=='1')throw new Error('diagnostic authority changed');
  value=sample();if(setup.kind==='query_failure'){status=503;value='private-sentinel';}
  if(setup.kind==='oversize')value={private:'private-sentinel'.repeat(1000)};
  if(setup.kind==='timeout')hang=true;
 }else if(query==='1')value={status:'success',data:{resultType:'scalar',result:[1000,'1']}};
 else if(query.includes('pilot_requests'))value=vector(0);
 else if(query.includes('max(timestamp'))value=vector(2000);
 const request=new EventEmitter();request.destroy=()=>{};
 request.end=()=>{if(hang)return;queueMicrotask(()=>{
  const response=new EventEmitter();response.statusCode=status;response.headers={};callback(response);
  response.emit('data',Buffer.from(JSON.stringify(value)));response.emit('end');
 });};return request;
};
process.on('exit',()=>fs.writeFileSync(setup.meta,JSON.stringify({pid:process.pid,diagnostic_calls:diagnosticCalls,source_calls:sourceCalls,cuts,timeouts})));
syncBuiltinESMExports();
'''


class SourceAgeDiagnostic(unittest.TestCase):
    def client(self, kind='observed', *, rounds=2, action='load'):
        node=shutil.which('node');self.assertIsNotNone(node)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);preload=root/'preload.mjs';meta=root/'meta.json';preload.write_text(PRELOAD)
            setup=dict(kind=kind,rounds=rounds,meta=str(meta),profile=str(fullstack.PROFILE))
            args=[node,'--import',str(preload),str(fullstack.HERE/'client.mjs'),action]
            if action=='load':args += [json.dumps(dict(name='idle',seconds=10,requests_per_second=0)),'on','0']
            result=subprocess.run(args,env={**os.environ,'INSIDE_SOURCE_AGE_TEST':json.dumps(setup)},capture_output=True,text=True,timeout=3)
            self.assertEqual(result.returncode,0,'actual client changed its original outcome')
            captured=json.loads(result.stdout);calls=json.loads(meta.read_text())
            with self.assertRaises(ProcessLookupError):os.kill(calls['pid'],0)
            # Actual phase JSON writer and curated public-copy boundary, no fake parser output.
            private=root/'private';private.mkdir();metadata=root/'metadata';metadata.mkdir();public=root/'public'
            fullstack.pilot.write_json(private/'fullstack-phase-3.json',{'load':captured})
            fullstack.resource_runtime.ci.collect(private,metadata,public,artifacts=('fullstack-phase-3.json',))
            return json.loads((public/'fullstack-phase-3.json').read_text())['load'],calls

    def test_actual_sticky_failure_captures_one_native_sample_at_original_cut(self):
        value,calls=self.client()
        self.assertFalse(value['completed'])
        self.assertEqual(value['source_cache_failure_counts'],{'stale':2})
        self.assertEqual(calls['diagnostic_calls'],1,'first sticky failure has no diagnostic native sample')
        self.assertEqual(calls['cuts'],['1000'])
        self.assertEqual(calls['source_calls'],2)
        leaf=value['source_cache_sample_diagnostic']
        self.assertEqual(leaf,dict(state='observed',reason='observed',status=200,evaluation_seconds=1000,
            sources={source:dict(sample_value_seconds=997,sample_time_seconds=998.5,sample_age_seconds=1.5)
                     for source in ('postgresql','caddy')}))
        self.assertLessEqual(len(json.dumps(leaf).encode()),1024)
        self.assertTrue(all(timeout==2000 for timeout in calls['timeouts']))

    def test_source_observation_can_follow_scrape_start_before_evaluation(self):
        value,calls=self.client('during_scrape')
        self.assertFalse(value['completed'])
        self.assertEqual(value['source_cache_failure_counts'],{'stale':2})
        self.assertEqual(calls['diagnostic_calls'],1)
        leaf=value['source_cache_sample_diagnostic']
        self.assertEqual(leaf['state'],'observed')
        self.assertEqual(leaf['reason'],'observed')
        self.assertEqual(leaf['evaluation_seconds'],1000)
        sample=leaf['sources']['postgresql']
        self.assertEqual(sample['sample_value_seconds'],999.9)
        self.assertEqual(sample['sample_time_seconds'],999.8)
        self.assertAlmostEqual(sample['sample_age_seconds'],0.2)

    def test_success_admission_and_nonstale_failure_never_issue_sample_request(self):
        value,calls=self.client('success')
        self.assertTrue(value['completed']);self.assertEqual(calls['diagnostic_calls'],0)
        self.assertNotIn('source_cache_sample_diagnostic',value)
        for kind in ('unavailable','source_http'):
            with self.subTest(kind=kind):
                value,calls=self.client(kind)
                self.assertFalse(value['completed']);self.assertEqual(calls['diagnostic_calls'],0)
                self.assertNotIn('source_cache_sample_diagnostic',value)
        value,calls=self.client(action='cache-ready')
        self.assertFalse(value['ok']);self.assertEqual(calls['diagnostic_calls'],0)
        self.assertEqual(calls['source_calls'],1)

    def test_bad_native_sample_cannot_erase_original_failure_or_trigger_retry(self):
        cases={'wrong_source':'labels','private_label':'labels','extra':'schema','duplicate':'duplicate',
               'missing':'missing','nonfinite':'numeric','wrong_cut':'evaluation','old_sample':'numeric',
               'future':'numeric','future_value':'numeric','fractional_stats':'schema','oversize':'transport','query_failure':'http','timeout':'transport','throw':'transport'}
        for kind,reason in cases.items():
            with self.subTest(kind=kind):
                value,calls=self.client(kind,rounds=3)
                self.assertFalse(value['completed'])
                self.assertEqual(value['source_cache_failure_counts'],{'stale':3})
                self.assertEqual(calls['diagnostic_calls'],1)
                self.assertEqual(calls['cuts'],['1000'])
                leaf=value['source_cache_sample_diagnostic']
                self.assertEqual(leaf['state'],'unavailable');self.assertEqual(leaf['reason'],reason)
                self.assertEqual(leaf['evaluation_seconds'],1000)
                self.assertEqual(leaf['status'],503 if kind=='query_failure' else 0 if kind in ('oversize','timeout','throw') else 200)
                for source in ('postgresql','caddy'):
                    self.assertEqual(leaf['sources'][source],dict(sample_value_seconds=None,sample_time_seconds=None,sample_age_seconds=None))
                self.assertLessEqual(len(json.dumps(leaf).encode()),1024)
                self.assertNotIn('private',json.dumps(value))
