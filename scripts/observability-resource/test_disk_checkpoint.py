"""Versioned same-read build checkpoint; no native allocation attribution."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import hosted
import disk_feedback as numeric
from disk_samples import DiskSamples


class BuildCheckpoint(unittest.TestCase):
    def observed(self):
        view=DiskSamples();view._baseline(20*1024**3)
        record=numeric.Record('a'*40);record.entered(view)
        view._safe(view._point(19*1024**3));record.after_backend_build()
        view._safe(view._point(18*1024**3));record.first_pull()
        view._seal();record.seal();return record.value

    def test_new_producer_keeps_distinct_stale_after_backend_and_before_pull_points(self):
        value=self.observed()
        self.assertEqual(value['schema'],2);self.assertEqual(len(value),10)
        self.assertEqual(value['after_backend_build'],{'state':'safe','sample':{'id':1,'free_bytes':19*1024**3}})
        self.assertEqual(value['last_observed_before_first_pull'],{'state':'safe','sample':{'id':2,'free_bytes':18*1024**3}})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/numeric.NAME;numeric.write(path,value,'a'*40)
            self.assertEqual(numeric.read(path,'a'*40),value)

    def test_legacy_is_not_upgraded_and_invalid_cross_checkpoint_order_refuses(self):
        value=self.observed();legacy=copy.deepcopy(value);legacy['schema']=1;legacy.pop('after_backend_build')
        numeric.validate(legacy,'a'*40)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/numeric.NAME
            self.assertEqual(numeric.read(path,'a'*40)['schema'],1)
            numeric.write(path,legacy,'a'*40)
            self.assertEqual(json.loads(path.read_text()),legacy)
        for mutation in ('missing','wrong_version','later','not_reached'):
            bad=copy.deepcopy(value)
            if mutation=='missing':bad.pop('after_backend_build')
            elif mutation=='wrong_version':bad['schema']=1
            elif mutation=='later':bad['after_backend_build']['sample']['id']=3
            else:bad['after_backend_build']={'state':'not_reached','sample':None}
            with self.subTest(case=mutation),self.assertRaises(ValueError):numeric.validate(bad,'a'*40)

    def test_secondary_persistence_rethrowing_same_primary_restores_exact_traceback(self):
        record=numeric.Record('a'*40);error=OSError('owned primary')
        with tempfile.TemporaryDirectory() as directory:
            try:raise error
            except OSError:
                original=sys.exc_info()[2]
                with patch.object(numeric,'write',side_effect=error):record.persist(Path(directory)/numeric.NAME)
                self.assertIs(BaseException.__traceback__.__get__(error),original)

    def test_failed_commit_does_not_unlink_foreign_replacement_of_created_inode(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/numeric.NAME;temporary=root/'.resource-disk-samples.new'
            held=[];error=OSError('owned commit failure')
            def refuse(source,destination):
                held.append(os.open(source,os.O_RDONLY))
                source.unlink();source.write_text('foreign writer')
                raise error
            try:
                with patch.object(numeric.os,'replace',side_effect=refuse):
                    with self.assertRaises(OSError) as caught:numeric.write(path,self.observed(),'a'*40)
                self.assertIs(caught.exception,error)
                self.assertEqual(temporary.read_text(),'foreign writer')
            finally:
                for descriptor in held:os.close(descriptor)

    def test_same_and_different_secondary_preserve_every_primary_kind(self):
        import subprocess
        for kind in (OSError,ValueError,RuntimeError,KeyboardInterrupt,SystemExit,subprocess.TimeoutExpired):
            for same in (False,True):
                with self.subTest(kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                    record=numeric.Record('a'*40)
                    error=kind('owned',1) if kind is subprocess.TimeoutExpired else kind('owned')
                    secondary=error if same else OSError('secondary')
                    try:raise error
                    except BaseException:
                        tb=sys.exc_info()[2]
                        try:
                            with patch.object(numeric,'write',side_effect=secondary):record.persist(Path(directory)/numeric.NAME)
                        except BaseException:self.fail('secondary escaped pending primary')
                        self.assertIs(BaseException.__traceback__.__get__(error),tb)
