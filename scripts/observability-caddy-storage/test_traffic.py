"""Actual finite HTTP request/response path; this fixture is not native Caddy evidence."""
import http.client
import unittest
import traffic
from test_request_hold import peer


class FixedTraffic(unittest.TestCase):
    def test_controlled_recovery_retains_each_actual_502_for_partition_accounting(self):
        with peer(status=502) as (port,_,_):
            result=traffic.perform('recovery','owned_token',_connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3))
            self.assertEqual((result['method'],result['code']),('GET',502))

    def test_fixed_post_records_only_a_validated_successful_whole_response(self):
        for status in (200,500):
            with self.subTest(status=status),peer(status=status) as (port,_,completed):
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
                if status==200:
                    result=traffic.perform('http_post','owned_token',_connection=connection)
                    self.assertEqual((result['method'],result['code']),('POST',200))
                    self.assertTrue(completed.is_set())
                else:
                    with self.assertRaises(ValueError):traffic.perform('http_post','owned_token',_connection=connection)
