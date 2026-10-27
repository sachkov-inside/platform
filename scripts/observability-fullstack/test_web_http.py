"""Owned Docker transport: stored Web evidence cannot pass after its visibility deadline."""
import unittest
from unittest.mock import patch

import fullstack


class WebHttp(unittest.TestCase):
    def test_late_valid_stored_source_is_rejected_and_each_query_uses_remaining_time(self):
        now=[100];calls=[]
        def command(compose,args,*,timeout):
            calls.append((args[-1],timeout))
            if args[-1]=='web-http-witness':return '{"ok":true}'
            if len(calls)==2:now[0]=109;return '{"ok":false}'
            now[0]=111;return '{"ok":true}'
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=command), \
                patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot.time,'sleep'):
            with self.assertRaises(RuntimeError):fullstack.prove_web_http([])
        self.assertEqual(calls[-1][1],1)
