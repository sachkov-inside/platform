"""The four-response process path validates both whole VM vectors before projection."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import mcp_snapshot
from test_observation import acquisition


class MCPObservation(unittest.TestCase):
    def test_real_owned_protocol_child_joins_values_and_timestamps_and_refuses_bad_final_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);values,stamps=acquisition()
            value_file=root/'values';stamp_file=root/'stamps'
            value_file.write_text(json.dumps(values));stamp_file.write_text(json.dumps(stamps))
            fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'mcp.py')],
                     {'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(root/'owner'),
                      'CADDY_TEST_BODY_FILE':str(value_file),'CADDY_TEST_TIMESTAMP_FILE':str(stamp_file)})
            report,private=mcp_snapshot.read_snapshot(Path('/unused-native-fixture'),'a'*32,evaluated_at=100,
                wall_clock=lambda:101,_fixture=fixture)
            self.assertEqual(report['state'],'observed')
            self.assertEqual(report['observation']['requests_total'],3)
            self.assertEqual(report['transport'],{'canonical':'unrun','mcp':'passed'})
            self.assertEqual(private['timestamps'],stamp_file.read_bytes())
            for stage,outcome in (('initialize','eof'),('discovery','eof'),('initialize','contract'),('discovery','contract')):
                import evidence,scenario
                phases=[];failures=[];record=evidence.Run()
                experiment=scenario.Scenario(None,'a'*32,None,lambda kind,value:record.fail(value))
                def progressed(phase):
                    phases.append(phase);record.start(phase)
                    if phase.endswith('_eof'):raise KeyboardInterrupt('private optional metadata')
                def failed(error):
                    failures.append(error);experiment._mcp_startup_failed(error)
                    raise KeyboardInterrupt('private secondary')
                fixture[1]['CADDY_TEST_STARTUP']=stage+'_'+outcome
                kind=RuntimeError if outcome=='eof' else ValueError
                with self.assertRaises(kind) as caught:
                    try:
                        with mcp_snapshot.session(Path('/unused-native-fixture'),'a'*32,_fixture=fixture,
                                progress=progressed,failure=failed):self.fail('startup refusal accepted')
                    except kind as error:
                        import traceback
                        frames=[frame.name for frame in traceback.extract_tb(error.__traceback__)]
                        self.assertIn('rpc',frames)
                        self.assertNotIn('failed',frames)
                        self.assertNotIn('progressed',frames)
                        raise
                expected='mcp_'+stage+('_eof' if outcome=='eof' else '_decode')
                self.assertEqual(phases[-1],expected)
                self.assertEqual(failures,[caught.exception])
                experiment.failed(caught.exception)
                self.assertEqual((record.snapshot()['phase'],record.snapshot()['reason']),(expected,'runtime' if outcome=='eof' else 'contract'))
                self.assertEqual(set(record.snapshot()['cases'].values()),{'unrun'})
                owner=json.loads((root/'owner').read_text())
                for pid in (owner['pid'],owner['helper']):
                    with self.assertRaises(ProcessLookupError):os.kill(pid,0)
            del fixture[1]['CADDY_TEST_STARTUP']
            stamps['data']['result'][-1]['metric']['private']='private-caddy-sentinel'
            stamp_file.write_text(json.dumps(stamps))
            with self.assertRaises(ValueError):
                mcp_snapshot.read_snapshot(Path('/unused-native-fixture'),'a'*32,evaluated_at=100,
                    wall_clock=lambda:101,_fixture=fixture)

    def test_ready_session_is_one_pair_only_and_original_stale_frames_remain_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);values,stamps=acquisition()
            value_file=root/'values';stamp_file=root/'stamps'
            value_file.write_text(json.dumps(values));stamp_file.write_text(json.dumps(stamps))
            fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'mcp.py')],
                     {'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(root/'owner'),
                      'CADDY_TEST_BODY_FILE':str(value_file),'CADDY_TEST_TIMESTAMP_FILE':str(stamp_file)})
            with mcp_snapshot.session(Path('/unused-native-fixture'),'a'*32,_fixture=fixture) as read:
                report,private=read(evaluated_at=100,wall_clock=lambda:112)
                self.assertEqual(report['state'],'stale');self.assertEqual(report['sample_age_seconds'],13)
                self.assertEqual(private['evaluated_at'],100)
                with self.assertRaisesRegex(RuntimeError,'ready probe already used'):
                    read(evaluated_at=100,wall_clock=lambda:101)
            primary=RuntimeError('private caller failure');failures=[]
            with self.assertRaises(RuntimeError) as caught:
                with mcp_snapshot.session(Path('/unused-native-fixture'),'a'*32,_fixture=fixture,
                        failure=failures.append):raise primary
            self.assertIs(caught.exception,primary)
            self.assertEqual(failures,[])

    def test_shared_ten_second_query_budget_includes_final_oracle_validation(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        import time
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);values,stamps=acquisition()
            value_file=root/'values';stamp_file=root/'stamps'
            value_file.write_text(json.dumps(values));stamp_file.write_text(json.dumps(stamps))
            fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'mcp.py')],
                     {'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(root/'owner'),
                      'CADDY_TEST_BODY_FILE':str(value_file),'CADDY_TEST_TIMESTAMP_FILE':str(stamp_file)})
            # Virtual select expiry drives the actual reader's unchanged startup timeout.
            elapsed=[0.0];waits=[];phases=[];failures=[]
            def expire(read,write,error,timeout):
                waits.append(timeout);elapsed[0]+=timeout;return [],[],[]
            with patch.object(mcp_snapshot.pilot,'time',SimpleNamespace(monotonic=lambda:elapsed[0])), \
                    patch.object(mcp_snapshot.pilot,'select',SimpleNamespace(select=expire)):
                with self.assertRaisesRegex(RuntimeError,'native MCP response deadline exceeded') as caught:
                    with mcp_snapshot.session(Path('/unused-native-fixture'),'a'*32,_fixture=fixture,
                            progress=phases.append,failure=failures.append):self.fail('deadline accepted')
            self.assertEqual(waits,[mcp_snapshot.pilot.MCP_RESPONSE_TIMEOUT_SECONDS])
            self.assertEqual(phases[-1],'mcp_initialize_deadline')
            self.assertEqual(failures,[caught.exception])
            now=[time.monotonic()];evaluate=mcp_snapshot.caddy_status.evaluate
            def delayed(*args,**kwargs):
                value=evaluate(*args,**kwargs);now[0]+=10;return value
            with mcp_snapshot.session(Path('/unused-native-fixture'),'a'*32,_fixture=fixture) as read,patch.object(mcp_snapshot,'time',SimpleNamespace(monotonic=lambda:now[0])),patch.object(mcp_snapshot.caddy_status,'evaluate',side_effect=delayed):
                with self.assertRaisesRegex(TimeoutError,'closed Caddy MCP query deadline'):
                    read(evaluated_at=100,wall_clock=lambda:101)
