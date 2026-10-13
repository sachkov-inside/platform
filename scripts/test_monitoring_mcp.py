"""Strict assertions for the official MCP result envelope and sample contracts."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("smoke", ROOT / "scripts/monitoring-stack-test.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class McpSamplesTest(unittest.TestCase):
    def result(self, series):
        return {"content": [{"type": "text", "text": json.dumps({"data": [series]})}]}

    def test_instant_requires_purchases_value_two(self):
        smoke.require_query_samples(self.result({"metric": {"check": "purchases"}, "value": [2000000002, "2"]}), "instant")
        with self.assertRaises(AssertionError):
            smoke.require_query_samples(self.result({"metric": {"check": "purchases"}, "value": [2000000002, "0"]}), "instant")

    def test_range_requires_nonempty_values_and_correct_label(self):
        smoke.require_query_samples(self.result({"metric": {"check": "purchases"}, "values": [[2000000002, "2"], [2000000062, "2"]]}), "range")
        for series in [{"metric": {"check": "purchases"}, "values": []}, {"metric": {"check": "other"}, "values": [[2000000002, "2"]]}, {"metric": {"check": "purchases"}, "values": [[2000000002, "0"]]}]:
            with self.subTest(series=series), self.assertRaises(AssertionError):
                smoke.require_query_samples(self.result(series), "range")


if __name__ == "__main__":
    unittest.main()
