"""Actual Node marker commits plus owned listener cleanup, without API/PG execution."""
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
import api_progress
import producer_protocol

SOURCE='a'*40

class NativeProgress(unittest.TestCase):
    def test_actual_writer_and_owned_listener_outcomes_keep_original_failure(self):
        for scope in ('tracking','waitlist'):
            for case in ('success','exit','deadline','interruption','wrong_source','wrong_scope','atomic_block'):
                with self.subTest(scope=scope,case=case),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory)
                    report=output/'listener.json'
                    helper=Path(__file__).with_name('api-progress.mjs').as_uri()
                    ending={'success':'s.close(()=>process.stdout.write("null"));',
                        'exit':'process.exit(3);','wrong_source':'process.exit(3);','wrong_scope':'process.exit(3);',
                        'atomic_block':'fs.writeFileSync(process.env.INSIDE_PRODUCER_PHASE_PATH+".new","private-phase-sentinel");mark("http_completed");s.close(()=>process.stdout.write("null"));',
                        'deadline':'process.on("SIGTERM",()=>{});','interruption':'process.stdout.write("x");'}[case]
                    code=('import {createServer} from "node:http";import fs from "node:fs";'
                          'import {createApiProgress} from '+json.dumps(helper)+';'
                          'const mark=createApiProgress('+json.dumps(scope)+');const s=createServer();'
                          's.listen(0,"127.0.0.1",()=>{const p='+json.dumps(str(report))+';'
                          'fs.writeFileSync(p+".tmp",JSON.stringify([process.pid,s.address().port]));fs.renameSync(p+".tmp",p);'
                          'mark("api_started");process.stderr.write("private-phase-sentinel");'+
                          ('fs.writeFileSync(process.env.INSIDE_PRODUCER_PHASE_PATH,JSON.stringify({schema:1,scope:'+json.dumps(scope)+',source:"'+('b'*40)+'",state:"observed",milestone:"api_started"}));' if case=='wrong_source' else
                           'fs.writeFileSync(process.env.INSIDE_PRODUCER_PHASE_PATH,JSON.stringify({schema:1,scope:'+json.dumps('waitlist' if scope=='tracking' else 'tracking')+',source:"'+SOURCE+'",state:"observed",milestone:"api_started"}));' if case=='wrong_scope' else '')+ending+'});')
                    caught=None
                    try:
                        with api_progress.OwnedProgress(output,scope=scope,source=SOURCE) as channel:
                            marker=channel.path
                            environment=channel.environment(dict(os.environ))
                            def run(): return producer_protocol.capture(argv=['node','--input-type=module','-e',code],environment=environment,budget=.5)
                            if case=='interruption':
                                original=producer_protocol.selectors.DefaultSelector.select
                                def interrupted(selector,timeout):
                                    original(selector,timeout)
                                    raise KeyboardInterrupt()
                                with patch.object(producer_protocol.selectors.DefaultSelector,'select',interrupted): run()
                            else: run()
                    except BaseException as error: caught=error
                    expected={'success':None,'exit':RuntimeError,'deadline':TimeoutError,'interruption':KeyboardInterrupt,'wrong_source':RuntimeError,'wrong_scope':RuntimeError,'atomic_block':None}[case]
                    if expected is None: self.assertIsNone(caught)
                    else: self.assertIsInstance(caught,expected)
                    pid,port=json.loads(report.read_text())
                    with self.assertRaises(ProcessLookupError): os.kill(pid,0)
                    with socket.socket() as listener: listener.bind(('127.0.0.1',port))
                    self.assertFalse(marker.parent.exists())
                    value=api_progress.read(output/api_progress.NAME,scope=scope,source=SOURCE)
                    self.assertEqual(value['state'],'refused' if case in ('wrong_source','wrong_scope') else 'observed')
                    self.assertEqual(value['milestone'],'unknown' if case in ('wrong_source','wrong_scope') else 'api_started')
                    self.assertNotIn('private',json.dumps(value))

if __name__=='__main__': unittest.main()
