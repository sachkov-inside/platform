"""Telegram acceptance requires processed durable rows, not HTTP acknowledgement alone."""
import json
import unittest
import telegram


class Telegram(unittest.TestCase):
    def test_pending_or_failed_native_rows_cannot_pass_processed_workload(self):
        for row in ({'accepted':5,'processed':0,'failed':0,'planned':5,'delivered':0},{'accepted':5,'processed':4,'failed':1,'planned':5,'delivered':4},{'accepted':4,'processed':4,'failed':0,'planned':4,'delivered':4}):
            self.assertIsNone(telegram.processed([],lambda *args,**kw:json.dumps(row),2000000,2001000,5))
        expected={'accepted':5,'processed':5,'failed':0,'planned':5,'delivered':5}
        self.assertEqual(telegram.processed([],lambda *args,**kw:json.dumps(expected),2000000,2001000,5),expected)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{"accepted":true,"processed":1,"failed":0}',2000000,2001000,1)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{}','unsafe',2001000,1)
