"""Controlled Docker/HTTP boundaries verify pilot control flow, never native collector execution."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

import pilot
from test_telegram_runtime_oracle import rows,vector,NOW


class TelegramRuntimeController(unittest.TestCase):
    def test_existing_owned_reader_checks_full_rows_and_metrics_for_both_native_transports(self):
        identity = {'platform':'linux','endpoint':'unix:///owned/docker.sock'}
        project = 'inside-observability-pilot-'+'1'*12
        compose = ['docker','compose','-p',project,'-f','/owned/compose.json']
        uploads = []
        def docker(args,*,timeout):
            self.assertGreater(timeout,0)
            self.assertLessEqual(timeout,pilot.QUERY_TIMEOUT_SECONDS)
            if args[1] == 'compose': return 'c'*64
            if args[1] == 'inspect': return 'owned|none' if '.HostConfig.LogConfig.Type' in args[3] else project+'|gateway|true'
            self.assertEqual(args[1],'exec')
            self.assertIn('limit=11',args[-1])
            self.assertNotIn('fields',args[-1])
            self.assertIn('OR',args[-1])
            transport = 'json' if 'e'*30+'81' in args[-1] else 'protobuf'
            return '\n'.join(json.dumps(row) for row in rows(transport))
        def http(path,*,token=None,body=None,method='GET',port=18427):
            if method == 'POST':
                self.assertEqual(port,14318)
                self.assertIsNone(token)
                uploads.append((path,type(body)))
                return 200,''
            self.assertEqual(token,'PRIVATE_TOKEN')
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)['query'][0]
            self.assertNotIn('__name__',query)
            self.assertIn('service.name="inside-telegram"',query)
            return 200,json.dumps(vector('json' if '0.1566.1' in query else 'protobuf'))
        with tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']), patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity), patch('pilot.daemon.identify',return_value=identity), patch('pilot.command',side_effect=docker), patch('pilot._raw_command',side_effect=AssertionError('unmocked native Docker read forbidden in source contract')), patch('pilot.request',side_effect=http), patch('pilot.time.time_ns',return_value=NOW):
            pilot.telegram_runtime_catalog_corpus('PRIVATE_TOKEN',Path(directory),compose)
            proof=json.loads((Path(directory)/'telegram-runtime-collector.json').read_text())
            self.assertEqual(proof['outcome'],'passed')
            for name in ('trace-store-logging.json','collector-logging.json'):
                self.assertEqual(json.loads((Path(directory)/name).read_text()),{'outcome':'passed','ownership':'passed','driver':'none'})
            self.assertEqual([case['transport'] for case in proof['cases']],['json','protobuf'])
            self.assertEqual([case['metric_series'] for case in proof['metrics']],[50,50])
            self.assertEqual(uploads,[('/v1/traces',dict),('/v1/metrics',dict),('/v1/traces',bytes),('/v1/metrics',bytes)])
            self.assertNotIn('PRIVATE_TOKEN',json.dumps(proof))
            with self.assertRaises(pilot.LinkStorageOwnershipError): pilot.fixture_trace_rows(compose,'telegram-runtime-private-query')

    def test_no_unsafe_payload_is_sent_without_actual_owned_store_logging(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',None), patch('pilot.request') as http:
            with self.assertRaisesRegex(RuntimeError,'^Telegram runtime collector proof failed; raw diagnostics withheld$'):
                pilot.telegram_runtime_catalog_corpus('PRIVATE_TOKEN',Path(directory),[])
            http.assert_not_called()
            proof=json.loads((Path(directory)/'telegram-runtime-collector.json').read_text())
            self.assertEqual(proof,{'outcome':'failed','stage':'logging','cases':[],'metrics':[]})

    def test_collector_logging_is_observed_before_private_telegram_uploads(self):
        identity={'platform':'linux','endpoint':'unix:///owned/docker.sock'}
        compose=['docker','compose','-p','inside-observability-pilot-'+'1'*12,'-f','/owned/compose.json']
        def docker(args,*,timeout):
            if args[1] == 'compose': return 'd'*64 if args[-1] == 'alloy' else 'c'*64
            self.assertEqual(args[1],'inspect')
            return 'owned|unverified' if '"alloy"' in args[3] else 'owned|none'
        with tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']), patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity), patch('pilot.daemon.identify',return_value=identity), patch('pilot.command',side_effect=docker), patch('pilot._raw_command',side_effect=AssertionError('unmocked native Docker read forbidden')), patch('pilot.request') as http:
            with self.assertRaises(RuntimeError): pilot.telegram_runtime_catalog_corpus('PRIVATE_TOKEN',Path(directory),compose)
            http.assert_not_called()
            self.assertEqual(json.loads((Path(directory)/'telegram-runtime-collector.json').read_text())['stage'],'logging')

    def test_alloy_missing_ambiguous_foreign_stopped_or_retaining_blocks_every_upload(self):
        identity={'platform':'linux','endpoint':'unix:///owned/docker.sock'}
        project='inside-observability-pilot-'+'1'*12
        compose=['docker','compose','-p',project,'-f','/owned/compose.json']
        cases=(('',None),('d'*64+'\n'+'e'*64,None),('d'*64,'foreign-project'),
               ('d'*64,'foreign-service'),('d'*64,'stopped'),('d'*64,'retaining'))
        for container,condition in cases:
            def docker(args,*,timeout):
                self.assertGreater(timeout,0)
                if args[1] == 'compose': return container if args[-1] == 'alloy' else 'c'*64
                self.assertEqual(args[:3],['docker','inspect','--format'])
                if args[-1] == 'c'*64: return 'owned|none'
                self.assertIn('"'+project+'"',args[3])
                self.assertIn('"alloy"',args[3])
                self.assertIn('.State.Running',args[3])
                self.assertIn('eq .HostConfig.LogConfig.Type "none"',args[3])
                return 'owned|unverified' if condition == 'retaining' else 'unowned|none'
            with self.subTest(condition=condition,container=container), tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']), patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity), patch('pilot.daemon.identify',return_value=identity), patch('pilot.command',side_effect=docker), patch('pilot._raw_command',side_effect=AssertionError('native Docker forbidden')), patch('pilot.request') as http:
                with self.assertRaises(RuntimeError): pilot.telegram_runtime_catalog_corpus('PRIVATE_TOKEN',Path(directory),compose)
                http.assert_not_called()
                self.assertEqual(json.loads((Path(directory)/'trace-store-logging.json').read_text())['outcome'],'passed')
                self.assertEqual(json.loads((Path(directory)/'collector-logging.json').read_text())['outcome'],'failed')
                self.assertEqual(json.loads((Path(directory)/'telegram-runtime-collector.json').read_text())['stage'],'logging')

    def test_unknown_logging_service_is_rejected_without_native_reads(self):
        with tempfile.TemporaryDirectory() as directory, patch('pilot.command') as command, patch('pilot._raw_command',side_effect=AssertionError('native Docker forbidden')), patch('pilot.daemon.identify') as identify:
            with self.assertRaises(ValueError): pilot.verify_trace_store_logging(Path(directory),[],service='gateway')
            command.assert_not_called()
            identify.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()),[])

if __name__ == '__main__': unittest.main()
