"""The bounded partition retains the independent original 88-method inventory."""
import hashlib
import json
from pathlib import Path
import unittest
import source_groups


class SourceGroups(unittest.TestCase):
    def test_complete_discovery_and_each_group_refuse_missing_duplicate_and_foreign_methods(self):
        suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
        baseline=[value for value in source_groups.SOURCE_IDS if not value.startswith('test_source_groups.')]
        self.assertEqual(len(baseline),88)
        self.assertEqual(hashlib.sha256(json.dumps(baseline).encode()).hexdigest(),'08edb78504e90e72768f0b5399061dbca6ec08b065576a429995d47f17f87b41')
        groups=source_groups.SOURCE_GROUPS
        self.assertEqual(tuple(groups),('contracts','process-owner'))
        self.assertEqual(tuple(map(len,groups.values())),(84,5))
        combined=tuple(value for group in groups.values() for value in group)
        self.assertEqual(len(set(combined)),89)
        self.assertEqual(tuple(sorted(combined)),source_groups.SOURCE_IDS)
        for group,expected in groups.items():
            selected=source_groups.select_group(suite,group)
            self.assertEqual(tuple(test.id() for test in selected),expected)
        for group in ('foreign','__proto__',None,[],1):
            with self.assertRaisesRegex(ValueError,'^closed tracking source inventory refused$'):
                source_groups.select_group(suite,group)
        actual=tuple(source_groups.tests(suite))
        class Foreign(unittest.TestCase):
            def runTest(self):pass
            def id(self):return 'private-controlled-id'
        for cases in (actual[:-1],(*actual,actual[-1]),(*actual[:-1],Foreign()),tuple(reversed(actual))):
            for group in groups:
                with self.assertRaisesRegex(ValueError,'^closed tracking source inventory refused$'):
                    source_groups.select_group(unittest.TestSuite(cases),group)
