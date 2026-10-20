"""The fixed HTTP owner validates complete responses and never infers down from outage."""
from email.message import Message
import io
import json
import unittest
from unittest.mock import patch
import caddy_query
from test_observation import acquisition


class Response(io.BytesIO):
    status=200
    def __init__(self,body):
        super().__init__(body);self.headers=Message();self.headers['Content-Length']=str(len(body))


class FixedRead(unittest.TestCase):
    def test_whole_http_read_uses_both_fixed_vectors_and_wrapped_timeout_never_means_down(self):
        import http.client
        values,stamps=acquisition()
        responses=[Response(json.dumps(body).encode()) for body in (values,stamps)]
        with patch('urllib.request.OpenerDirector.open',side_effect=responses) as opened:
            result=caddy_query.query('owned_token',evaluated_at=100,wall_clock=lambda:101)
        self.assertEqual(result['state'],'observed')
        self.assertEqual(result['transport']['canonical'],'passed')
        for call in opened.call_args_list:
            request=call.args[0]
            self.assertTrue(request.full_url.startswith('http://127.0.0.1:18427/metrics/api/v1/query?'))
            self.assertEqual(request.get_header('Authorization'),'Bearer owned_token')
        with patch.object(http.client.HTTPConnection,'connect',side_effect=TimeoutError('private-caddy-sentinel')):
            outage=caddy_query.query('owned_token',evaluated_at=100,wall_clock=lambda:101)
        self.assertEqual((outage['state'],outage['reason']),('query_unavailable','timeout'))
        self.assertIsNone(outage['observation'])
        self.assertNotIn('private',json.dumps(outage))
