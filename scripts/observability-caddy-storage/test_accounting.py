"""Only wholly separated observed request windows explain a source-sample interval."""
import json
import unittest
import accounting
from test_observation import acquisition


def snapshot(values,stamps,point,completed):
    return {'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),'evaluated_at':point,'completed_at':completed}


class PartitionAccounting(unittest.TestCase):
    def test_read_queries_are_counted_and_a_scrape_inside_a_request_window_is_ambiguous(self):
        old,old_stamps=acquisition(point=95,stamp=94)
        current,stamps=acquisition()
        for row in current['data']['result']:
            if row['metric']['__name__'] not in ('up','caddy_http_requests_in_flight'):
                row['value'][1]=str(float(row['value'][1])*2)
        previous=snapshot(old,old_stamps,95,95.5);now=snapshot(current,stamps,100,101)
        journal=accounting.Traffic()
        journal.record(96,97,'GET',200,count=2)  # Both successful canonical read HTTP requests.
        self.assertTrue(journal.boundary_clear(95))
        self.assertFalse(journal.boundary_clear(96.5))
        with self.assertRaises(ValueError):journal.verify(previous,now)
        journal.record(98,98.5,'GET',502)
        self.assertTrue(journal.verify(previous,now))
        ambiguous=accounting.Traffic();ambiguous.record(98,100,'GET',200,count=2)
        self.assertIsNone(ambiguous.verify(previous,now))
