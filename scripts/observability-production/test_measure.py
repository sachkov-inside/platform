"""Measured results distinguish unavailable counters from a zero consumption claim."""
import unittest
import json
from pathlib import Path
import tempfile

import measure


class Summaries(unittest.TestCase):
    def test_explicit_fixture_host_opt_in_survives_unprofiled_cleanup(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve() / 'owned'
                measure.prepare(output, host_metrics=enabled)
                host = json.loads((output / 'compose.json').read_text())['services']['host-agent']
                if enabled:
                    self.assertNotIn('profiles', host)
                else:
                    self.assertEqual(host['profiles'], ['host-metrics'])

    def test_missing_samples_and_io_never_become_a_capacity_pass(self):
        with self.assertRaises(ValueError):
            measure.summarize([])
        rows = [
            {'at_seconds': 10, 'services': {'metrics': {'cpu_total_ns': 1_000_000_000,
                'memory_charged_bytes': 1000, 'memory_file_bytes': 400,
                'io_read_operations': None, 'io_write_operations': None}}, 'errors': {}},
            {'at_seconds': 12, 'services': {'metrics': {'cpu_total_ns': 1_500_000_000,
                'memory_charged_bytes': 1200, 'memory_file_bytes': 500,
                'io_read_operations': None, 'io_write_operations': None}}, 'errors': {}}]
        result = measure.summarize(rows)
        self.assertEqual(result['metrics']['cpu_seconds'], .5)
        self.assertEqual(result['metrics']['maximum_observed_charged_bytes'], 1200)
        self.assertEqual(result['metrics']['maximum_observed_file_bytes'], 500)
        self.assertIsNone(result['metrics']['io_read_operations'])
        self.assertIsNone(result['metrics']['io_write_operations'])


if __name__ == '__main__':
    unittest.main()
