"""Browser proof borrows its registered project's lifecycle and never publishes private input."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import runtime

class BrowserProof(unittest.TestCase):
    def test_disabled_proof_acquires_nothing_and_enabled_proof_removes_private_input(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);compose=['docker','compose','-p',runtime.PROJECT_PREFIX+'a'*12,'-f',str(output/'compose.json')]
            state={'site':'00000000-0000-4000-8000-000000000001','key':'secret-reader-key','team':'00000000-0000-4000-8000-000000000002'}
            with patch.dict(os.environ,{},clear=True),patch.object(runtime,'invoke') as invoke:
                runtime.browser_proof(output,compose,state);invoke.assert_not_called()
            def execute(args,**options):
                source=Path(options['env']['INSIDE_UMAMI_BROWSER_PROOF_INPUT'])
                self.assertEqual(source.stat().st_mode&0o777,0o600)
                self.assertEqual(json.loads(source.read_text())['key'],state['key'])
                Path(options['env']['INSIDE_UMAMI_BROWSER_PROOF_PROGRESS']).write_text('{"phase":"revocation_verified"}')
                return SimpleNamespace(returncode=0,stdout='passed',stderr='')
            with patch.dict(os.environ,{'INSIDE_UMAMI_BROWSER_PROOF':'true'},clear=True),patch.object(runtime,'invoke'), \
                    patch.object(runtime.pilot,'FROZEN_DOCKER_IDENTITY',{'endpoint':'unix:///owned.sock'}),patch.object(runtime.subprocess,'run',side_effect=execute):
                runtime.browser_proof(output,compose,state)
            self.assertFalse((output/'browser-proof.private.json').exists())
            self.assertEqual((output/'browser-proof.private.log').stat().st_mode&0o777,0o600)
            result=(output/'browser-analytics-proof.json').read_text();self.assertNotIn(state['key'],result)
            self.assertEqual(json.loads(result)['state'],'passed')
            self.assertEqual(json.loads(result)['last_completed'],'revocation_verified')

    def test_failure_cannot_publish_success_or_leave_the_private_input(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);compose=['docker','compose','-p',runtime.PROJECT_PREFIX+'b'*12,'-f',str(output/'compose.json')]
            state={'site':'00000000-0000-4000-8000-000000000001','key':'secret','team':'00000000-0000-4000-8000-000000000002'}
            with patch.dict(os.environ,{'INSIDE_UMAMI_BROWSER_PROOF':'true'},clear=True),patch.object(runtime,'invoke'), \
                    patch.object(runtime.pilot,'FROZEN_DOCKER_IDENTITY',{'endpoint':'unix:///owned.sock'}), \
                    patch.object(runtime.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='private failure',stderr='')):
                with self.assertRaisesRegex(RuntimeError,'browser_native_proof_failed'):runtime.browser_proof(output,compose,state)
            self.assertFalse((output/'browser-proof.private.json').exists())
            self.assertEqual(json.loads((output/'browser-analytics-proof.json').read_text())['state'],'failed')

    def test_successful_process_without_completed_corpus_is_not_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);compose=['docker','compose','-p',runtime.PROJECT_PREFIX+'c'*12,'-f',str(output/'compose.json')]
            state={'key':'private-sentinel','team':'00000000-0000-4000-8000-000000000002'}
            with patch.dict(os.environ,{'INSIDE_UMAMI_BROWSER_PROOF':'true'},clear=True),patch.object(runtime,'invoke'), \
                    patch.object(runtime.pilot,'FROZEN_DOCKER_IDENTITY',{'endpoint':'unix:///owned.sock'}), \
                    patch.object(runtime.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='',stderr='')):
                with self.assertRaisesRegex(RuntimeError,'browser_native_proof_failed'):runtime.browser_proof(output,compose,state)
            proof=json.loads((output/'browser-analytics-proof.json').read_text())
            self.assertEqual((proof['state'],proof['last_completed']),('failed','not_started'))
            self.assertNotIn('private-sentinel',json.dumps(proof))
