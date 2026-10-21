"""Fixed query ownership and decreasing budget, no server or arbitrary query entry point."""
from contextlib import nullcontext
from email.message import Message
import json
import time
import unittest
from unittest.mock import patch
import urllib.parse
import queries
from test_oracle import vectors,raw,EXPECTED,NOW


class Reads(unittest.TestCase):
    def test_protocol_reads_exact_global_seven_family_selector_under_one_deadline_and_evaluation(self):
        rows,stamps=vectors();requests=[];deadlines=[];alarms=[]
        class Response:
            status=200
            def __init__(self,body):
                self.body=body.encode();self.headers=Message();self.headers['Content-Length']=str(len(self.body))
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,cap):
                if cap!=65537:raise AssertionError('wrong cap')
                return self.body
        class Opener:
            def open(self,request,timeout):
                requests.append((request,timeout))
                return Response(raw(stamps if len(requests)==2 else rows))
        def alarm(budget):alarms.append(budget);return nullcontext()
        with patch.object(queries.urllib.request,'build_opener',return_value=Opener()) as factory, \
             patch.object(queries.source_status_query,'_deadline',side_effect=alarm), \
             patch.object(queries.time,'time',return_value=1790000000), \
             patch.object(queries.time,'time_ns',return_value=NOW*1000):
            result=queries.protocol_read('A'*32,deadlines.append,EXPECTED,budget=3)
        self.assertEqual(result['freshness'],'fresh')
        self.assertEqual(alarms,[3]);self.assertEqual(len(set(deadlines)),1)
        self.assertEqual(len(requests),3)
        expressions=[]
        for request,timeout in requests:
            parts=urllib.parse.urlsplit(request.full_url);params=urllib.parse.parse_qs(parts.query)
            self.assertEqual((parts.scheme,parts.netloc,parts.path),('http','127.0.0.1:18427','/metrics/api/v1/query'))
            self.assertEqual({k:v for k,v in params.items() if k!='query'}, {'time':['1790000000'],'timeout':['2s'],'nocache':['1']})
            self.assertEqual(request.get_header('Authorization'),'Bearer '+'A'*32)
            self.assertLessEqual(timeout,3);expressions.append(params['query'][0])
        self.assertEqual(expressions[:2],[queries.SELECTOR,queries.TIMESTAMPS])
        self.assertEqual(expressions[2],'{__name__=~"^(inside\\\\.postgresql\\\\.server\\\\.backends|inside\\\\.postgresql\\\\.server\\\\.waiting_locks|inside\\\\.postgresql\\\\.server\\\\.deadlocks_since_reset|inside\\\\.postgresql\\\\.server\\\\.postmaster_start_time_microseconds|inside\\\\.postgresql\\\\.server\\\\.statistics_reset_time_microseconds|inside\\\\.postgresql\\\\.server\\\\.sample_time_microseconds|inside\\\\.postgresql\\\\.server\\\\.available)$"}')
        handlers=factory.call_args.args
        self.assertEqual(handlers[0].proxies,{})
        self.assertIsInstance(handlers[1],queries.source_status_query.NoRedirect)
        self.assertEqual(len(queries.paths(1790000000)),2)

    def test_absolute_protocol_deadline_is_not_reset_and_expiry_prevents_http(self):
        requests=[];owners=[];now=[100.0];rows,stamps=vectors()
        class Response:
            status=200
            def __init__(self,body):self.body=body.encode();self.headers=Message()
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,cap):return self.body
        class Opener:
            def open(self,request,timeout):
                requests.append(timeout);now[0]+=1
                return Response(raw(stamps if len(requests)==2 else rows))
        def owner(deadline):owners.append(deadline)
        with patch.object(queries.time,'monotonic',side_effect=lambda:now[0]), \
                patch.object(queries.time,'time',return_value=1790000000),patch.object(queries.time,'time_ns',return_value=NOW*1000), \
                patch.object(queries.urllib.request,'build_opener',return_value=Opener()):
            result=queries.protocol_read('A'*32,owner,EXPECTED,deadline=105.0)
            self.assertEqual(result['freshness'],'fresh');self.assertEqual(requests,[5,4,3]);self.assertEqual(set(owners),{105.0})
            for invalid in (True,float('nan'),float('inf'),99,114):
                with self.subTest(deadline=invalid),self.assertRaises((ValueError,TimeoutError)):
                    queries.protocol_read('A'*32,owner,EXPECTED,deadline=invalid)
            self.assertEqual(requests,[5,4,3])
