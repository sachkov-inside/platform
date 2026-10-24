"""Synthetic transport cannot smuggle raw browser URLs through its native proof."""
import copy
import unittest
from unittest.mock import patch
import browser_ingest

class BrowserIngest(unittest.TestCase):
    def test_native_transport_sends_only_the_closed_synthetic_payload(self):
        value={'type':'event','payload':{'website':'00000000-0000-4000-8000-000000000001','hostname':'127.0.0.1','ip':'unidentified','userAgent':'synthetic',
            'url':'/products/'+'10000000-0000-4000-8000-000000000001'+'?utm_source=telegram&utm_medium=direct',
            'data':{'observation':'browser','event':'product_view','campaign':'telegram','referrer':'direct'}}}
        with patch.object(browser_ingest.fixture,'call',return_value={'cache':'never forwarded'}) as call:
            self.assertEqual(browser_ingest.forward(value),{'accepted':True});call.assert_called_once()
        for change in ({'url':'/products/private?email=sentinel'},{'id':'unexpected'},{'hostname':'foreign.invalid'}):
            bad=copy.deepcopy(value);bad['payload'].update(change)
            with patch.object(browser_ingest.fixture,'call') as call,self.assertRaises(ValueError):browser_ingest.forward(bad)
            call.assert_not_called()
