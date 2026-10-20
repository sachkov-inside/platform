"""A primary pinned-adaptation witness fixes the one complete accounting partition."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
import partition
import overlay


class PinnedPartition(unittest.TestCase):
    def test_exact_primary_partition_excludes_nested_and_scrape_routes_and_refuses_overlap(self):
        fixture=json.loads((Path(__file__).with_name('fixtures')/'adaptation.json').read_text())
        self.assertEqual(hashlib.sha256(overlay.caddy_config().encode()).hexdigest(),fixture['synthetic_config_sha256'])
        self.assertEqual(partition.validate_summary(fixture['servers']),{'partition':'srv0/subroute','scrape_server':'srv1','admin':'off'})
        for change in ('overlap','nested','catchall','server'):
            bad=copy.deepcopy(fixture['servers'])
            if change=='overlap':bad['srv0']['routes'][1]['group']='another_group'
            if change=='nested':bad['srv0']['routes'][1]['handlers']=['subroute']
            if change=='catchall':bad['srv0']['routes'][2]['match']=[{'path':['/only-this']}]
            if change=='server':bad['srv0']['listen']=[':8080',':9091']
            with self.subTest(change=change),self.assertRaisesRegex(ValueError,'^closed Caddy adaptation refused$'):partition.validate_summary(bad)
