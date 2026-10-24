"""A current foundation cache is reproducible and source-bound on either architecture."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import foundation
import recovery


class Foundation(unittest.TestCase):
    def test_current_build_records_exact_image_context_and_version_then_detects_drift(self):
        calls=[]
        def execute(args):
            calls.append(args)
            if args[:3]==['git','rev-parse','HEAD']:return 'a'*40
            if args[:3]==['git','status','--porcelain']:return ''
            if args[:2]==['docker','image']:return json.dumps({'id':'sha256:'+'b'*64,'architecture':'amd64','os':'linux','source':'a'*40})
            if args[:2]==['docker','build']:return ''
            self.fail('unexpected transport')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'cache.json'
            result=foundation.build(path,execute=execute)
            self.assertEqual(result['architecture'],'amd64')
            self.assertEqual(result['pgbackrest_version'],'2.59.3')
            self.assertIn('infra/production/database/libpq-version.c',result['inputs'])
            self.assertEqual(recovery.validate_cache(result),result)
            self.assertEqual(json.loads(path.read_text()),result)
            changed=copy.deepcopy(result);changed['inputs']['infra/production/database/libpq-version.c']='0'*64
            with self.assertRaises(ValueError):recovery.validate_cache(changed)
            self.assertTrue(any(args[:2]==['docker','build'] for args in calls))

    def test_dirty_foundation_and_wrong_built_source_fail_before_receipt(self):
        for dirty in (True,False):
            def execute(args):
                if args[:3]==['git','rev-parse','HEAD']:return 'a'*40
                if args[:3]==['git','status','--porcelain']:return ' M Dockerfile' if dirty else ''
                if args[:2]==['docker','build']:return ''
                return json.dumps({'id':'sha256:'+'b'*64,'architecture':'arm64','os':'linux','source':'c'*40})
            with self.subTest(dirty=dirty),tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'cache.json'
                with self.assertRaises(ValueError):foundation.build(path,execute=execute)
                self.assertFalse(path.exists())
