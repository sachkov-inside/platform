"""Current-frame query timing against a stored older cohort, without Docker."""
from contextlib import nullcontext
from email.message import Message
import copy
import unittest
from unittest.mock import patch
import urllib.parse
import oracle
import queries
import scenario
from test_oracle import NOW, EXPECTED, vectors, raw


class CurrentQueryTime(unittest.TestCase):
    def test_subsecond_upload_is_not_hidden_behind_a_stale_previous_baseline(self):
        # Two already-stored complete cohorts. The current upload happened at .250;
        # a query at floor(now=.500) is a historical read and must still select the old one.
        clock = [1790000000.5]
        current = {**EXPECTED, 'sample_us': NOW + 250_000, 'postmaster_us': NOW - 30_000_000, 'stats_reset_us': NOW - 40_000_000}
        old_rows, old_stamps = vectors()
        for row in old_rows:
            if row['metric']['__name__'].endswith('sample_time_microseconds'):
                row['value'][1] = str(NOW - 12_000_000)
        for row in old_stamps:
            row['value'][1] = '1789999988'
        new_rows, new_stamps = vectors()
        for row in new_rows:
            if row['metric']['__name__'].endswith('sample_time_microseconds'):
                row['value'][1] = str(current['sample_us'])
        for row in new_stamps:
            row['value'][1] = '1790000000.25'
        for rows in (old_rows,new_rows):
            for row in rows:
                if row['metric']['__name__'].endswith('postmaster_start_time_microseconds'):row['value'][1]=str(current['postmaster_us'])
                if row['metric']['__name__'].endswith('statistics_reset_time_microseconds'):row['value'][1]=str(current['stats_reset_us'])
        captured=[]
        class Response:
            status=200
            headers=Message()
            def __init__(self, body): self.body=body.encode()
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,cap):return self.body
        class Endpoint:
            def open(self, request, timeout):
                params=urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
                evaluated=int(params['time'][0]);captured.append(evaluated)
                rows,stamps=(old_rows,old_stamps) if evaluated<1790000000.25 else (new_rows,new_stamps)
                selected=copy.deepcopy(stamps if 'source_metric' in params['query'][0] else rows)
                for row in selected:row['value'][0]=evaluated
                return Response(raw(selected))
        driver=scenario.Scenario(None, [], 'A'*32, oracle);driver.end=200
        driver.verify_storage=lambda deadline:None
        def sleep(seconds):
            self.assertGreater(seconds,0);self.assertLessEqual(seconds,1)
            clock[0]+=seconds
        with patch.object(queries.time,'time',side_effect=lambda:clock[0]), \
                patch.object(queries.time,'time_ns',side_effect=lambda:int(clock[0]*1_000_000)*1000), \
                patch.object(queries.time,'monotonic',return_value=100), \
                patch.object(queries.time,'sleep',side_effect=sleep), \
                patch.object(queries.source_status_query,'_deadline',return_value=nullcontext()), \
                patch.object(queries.urllib.request,'build_opener',return_value=Endpoint()):
            try:observed=driver.stored(current,_baseline='second')
            except ValueError:
                self.assertEqual(driver.phase,'baseline_second_stored_oracle')
                self.assertEqual(driver.oracle_failure_reason,'oracle_stale_healthy_sample_different')
                raise
        self.assertEqual(observed['freshness'],'fresh')
        self.assertLessEqual(observed['age_seconds'],10)
        self.assertEqual(captured,[1790000001,1790000001])

    def test_alignment_cannot_borrow_query_budget_or_evaluate_a_future_clock(self):
        for budget, wall, expected in ((.2,1790000000.5,TimeoutError),
                                       (1,1790000000.5,ValueError)):
            calls=[]
            with self.subTest(budget=budget), \
                    patch.object(queries.time,'time',return_value=wall), \
                    patch.object(queries.time,'monotonic',return_value=100), \
                    patch.object(queries.time,'sleep') as sleep, \
                    patch.object(queries.source_status_query,'_deadline',return_value=nullcontext()), \
                    patch.object(queries.urllib.request,'build_opener') as transport:
                with self.assertRaises(expected):queries.read('A'*32,calls.append,budget=budget)
                transport.return_value.open.assert_not_called()
                self.assertEqual(calls,[])
                self.assertEqual(sleep.call_count,0 if budget==.2 else 1)
