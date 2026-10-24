"""Fixed proposed manifest rejects implicit workload and arbitrary routes."""
import copy
import unittest
import profile as resource_profile


class Manifest(unittest.TestCase):
    def test_fixed_manifest_and_closed_proposed_scope(self):
        value = resource_profile.load()
        self.assertEqual(value['comparison'], 'sdk-only-collector-present-both')
        self.assertEqual(sum(len(pair) for pair in value['pairs']) * value['measurement_seconds'] * value['requests_per_second'], 400)
        for key, replacement in [('warmup_seconds', 600), ('sample_ratio', True), ('pairs', [['on']]), ('account_count', 2), ('new', 1)]:
            invalid = copy.deepcopy(value)
            invalid[key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                resource_profile.validate(invalid)
        invalid = copy.deepcopy(value)
        invalid['operations'][0]['path'] = 'http://foreign.invalid/'
        with self.assertRaises(ValueError):
            resource_profile.validate(invalid)
