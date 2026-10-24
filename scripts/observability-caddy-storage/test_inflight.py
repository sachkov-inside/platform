"""A self-observing query cannot substitute for the independent held-body raw witness."""
import json
import unittest
import inflight
from test_native_source import wire
from test_observation import acquisition


class HeldWitness(unittest.TestCase):
    def test_self_query_gauge_without_prior_raw_witness_is_refused(self):
        held=wire();baseline=held.replace(b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 1',
                                         b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 0')
        values,stamps=acquisition()
        acquired={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),'evaluated_at':100,'completed_at':101}
        arguments={'baseline':baseline,'raw_held':held,'canonical':acquired,'mcp':acquired,'r_received':98,'f_sent':102}
        self.assertTrue(inflight.validate(**arguments))
        with self.assertRaises(ValueError):inflight.validate(**{**arguments,'raw_held':baseline})
        with self.assertRaises(ValueError):inflight.validate(**{**arguments,'r_received':99})
        with self.assertRaises(ValueError):inflight.validate(**{**arguments,'f_sent':100.5})
