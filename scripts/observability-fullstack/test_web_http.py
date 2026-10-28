"""Owned Docker transport: stored Web evidence cannot pass after its visibility deadline."""
import json
import unittest
from unittest.mock import patch

import fullstack


class WebHttp(unittest.TestCase):
    def test_initial_series_seed_and_visibility_share_one_sixty_second_budget(self):
        now=[100];calls=[]
        def command(compose,args,*,timeout):
            action=args[5];calls.append((action,timeout))
            if action=='web-http-seed':now[0]=159;return '{"ok":true}'
            self.assertEqual(args[6:],["7"*40])
            now[0]=161;return '{"ok":true}'
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=command),patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot.time,'sleep'):
            with self.assertRaises(RuntimeError):fullstack.initialize_web_http([])
        self.assertEqual(calls,[('web-http-seed',4),('web-http-initial-ready',1)])

    def test_initial_series_rejects_false_malformed_and_late_seed_before_querying(self):
        for encoded in ('{"ok":false}','{"ok":1}','{"ok":true,"private":"sentinel"}','true','[]','broken'):
            with self.subTest(seed=encoded),patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',return_value=encoded) as invoke,self.assertRaises(ValueError):
                fullstack.initialize_web_http([])
            self.assertEqual(invoke.call_count,1)
        now=[100]
        def late(*args,**options):now[0]=160;return '{"ok":true}'
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=late) as invoke,patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),self.assertRaises(TimeoutError):
            fullstack.initialize_web_http([])
        self.assertEqual(invoke.call_count,1)

    def test_initial_series_closed_response_cannot_promote_unknown_values(self):
        def unavailable(read,predicate,**options):
            self.assertFalse(predicate(read()))
            raise RuntimeError('closed initial-series observation unavailable')
        for invalid in ({'ok':1},{'ok':True,'private':'sentinel'},True,[],{'ok':False}):
            with self.subTest(stored=invalid),patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=['{"ok":true}',json.dumps(invalid)]),patch.object(fullstack.pilot,'await_fact',side_effect=unavailable),self.assertRaises(RuntimeError):
                fullstack.initialize_web_http([])
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=['{"ok":true}','broken']),self.assertRaises(ValueError):
            fullstack.initialize_web_http([])

    def test_initial_series_observes_a_real_fact_without_issuing_a_strict_witness(self):
        now=[100];calls=[]
        def command(compose,args,*,timeout):
            action=args[5];calls.append((action,timeout))
            now[0]+=1
            if action=='web-http-seed':return '{"ok":true}'
            return json.dumps({'ok':len(calls)>=3})
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=command),patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot.time,'sleep'):
            value=fullstack.initialize_web_http([])
        self.assertEqual(value,{'state':'observed','source_sha':'7'*40,'initial_series_elapsed_seconds':3})
        self.assertEqual(calls,[('web-http-seed',4),('web-http-initial-ready',4),('web-http-initial-ready',4)])

    def test_late_valid_stored_source_is_rejected_and_each_query_uses_remaining_time(self):
        now=[100];calls=[]
        witness={'ok':True,'positive_count':3,'not_found_count':2,'process_start_seconds':10,'observed_at_seconds':20}
        def command(compose,args,*,timeout):
            action=args[5];calls.append((action,timeout))
            if action=='web-http-witness':
                self.assertEqual(args[-1],'7'*40);return json.dumps(witness)
            self.assertEqual(json.loads(args[-1]),witness)
            if len(calls)==2:now[0]=109;return '{"ok":false}'
            now[0]=111;return '{"ok":true}'
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=command), \
                patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot.time,'sleep'):
            with self.assertRaises(RuntimeError):fullstack.prove_web_http([])
        self.assertEqual(calls[-1][1],1)
        for invalid in ({'ok':True},{**witness,'positive_count':True},{**witness,'not_found_count':1.5},{**witness,'observed_at_seconds':float('inf')},{**witness,'process_start_seconds':21},{**witness,'private':'sentinel'}):
            with self.subTest(value=list(invalid)),patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',return_value=json.dumps(invalid)),self.assertRaises(ValueError):
                fullstack.prove_web_http([])

        def unavailable(read,predicate,**options):
            self.assertFalse(predicate(read()))
            raise RuntimeError('closed stored observation unavailable')
        for invalid in ({'ok':1},{'ok':True,'private':'sentinel'},True,[],{'ok':False}):
            with self.subTest(stored=invalid),patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=[json.dumps(witness),json.dumps(invalid)]),patch.object(fullstack.pilot,'await_fact',side_effect=unavailable),self.assertRaises(RuntimeError):
                fullstack.prove_web_http([])
