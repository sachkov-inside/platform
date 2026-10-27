"""Volume observations count real metadata, do not read contents or follow a foreign symlink."""
import os
from pathlib import Path
import tempfile
import unittest
import storage


class Metadata(unittest.TestCase):
    def test_real_file_inode_usage_deduplicates_links_and_never_traverses_foreign_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);root=base/'owned';root.mkdir();foreign=base/'foreign';foreign.mkdir()
            (foreign/'secret').write_bytes(b'x'*10000)
            (root/'file').write_bytes(b'0123456789abcdefg');os.link(root/'file',root/'hardlink')
            (root/'link').symlink_to(foreign,target_is_directory=True);(root/'child').mkdir()
            value=storage.measure(root)
            self.assertEqual(value['logical_file_bytes'],17)
            self.assertEqual(value['entries'],5)
            self.assertEqual(value['unique_inodes'],4)
            self.assertEqual(value['symlinks'],1)
            self.assertGreaterEqual(value['allocated_bytes'],0)
            self.assertGreater(value['filesystem_inodes_available'],0)
            with self.assertRaises(ValueError):storage.measure(root,limit=3)
            with self.assertRaises(ValueError):storage.measure(root/'link')

    def test_only_all_fixed_volume_and_database_numeric_counters_are_publishable(self):
        import json
        row={key:1 for key in storage.FIELDS}
        volumes={name:dict(row) for name in storage.VOLUMES}
        self.assertEqual(storage.validate_volumes(volumes),volumes)
        databases={name:8192 for name in storage.DATABASES}
        observed=storage.observe([],lambda *args,**kwargs:json.dumps(volumes),lambda *args,**kwargs:json.dumps(databases))
        self.assertEqual(observed['database_bytes'],databases)
        for invalid in ({'unexpected':row},{**volumes,'metrics':{**row,'file_names':['secret']}},{**volumes,'metrics':{**row,'allocated_bytes':True}}):
            with self.assertRaises(ValueError):storage.validate_volumes(invalid)
        with self.assertRaises(ValueError):storage.observe([],lambda *args,**kwargs:json.dumps(volumes),lambda *args,**kwargs:'{"inside":8192}')
