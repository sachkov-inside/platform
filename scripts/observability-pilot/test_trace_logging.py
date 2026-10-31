"""The unsafe OTLP boundary requires actual owned VT logging suppression, not a Compose claim."""
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pilot


PROJECT = 'inside-observability-pilot-123456abcdef'
COMPOSE = ['docker','compose','-p',PROJECT,'-f','/owned/compose.json']
FROZEN = {'platform':'linux', 'endpoint':'unix:///owned/docker.sock',
          'socket_device':1, 'socket_inode':2, 'daemon_id':'owned', 'storage':'/owned/storage'}


class TraceLoggingBoundary(unittest.TestCase):
    def inspect_double(self, *, driver='none', project=PROJECT, service='traces', running=True,
                       container='c'*64):
        def command(args, *, timeout):
            self.assertGreater(timeout,0)
            self.assertLessEqual(timeout,pilot.QUERY_TIMEOUT_SECONDS)
            if args == COMPOSE+['ps','-q','traces']:
                return container
            self.assertEqual(args[:3], ['docker','inspect','--format'])
            self.assertEqual(args[-1],'c'*64)
            # Docker's actual Go template evaluates these equalities and emits only fixed enums.
            self.assertIn('com.docker.compose.project',args[3])
            self.assertIn('"'+PROJECT+'"',args[3])
            self.assertIn('com.docker.compose.service',args[3])
            self.assertIn('"traces"',args[3])
            self.assertIn('.State.Running',args[3])
            self.assertIn('eq .HostConfig.LogConfig.Type "none"',args[3])
            owner = 'owned' if project == PROJECT and service == 'traces' and running else 'unowned'
            return owner+'|'+('none' if driver == 'none' else 'unverified')+'\n'
        return command

    def test_owned_running_container_with_actual_none_driver_produces_closed_proof(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
             patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
             patch('pilot.daemon.identify',return_value=FROZEN) as identity, \
             patch('pilot.command',side_effect=self.inspect_double()):
            pilot.verify_trace_store_logging(Path(directory),COMPOSE)
            proof = json.loads((Path(directory)/'trace-store-logging.json').read_text())
            self.assertEqual(proof, {'outcome':'passed','ownership':'passed','driver':'none'})
            self.assertEqual(identity.call_count,2)
            self.assertNotIn('owned/docker.sock',json.dumps(proof))
            self.assertNotIn(PROJECT,json.dumps(proof))

    def test_unsafe_http_starts_only_after_actual_none_proof_was_written(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
             patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
             patch('pilot.daemon.identify',return_value=FROZEN), \
             patch('pilot.command',side_effect=self.inspect_double()):
            def ingest(*args,**kwargs):
                proof = json.loads((Path(directory)/'trace-store-logging.json').read_text())
                self.assertEqual(proof['driver'],'none')
                self.assertEqual(proof['outcome'],'passed')
                return 400,''
            with patch('pilot.request',side_effect=ingest) as post:
                with self.assertRaisesRegex(RuntimeError,'link metadata privacy unproved'):
                    pilot.link_privacy_corpus(Path(directory),COMPOSE)
                self.assertEqual(post.call_count,2)

    def test_missing_or_retaining_driver_refuses_before_unsafe_ingest(self):
        for driver in (None,'','json-file','journald','none ', 'RAW_INSPECT_SENTINEL'):
            with self.subTest(driver=driver), tempfile.TemporaryDirectory() as directory, \
                 patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
                 patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
                 patch('pilot.daemon.identify',return_value=FROZEN), \
                 patch('pilot.command',side_effect=self.inspect_double(driver=driver)), \
                 patch('pilot.request') as ingest:
                with self.assertRaisesRegex(RuntimeError,'trace store logging'):
                    pilot.link_privacy_corpus(Path(directory),COMPOSE)
                ingest.assert_not_called()
                proof = json.loads((Path(directory)/'trace-store-logging.json').read_text())
                self.assertEqual(proof['outcome'],'failed')
                self.assertEqual(proof['driver'],'unverified')
                self.assertNotIn('RAW_INSPECT_SENTINEL',json.dumps(proof))

    def test_missing_foreign_ambiguous_or_nonrunning_trace_store_refuses_all_requests(self):
        cases = ({'container':''}, {'container':'c'*64+'\n'+'d'*64},
                 {'project':'foreign'}, {'service':'gateway'}, {'running':False})
        for fixture in cases:
            for entry in (pilot.smoke, pilot.link_privacy_corpus):
                with self.subTest(fixture=fixture,entry=entry.__name__), tempfile.TemporaryDirectory() as directory, \
                     patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
                     patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
                     patch('pilot.daemon.identify',return_value=FROZEN), \
                     patch('pilot.command',side_effect=self.inspect_double(**fixture)), \
                     patch('pilot.request') as ingest:
                    with self.assertRaises(RuntimeError):
                        if entry is pilot.smoke:
                            entry('private-key',Path(directory),COMPOSE)
                        else:
                            entry(Path(directory),COMPOSE)
                    ingest.assert_not_called()
                    proof = json.loads((Path(directory)/'trace-store-logging.json').read_text())
                    self.assertEqual(proof,{'outcome':'failed','ownership':'unverified','driver':'unverified'})

    def test_endpoint_socket_or_daemon_drift_before_or_after_inspection_refuses_ingest(self):
        for field, value in (('endpoint','unix:///foreign.sock'), ('socket_inode',3),
                             ('socket_device',9), ('daemon_id','foreign')):
            for when in ('before','after'):
                changed = {**FROZEN,field:value}
                answers = [changed] if when == 'before' else [FROZEN,changed]
                with self.subTest(field=field,when=when), tempfile.TemporaryDirectory() as directory, \
                     patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
                     patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
                     patch('pilot.daemon.identify',side_effect=answers), \
                     patch('pilot.command',side_effect=self.inspect_double()) as read, \
                     patch('pilot.request') as ingest:
                    with self.assertRaises(RuntimeError):
                        pilot.link_privacy_corpus(Path(directory),COMPOSE)
                    ingest.assert_not_called()
                    self.assertEqual(read.call_count,0 if when == 'before' else 2)
                    self.assertEqual(json.loads((Path(directory)/'trace-store-logging.json').read_text())['outcome'],'failed')

    def test_unfrozen_or_mismatched_endpoint_does_not_inspect_or_ingest(self):
        for endpoint, identity in ((None,None), (FROZEN['endpoint'],None),
                                   ('unix:///foreign.sock',FROZEN)):
            with tempfile.TemporaryDirectory() as directory, \
                 patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',endpoint), \
                 patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity), \
                 patch('pilot.command') as read, patch('pilot.request') as ingest:
                with self.assertRaises(RuntimeError):
                    pilot.link_privacy_corpus(Path(directory),COMPOSE)
                read.assert_not_called()
                ingest.assert_not_called()

    def test_inspect_failure_and_deadline_leave_no_raw_diagnostics_or_ingest(self):
        failure = subprocess.CalledProcessError(1,['docker'],output='RAW_INSPECT_SENTINEL',stderr='RAW_INSPECT_SENTINEL')
        for command_failure in (failure, subprocess.TimeoutExpired(['docker'],1)):
            with tempfile.TemporaryDirectory() as directory, \
                 patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
                 patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
                 patch('pilot.daemon.identify',return_value=FROZEN), \
                 patch('pilot.command',side_effect=command_failure), patch('pilot.request') as ingest:
                with self.assertRaises(RuntimeError) as caught:
                    pilot.link_privacy_corpus(Path(directory),COMPOSE)
                ingest.assert_not_called()
                proof = (Path(directory)/'trace-store-logging.json').read_text()
                self.assertNotIn('RAW_INSPECT_SENTINEL',proof+str(caught.exception))
                self.assertIsNone(caught.exception.__context__)

    def test_exhausted_absolute_budget_never_starts_inspect(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',FROZEN['endpoint']), \
             patch.object(pilot,'FROZEN_DOCKER_IDENTITY',FROZEN), \
             patch('pilot.assert_docker_identity'), \
             patch('pilot.time.monotonic',side_effect=[100,111]), \
             patch('pilot.command') as read, patch('pilot.request') as ingest:
            with self.assertRaises(RuntimeError):
                pilot.link_privacy_corpus(Path(directory),COMPOSE)
            read.assert_not_called()
            ingest.assert_not_called()


if __name__ == '__main__':
    unittest.main()
