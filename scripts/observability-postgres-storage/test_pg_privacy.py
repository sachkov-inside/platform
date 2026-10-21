"""Prepared protocol driver cannot mistake fresh source rows for insertion completion."""
import copy
import unittest
import time
from unittest.mock import patch
import privacy
from test_oracle import EXPECTED


class Privacy(unittest.TestCase):
    def test_current_ingest_failure_cannot_be_replaced_by_fresh_stored_positives(self):
        calls=[]
        class Ledger:
            def accept(self,value):raise AssertionError('unproved frame accepted')
        class Source:
            ledger=Ledger();token='A'*32;end=time.monotonic()+150
            def acquire(self):calls.append('acquire');return EXPECTED.copy()
            def before_unsafe_upload(self):calls.append('logging')
            def upload(self,value):raise AssertionError('legacy upload cannot supply completion')
            def stored(self,value):return {'freshness':'fresh'}
            def verify_storage(self,deadline):pass
        with patch.object(privacy.completion,'_ingest',side_effect=ValueError('storage')), \
                patch.object(privacy.completion,'_flush') as flush, \
                patch.object(privacy.completion.queries,'protocol_read') as read, self.assertRaisesRegex(ValueError,'^storage$'):
            privacy.run(Source())
        flush.assert_not_called();read.assert_not_called();self.assertEqual(calls,['acquire','logging'])

    def test_only_fixed_challenges_exist_and_original_frame_is_not_mutated(self):
        original=copy.deepcopy(EXPECTED)
        for kind in ('backend','telegram','foreign','missing','unknown_family','sentinel'):
            payload=privacy.challenge(EXPECTED,kind)
            self.assertEqual(len(payload['resourceMetrics']),2)
        self.assertEqual(EXPECTED,original)
        with self.assertRaises(ValueError):privacy.challenge(EXPECTED,'arbitrary service')
