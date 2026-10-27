"""Owned Docker transport: stored Web evidence cannot pass after its visibility deadline."""
import json
import unittest
from unittest.mock import patch

import fullstack


class WebHttp(unittest.TestCase):
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
