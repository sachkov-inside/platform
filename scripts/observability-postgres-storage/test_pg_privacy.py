"""Prepared protocol driver cannot mistake fresh source rows for insertion completion."""
import copy
import unittest
from unittest.mock import patch
import privacy
from test_oracle import EXPECTED


class Privacy(unittest.TestCase):
    def test_source_prepared_protocol_never_passes_without_pinned_end_to_end_boundary_proof(self):
        class Ledger:
            def accept(self,value):pass
        class Source:
            ledger=Ledger();token='fixed';cases=[]
            def __init__(self):self.uploads=[]
            def acquire(self):return EXPECTED.copy()
            def upload(self,value):self.uploads.append(value)
            def stored(self,value):return {'freshness':'fresh'}
            def verify_storage(self,deadline):pass
            def remaining(self,cap=10):return cap
        source=Source()
        with patch.object(privacy.queries,'protocol_read',return_value={'freshness':'fresh'}) as read, self.assertRaisesRegex(ValueError,'^storage$'):
            privacy.run(source)
        self.assertEqual(read.call_count,4)
        self.assertEqual(len(source.uploads),6)
        self.assertEqual(source.cases,[])

    def test_only_fixed_challenges_exist_and_original_frame_is_not_mutated(self):
        original=copy.deepcopy(EXPECTED)
        for kind in ('backend','telegram','foreign','missing','unknown_family','sentinel'):
            payload=privacy.challenge(EXPECTED,kind)
            self.assertEqual(len(payload['resourceMetrics']),2)
        self.assertEqual(EXPECTED,original)
        with self.assertRaises(ValueError):privacy.challenge(EXPECTED,'arbitrary service')
