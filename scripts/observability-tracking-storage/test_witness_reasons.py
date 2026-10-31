"""Every owning refusal keeps its old message and exposes only a fixed category."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import producer_protocol
from test_producer_protocol import wire
import tracking_storage
import diagnostics


class WitnessReasons(unittest.TestCase):
    def test_actual_predicates_include_late_private_rows_and_keep_original_fixed_messages(self):
        cases = []
        def changed(label, reason, message, mutate):
            value=wire()
            mutate(value)
            cases.append((label, reason, message, value))
        header='invalid tracking producer witness'
        for field, value in (('schema',True),('provider_requests',True),('provider_requests',3),
                             ('business','pending'),('persisted_carrier','pending'),('native_timer','pending'),('sdk_shutdown','pending'),
                             ('trace_id','0'*32),('trace_id',1),('trace_id','z'*32),
                             ('root_id','0'*16),('root_id',None),('root_id','z'*16),
                             ('runtime_module_groups',[]),('runtime_module_groups','private-canary')):
            changed('header_'+field+'_'+str(len(cases)), 'witness_header', header,
                    lambda row, field=field, value=value: row.update({field:value}))
        changed('header_extra','witness_header',header,lambda row:row.update(private='private-canary'))
        changed('header_missing','witness_header',header,lambda row:row.pop('schema'))
        changed('header_group_cap','witness_header',header,lambda row:row.update(runtime_module_groups=[[]]*9))
        cases.append(('header_type','witness_header',header,None))
        for label, group in (('empty',[]),('type','private-canary'),('cap',[{}]*513)):
            changed('group_'+label,'witness_group','invalid tracking module group',
                    lambda row, group=group:row['runtime_module_groups'].__setitem__(0,group))
        for label, row in (('type','private-canary'),('extra',{'path':'node_modules/a','sha256':'a'*64,'private':'private-canary'}),('missing',{'path':'node_modules/a'})):
            changed('row_'+label,'witness_row','invalid tracking module row',
                    lambda value, row=row:value['runtime_module_groups'][-1].__setitem__(-1,row))
        for index, path in enumerate((None,'','x'*513,'/absolute','node_modules/../private','foreign/file',
                                     'node_modules/private_tracking_token','node_modules/private-tracking-storage-provider-secret',
                                     'node_modules/tracking-storage.example.test','node_modules/private-canary\x00',
                                     'node_modules/private-canary\x1f','node_modules/private-canary\x7f')):
            changed('path_'+str(index),'witness_path','invalid tracking module witness',
                    lambda value, path=path:value['runtime_module_groups'][-1][-1].update(path=path))
        for index, digest in enumerate((None,'x'*64,'A'*64,'a'*63,'a'*65)):
            changed('digest_'+str(index),'witness_digest','invalid tracking module witness',
                    lambda value, digest=digest:value['runtime_module_groups'][-1][-1].update(sha256=digest))
        for conflicting in (False,True):
            def duplicate(value):
                row=copy.deepcopy(value['runtime_module_groups'][0][0])
                if conflicting: row['sha256']='b'*64
                value['runtime_module_groups'][-1].append(row)
            changed('duplicate_'+str(conflicting),'witness_duplicate','duplicate tracking module witness',duplicate)
        changed('required','witness_required','production tracking module witness missing',
                lambda value:value['runtime_module_groups'][0][0].update(path='node_modules/other.js'))
        for label,reason,message,value in cases:
            before=copy.deepcopy(value)
            with self.subTest(case=label), self.assertRaises(ValueError) as caught:
                producer_protocol.witness(value)
            error=caught.exception
            self.assertEqual(str(error),message)
            self.assertEqual(error.reason,reason)
            self.assertEqual(producer_protocol.witness_reason(error),reason)
            self.assertEqual(value,before)
            with self.assertRaises(AttributeError): error.reason='private-canary'
            with self.assertRaises(AttributeError): error._reason='private-canary'
            diagnostic=diagnostics.Diagnostic('tracking');diagnostic.start('witness');diagnostic.fail(reason)
            diagnostic.fail('unknown')
            self.assertEqual(diagnostic.snapshot()['reason'],reason)
            self.assertNotIn('private-canary',json.dumps(diagnostic.snapshot()))
            for scope in ('sdk','waitlist'):
                with self.assertRaises(ValueError):
                    diagnostics.validate({**diagnostic.snapshot(),'scope':scope},scope=scope)

    def test_classifier_never_reads_foreign_exception_fields_or_formats_values(self):
        class Hostile(ValueError):
            def __getattribute__(self,name):
                if name in ('reason','args','private'): raise AssertionError('foreign field read')
                return super().__getattribute__(name)
            def __str__(self): raise AssertionError('foreign str')
            def __repr__(self): raise AssertionError('foreign repr')
        for error in (Hostile('private-canary'),ValueError('private-canary'),TypeError('private-canary'),KeyError('private-canary'),RuntimeError('private-canary')):
            self.assertEqual(producer_protocol.witness_reason(error),'witness_refusal')
        malformed=producer_protocol.WitnessRefusal.__new__(producer_protocol.WitnessRefusal)
        self.assertEqual(producer_protocol.witness_reason(malformed),'witness_refusal')
        object.__setattr__(malformed,'_reason',{'private':'private-canary'})
        self.assertEqual(producer_protocol.witness_reason(malformed),'witness_refusal')
        class ForeignSubtype(producer_protocol.WitnessRefusal):
            @property
            def reason(self): raise AssertionError('subclass field read')
        self.assertEqual(producer_protocol.witness_reason(ForeignSubtype('witness_header')),'witness_refusal')
        for invalid in ('private-canary',None,[],True):
            with self.assertRaises(ValueError): producer_protocol.WitnessRefusal(invalid)

    def test_worker_preserves_original_exception_identity_and_first_owning_reason(self):
        error=producer_protocol.WitnessRefusal('witness_required')
        diagnostic=diagnostics.Diagnostic('tracking')
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(producer_protocol,'capture',return_value=wire()), \
                patch.object(producer_protocol,'witness',side_effect=error):
            with self.assertRaises(ValueError) as caught:
                tracking_storage.producer_observation(Path(directory).resolve(),environment={},diagnostic=diagnostic)
        self.assertIs(caught.exception,error)
        self.assertEqual(diagnostic.snapshot()['reason'],'witness_required')
