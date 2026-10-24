"""Closed counter boundary: no Docker or external provider."""
import math
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).parent))
import measurements


class Counters(unittest.TestCase):
    def test_raw_memory_keeps_charge_cache_and_working_set_distinct(self):
        value = measurements.engine({'memory_stats': {'usage': 1000, 'limit': 2000, 'stats': {'file': 400, 'inactive_file': 300}}, 'cpu_stats': {'cpu_usage': {'total_usage': 800}, 'online_cpus': 4}})
        self.assertEqual(value['memory_charged_bytes'], 1000)
        self.assertEqual(value['memory_file_bytes'], 400)
        self.assertEqual(value['memory_working_set_bytes'], 700)
        self.assertEqual(value['cpu_total_ns'], 800)
        self.assertIsNone(value['io_read_operations'])

    def test_missing_nonfinite_boolean_negative_counters_remain_unknown(self):
        for value in (None, True, -1, math.nan, math.inf, '0'):
            with self.subTest(value=value):
                result = measurements.engine({'memory_stats': {'usage': value}, 'cpu_stats': {'cpu_usage': {'total_usage': value}}})
                self.assertIsNone(result['memory_charged_bytes'])
                self.assertIsNone(result['cpu_total_ns'])
        self.assertIsNone(measurements.engine({})['cpu_online_count'])

    def test_operation_counts_are_not_bytes_empty_is_unknown(self):
        self.assertEqual(measurements.io_stat('8:0 rbytes=999 wbytes=888 rios=3 wios=4\n8:16 rbytes=1 wbytes=2 rios=5 wios=6'), (8, 10))
        for value in ('', '8:0 rbytes=42 wbytes=12', '8:0 rios=-1 wios=2', 'bad', '8:0 rios=1 rios=2 wios=3'):
            with self.subTest(value=value):
                self.assertEqual(measurements.io_stat(value), (None, None))

    def test_reset_replacement_missing_and_clock_regression_are_unknown(self):
        first = {'container': 'a', 'at_seconds': 1, 'cpu_total_ns': 100, 'io_read_operations': 2}
        self.assertEqual(measurements.delta(first, {**first, 'at_seconds': 3, 'cpu_total_ns': 110}, 'cpu_total_ns'), 10)
        for later in ({**first, 'container': 'b'}, {**first, 'cpu_total_ns': 99, 'at_seconds': 2}, {**first, 'cpu_total_ns': None, 'at_seconds': 2}, {**first, 'at_seconds': 0}):
            self.assertIsNone(measurements.delta(first, later, 'cpu_total_ns'))

    def test_nearest_rank_uses_actual_samples_including_terminal_failures(self):
        self.assertEqual(measurements.percentile(list(range(1, 21)), .95), 19)
        self.assertIsNone(measurements.percentile([], .95))
        self.assertIsNone(measurements.percentile([1, math.nan], .95))

    def test_percentile_overhead_requires_matching_complete_pair(self):
        sample = {'label': 'public_index', 'outcome': 'ok', 'elapsed_ms': 10}
        off = [sample] * 20
        on = [{**sample, 'elapsed_ms': 11}] * 20
        self.assertAlmostEqual(measurements.overhead(off, on, 'public_index'), 10)
        self.assertIsNone(measurements.overhead(off, [{**sample, 'outcome': 'timeout'}], 'public_index'))
        self.assertIsNone(measurements.overhead(off, on[:-1], 'public_index'))

    def test_device_replacement_or_individual_reset_cannot_hide_in_totals(self):
        first = measurements.io_devices('8:0 rios=10 wios=10\n8:1 rios=2 wios=2')
        later = measurements.io_devices('8:0 rios=1 wios=1\n8:1 rios=100 wios=100')
        self.assertEqual(measurements.io_delta(first,later),(None,None))
        self.assertEqual(measurements.io_delta(first,measurements.io_devices('8:2 rios=20 wios=20')),(None,None))
        self.assertEqual(measurements.io_delta(first,measurements.io_devices('8:0 rios=12 wios=13\n8:1 rios=2 wios=2')),(2,3))
