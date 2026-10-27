"""Telegram acceptance requires processed durable rows, not HTTP acknowledgement alone."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import telegram


class Telegram(unittest.TestCase):
    def test_pending_or_failed_native_rows_cannot_pass_processed_workload(self):
        for row in ({'accepted':5,'processed':0,'failed':0,'planned':5,'delivered':0},{'accepted':5,'processed':4,'failed':1,'planned':5,'delivered':4},{'accepted':4,'processed':4,'failed':0,'planned':4,'delivered':4}):
            self.assertIsNone(telegram.processed([],lambda *args,**kw:json.dumps(row),2000000,2001000,5))
        expected={'accepted':5,'processed':5,'failed':0,'planned':5,'delivered':5}
        self.assertEqual(telegram.processed([],lambda *args,**kw:json.dumps(expected),2000000,2001000,5),expected)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{"accepted":true,"processed":1,"failed":0}',2000000,2001000,1)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{}','unsafe',2001000,1)

        # The actual current parser is a prerequisite to accepting the durable workload.
        # Parse only the private generated env; do not start workers or contact a provider.
        with tempfile.TemporaryDirectory(prefix='inside-telegram-config-') as temporary:
            output=Path(temporary)
            plan={'services':{'provider':{},'loadgen':{'volumes':[]}}}
            telegram.configure(output,plan,{'telegram':'owned-fixed-image'})
            program='import { readFileSync } from "node:fs";\nimport { parseEnv } from "node:util";\nimport { loadApplicationConfig } from "./src/config/application-config.ts";\ntry {\n  const config=loadApplicationConfig(parseEnv(readFileSync(process.argv[1],"utf8")));\n  process.stdout.write(JSON.stringify({accepted:true,deliveryMode:config.deliveryMode,workersEnabled:config.workersEnabled}));\n} catch { process.stdout.write(JSON.stringify({accepted:false})); process.exitCode=1; }\n'
            node=shutil.which('node')
            self.assertIsNotNone(node)
            result=subprocess.run([node,'--import','tsx','--input-type=module','-e',program,str(output/'telegram/application.env')],
                cwd=telegram.HERE.parents[1]/'apps/telegram',capture_output=True,timeout=5,
                env={'PATH':os.environ.get('PATH',''),'NODE_ENV':'test'})
            self.assertEqual(result.returncode,0,'generated Telegram configuration refused')
            self.assertEqual(json.loads(result.stdout),{'accepted':True,'deliveryMode':'live','workersEnabled':True})
