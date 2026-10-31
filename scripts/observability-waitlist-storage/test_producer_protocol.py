"""Private grouped IPC bounds and native child cleanup, without PG/Docker."""
import copy
import hashlib
import subprocess
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
import producer_protocol


def wire(count=3041):
    names=sorted(producer_protocol.REQUIRED)
    names += ['node_modules/module-'+str(i)+'.js' for i in range(count-len(names))]
    rows=[{'path':name,'sha256':'a'*64} for name in names]
    return {'schema':1,'trace_id':'a'*32,'root_id':'b'*16,'provider_requests':1,
        'business':'passed','persisted_carrier':'passed','native_timer':'passed','sdk_shutdown':'passed',
        'runtime_module_groups':[rows[i:i+512] for i in range(0,len(rows),512)]}


class GroupedWitness(unittest.TestCase):
    def parse(self,value):
        return producer_protocol.witness(producer_protocol.source_status.decode_json(json.dumps(value).encode()))

    def test_actual_api_sized_rows_project_only_after_all_groups_are_admitted(self):
        value=wire();before=copy.deepcopy(value)
        self.assertEqual(len(self.parse(value)['runtime_modules']),3041)
        self.assertEqual(value,before)
        self.assertEqual(len(self.parse(wire(4096))['runtime_modules']),4096)

    def test_closed_group_count_row_schema_identity_path_digest_and_duplicates(self):
        for case in ('groups','empty','group_rows','duplicate','conflicting','missing_module','path','digest','row_extra','schema','provider','phase','identity','type'):
            with self.subTest(case=case):
                value=wire()
                if case=='groups': value['runtime_module_groups'] += [value['runtime_module_groups'][0]]*3
                elif case=='empty': value['runtime_module_groups'][0]=[]
                elif case=='group_rows': value['runtime_module_groups'][0].append({'path':'node_modules/extra.js','sha256':'b'*64})
                elif case in ('duplicate','conflicting'):
                    row=copy.deepcopy(value['runtime_module_groups'][0][0])
                    if case=='conflicting': row['sha256']='b'*64
                    value['runtime_module_groups'][-1].append(row)
                elif case=='missing_module': value['runtime_module_groups'][0][0]['path']='node_modules/unrelated.js'
                elif case=='path': value['runtime_module_groups'][0][0]['path']='node_modules/../private.js'
                elif case=='digest': value['runtime_module_groups'][0][0]['sha256']='x'*64
                elif case=='row_extra': value['runtime_module_groups'][0][0]['secret']='private'
                elif case=='schema': value['schema']=True
                elif case=='provider': value['provider_requests']=True
                elif case=='phase': value['sdk_shutdown']='pending'
                elif case=='identity': value['trace_id']='0'*32
                else: value['runtime_module_groups']='anything'
                with self.assertRaises(ValueError): self.parse(value)

    def test_real_node_json_schema_label_and_exact_admission(self):
        root=Path(__file__).resolve().parents[2]
        producer=Path(__file__).with_name('producer.mjs').read_text()
        # Execute the owning production load hook, without the API/PG producer.
        hook=producer[producer.index('  const hooks = registerHooks({'):producer.index('\n\n  /** @type',producer.index('  const hooks = registerHooks({'))]
        script="""
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.cwd();const loaded=new Map();
"""+hook+"""
try {
  await import(pathToFileURL(root+'/docs/contracts/notifications-v1/schema.json').href,{with:{type:'json'}});
  process.stdout.write(JSON.stringify([...loaded].map(([path,sha256])=>({path,sha256}))));
} finally { hooks.deregister(); }
"""
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=root,
            check=True,capture_output=True,timeout=10)
        rows=json.loads(result.stdout)
        canonical='docs/contracts/notifications-v1/schema.json'
        self.assertEqual(rows,[{'path':canonical,'sha256':hashlib.sha256((root/canonical).read_bytes()).hexdigest()}])
        value=wire(len(producer_protocol.REQUIRED))
        self.parse(value)  # Required-only control remains valid.
        value['runtime_module_groups'][-1] += rows
        self.assertIn(canonical,self.parse(value)['runtime_modules'])
        bad_paths={
            'neighbour':'docs/contracts/notifications-v1/other.json',
            'suffix':canonical+'.js','absolute':'/'+canonical,
            'traversal':'docs/contracts/notifications-v1/../notifications-v1/schema.json',
            'private':'docs/contracts/private-waitlist/schema.json',
            'control':canonical+'\x00','query':canonical+'?private=1',
        }
        for case,name in bad_paths.items():
            with self.subTest(case=case):
                bad=copy.deepcopy(value);bad['runtime_module_groups'][-1][-1]['path']=name
                with self.assertRaises(ValueError): self.parse(bad)
        for case in ('digest','duplicate','required'):
            with self.subTest(case=case):
                bad=copy.deepcopy(value)
                if case=='digest': bad['runtime_module_groups'][-1][-1]['sha256']='x'*64
                elif case=='duplicate': bad['runtime_module_groups'][-1].append(rows[0])
                else: bad['runtime_module_groups'][0].pop(0)
                with self.assertRaises(ValueError): self.parse(bad)

    def test_one_mebibyte_wire_and_duplicate_json_key_are_refused(self):
        with self.assertRaises(ValueError): producer_protocol.source_status.decode_json(b' '*1048577)
        raw=json.dumps(wire()).replace('"schema": 1','"schema":0,"schema":1',1)
        with self.assertRaises(ValueError): producer_protocol.source_status.decode_json(raw.encode())



if __name__ == "__main__": unittest.main()
