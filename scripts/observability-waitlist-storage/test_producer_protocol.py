"""Private grouped IPC bounds and native child cleanup, without PG/Docker."""
import copy
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

    def test_one_mebibyte_wire_and_duplicate_json_key_are_refused(self):
        with self.assertRaises(ValueError): producer_protocol.source_status.decode_json(b' '*1048577)
        raw=json.dumps(wire()).replace('"schema": 1','"schema":0,"schema":1',1)
        with self.assertRaises(ValueError): producer_protocol.source_status.decode_json(raw.encode())



if __name__ == "__main__": unittest.main()
