"""Public finite runner against a model of pinned VM query time rules, never native proof."""
import copy
import datetime
import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch
import email_privacy
import pilot
from test_email_corpus import NOW, metric_response, known_rows, adversarial_rows, raw_rows
from test_dependency_privacy import metric_rows


class FiniteStorage:
    """VM1.154 instant query: last raw value in (time-window,time], preserving metric names.

    Pinned QueryHandler defaults to now-30s and step=300s. Explicit last_over_time
    uses its own window; nocache=1 also prevents the latency time adjustment.
    This boundary model excludes buffering, native execution and transport behavior.
    """
    def __init__(self, *, age=241):
        self.seconds=age
        self.history=[]
        self.posts=[]
        self.trace_posts=[]
        self.trace_times={}
        self.paths=[]

    def monotonic(self):return self.seconds
    def ns(self):return NOW+round(self.seconds*1_000_000_000)
    def sleep(self,seconds):
        # External work may advance the registered clock between polls. No real wait.
        self.seconds+=15

    def http(self,path,*,token=None,body=None,method='GET',port=18427):
        if method=='POST':
            if path=='/v1/traces':
                transport='json' if len(self.trace_posts)<3 else 'protobuf'
                self.trace_posts.append(transport);self.trace_times[transport]=self.ns()
            else:
                index=len(self.posts)
                transport='json' if index==0 or 2<=index<8 else 'protobuf'
                stage=0 if index<2 else index-1 if index<8 else index-7
                self.posts.append((transport,stage));self.history.append((self.seconds,transport,stage))
                self.seconds+=.002
            return 200,''
        self.paths.append(path)
        query=urllib.parse.parse_qs(urllib.parse.urlsplit(path).query,strict_parsing=True)
        if query=={'query':['{__name__=~".+"}']}:
            evaluation=self.seconds-30;window=300
        elif query=={'query':['last_over_time({__name__=~".+"}[10m])'],'nocache':['1']}:
            evaluation=self.seconds;window=600
        else:
            raise ValueError('unregistered fixture query')
        rows=metric_rows() if evaluation-window<0<=evaluation else []
        visible={}
        for timestamp,transport,stage in self.history:
            if evaluation-window<timestamp<=evaluation:
                visible[(transport,stage!=0)]=stage
        stages={transport:visible.get((transport,True),0) for transport in ('json','protobuf')}
        for row in json.loads(metric_response(stages)[1])['data']['result']:
            transport='json' if row['metric']['service.version']=='a'*40 else 'protobuf'
            if (transport,row['metric']['operation']=='_OTHER') in visible:rows.append(row)
        return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':rows},
                              'stats':{'seriesFetched':str(len(rows)),'executionTimeMsec':0}})

    def traces(self,compose,fixture):
        transport='protobuf' if fixture.endswith('protobuf') else 'json'
        rows=adversarial_rows(transport) if 'adversarial' in fixture else known_rows(transport)
        ns=self.trace_times[transport];seconds,fraction=divmod(ns,1_000_000_000)
        instant=datetime.datetime.fromtimestamp(seconds,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
        instant+=(('.'+str(fraction).zfill(9).rstrip('0')) if fraction else '')+'Z'
        for row in rows:
            row.update({'start_time_unix_nano':str(ns),'end_time_unix_nano':str(ns+1_000_000),'_time':instant})
        return raw_rows(rows)


def run_finite(store):
    with tempfile.TemporaryDirectory() as directory,patch('pilot.verify_trace_store_logging'),patch('pilot.assert_docker_identity'),patch('pilot.request',side_effect=store.http),patch('pilot.fixture_trace_rows',side_effect=store.traces),patch('pilot.time.monotonic',side_effect=store.monotonic),patch('pilot.time.time_ns',side_effect=store.ns),patch('pilot.time.sleep',side_effect=store.sleep):
        try:pilot.email_catalog_corpus('PRIVATE_TOKEN',Path(directory),[])
        except RuntimeError:pass
        return json.loads((Path(directory)/'email-collector.json').read_text())


class FiniteEmailHistory(unittest.TestCase):
    def test_complete_runner_retains_one_shot_legacy_during_the_existing_worker_window(self):
        for age in (0,241,599):
            with self.subTest(initial_age_seconds=age):
                store=FiniteStorage(age=age);proof=run_finite(store)
                self.assertEqual(proof['outcome'],'passed',proof['stage'])
                self.assertEqual(proof['uploads'],20);self.assertEqual(len(proof['metric_checkpoints']),13)
                self.assertEqual(proof['metric_checkpoints'][-1]['email']['fallback_stages'],{'json':6,'protobuf':6})
                self.assertLess(store.seconds,600)
                for path in store.paths:
                    parsed=urllib.parse.urlsplit(path)
                    self.assertEqual(parsed.path,'/metrics/api/v1/query')
                    self.assertEqual(urllib.parse.parse_qs(parsed.query),{
                        'query':['last_over_time({__name__=~".+"}[10m])'],'nocache':['1']})
                self.assertNotIn('PRIVATE_TOKEN',json.dumps(proof))

    def test_legacy_older_than_the_window_at_first_query_cannot_prove_a_complete_catalog(self):
        store=FiniteStorage(age=600)
        # Two baseline uploads advance the clock: the first query is at 600.004s.
        proof=run_finite(store)
        self.assertEqual(proof['outcome'],'failed');self.assertEqual(proof['metric_checkpoints'],[])

    def test_full_retained_vector_rejects_private_and_unknown_series_before_pending(self):
        stages={'json':2,'protobuf':0}
        body=json.loads(metric_response(stages)[1]);body['data']['result']+=metric_rows()
        for labels in ({'url.full':'PRIVATE_VALUE'},{'__name__':'inside.email.unknown'},
                       {'__name__':'inside.dependency.unknown'}):
            poisoned=copy.deepcopy(body)
            row=copy.deepcopy(poisoned['data']['result'][0]);row['metric'].update(labels)
            poisoned['data']['result']=poisoned['data']['result'][1:]+[row]
            with self.subTest(labels=labels),self.assertRaises(RuntimeError):
                email_privacy.stored_metric_corpus((200,json.dumps(poisoned)),stages)



if __name__=='__main__':unittest.main()
