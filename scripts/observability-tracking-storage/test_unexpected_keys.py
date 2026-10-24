"""Finite unexpected-key evidence through the real strict oracle; no API/PG."""
import json
from pathlib import Path
import tempfile
import unittest

import tracking_oracle
import unexpected_keys as facts
from test_tracking_oracle import trace_rows, TRACE, ROOT

SOURCE='a'*40


class UnexpectedKeyFacts(unittest.TestCase):
    def test_real_unexpected_refusal_keeps_original_error_and_persists_only_closed_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private-value-canary'
            with facts.create(output) as owner:
                facts.bind_source(owner,SOURCE)
                with self.assertRaises(RuntimeError) as caught:
                    tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)
                self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                self.assertEqual(caught.exception.args,('Tracking storage trace contract failed',))
            path=output/facts.NAME
            self.assertTrue(path.is_file(),'first unexpected refusal has no closed observation')
            self.assertEqual(json.loads(path.read_text()),dict(schema=1,scope='tracking',source=SOURCE,state='observed',
                gate='trace_gate_06_unexpected_key',role='postgresql_acquire',known_keys=['a19'],other=False))
            self.assertNotIn('private-value-canary',path.read_text())


# Literal contract from the existing non-Telegram Alloy keep_keys catalog.
CATALOG = ('http.route','http.request.method','http.request.outcome','http.response.status_code',
    'messaging.system','messaging.destination.name','messaging.operation.name','messaging.operation.type',
    'pgboss.job.state','error.type','dependency.name','dependency.operation','dependency.outcome',
    'tracking.operation','tracking.outcome','waitlist.operation','waitlist.outcome','email.lane',
    'messaging.message.id','pgboss.job.retry_count','messaging.batch.message_count')


def closed(state='unknown',role='unknown',keys=(),other=False):
    return dict(schema=1,scope='tracking',source=SOURCE,state=state,gate='trace_gate_06_unexpected_key' if state=='observed' else 'unknown',
                role=role,known_keys=list(keys),other=other)


class ObserverContracts(unittest.TestCase):
    def observe_rows(self,rows,output,owner):
        return tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)

    def test_every_catalog_candidate_has_exact_source_id_for_all_five_roles(self):
        import producer_phase
        for index,role in ((0,'root'),(1,'delivery'),(2,'provider'),(4,'postgresql_query'),(-1,'postgresql_acquire')):
            for ordinal,key in enumerate(CATALOG,1):
                with self.subTest(role=role,key=ordinal),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory).resolve();rows=trace_rows();extra='span_attr:'+key
                    unexpected=extra not in rows[index]
                    if unexpected:rows[index][extra]='private-value-canary'
                    with facts.create(output) as owner:
                        facts.bind_source(owner,SOURCE)
                        if unexpected:
                            with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$') as caught:self.observe_rows(rows,output,owner)
                            self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                        else:self.assertIsNotNone(self.observe_rows(rows,output,owner))
                    value=producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE)
                    self.assertEqual(value,closed('observed',role,('a'+str(ordinal).zfill(2),)) if unexpected else closed())
                    wire=(output/facts.NAME).read_text();self.assertNotIn('private-value-canary',wire);self.assertNotIn(extra,wire)

    def test_unknown_keys_are_only_a_boolean_and_multiple_keys_sort_and_latch(self):
        import producer_phase
        for ordering in (('messaging.batch.message_count','messaging.system','messaging.message.id'),
                         ('messaging.message.id','messaging.batch.message_count','messaging.system')):
            with tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();rows=trace_rows()
                for key in ordering:rows[-1]['span_attr:'+key]='private-value-canary'
                rows[-1]['private-key-canary']='private-value-canary'
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    self.assertIsNone(self.observe_rows(trace_rows()[:1],output,owner))
                    with self.assertRaises(RuntimeError):self.observe_rows(rows,output,owner)
                    later=trace_rows();later[0]['span_attr:error.type']='private-later'
                    with self.assertRaises(RuntimeError):self.observe_rows(later,output,owner)
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed('observed','postgresql_acquire',('a05','a19','a21'),True))
                self.assertNotIn('private', (output/facts.NAME).read_text())

    def test_earlier_and_other_gate06_details_never_produce_unexpected_facts(self):
        import producer_phase
        for case in ('missing','expected','optional','earlier'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();rows=trace_rows()
                if case=='missing':rows[-1].pop('resource_attr:service.version');rows[-1]['private-key']='private'
                elif case=='expected':rows[-1]['kind']='999'
                elif case=='optional':rows[-1]['scope_version']='private'
                else:rows[-1]['span_id']='invalid';rows[-1]['private-key']='private'
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    with self.assertRaises(RuntimeError):self.observe_rows(rows,output,owner)
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed())

    def test_default_and_foreign_observers_do_not_touch_hostile_inputs_or_io(self):
        from unittest.mock import patch
        import producer_phase
        class Hostile:
            def __hash__(self):raise AssertionError('foreign hash')
            def __getattribute__(self,_):raise AssertionError('foreign getter')
        class Derived(type(facts.create(Path('/owned')))):pass
        for owner in (None,Hostile(),object.__new__(Derived),object.__new__(type(facts.create(Path('/owned'))))):
            self.assertIsNone(facts.admit(owner))
            with patch.object(producer_phase,'write_unexpected_keys',side_effect=AssertionError('unexpected IO')):
                facts.observe(owner,Hostile(),Hostile(),Hostile());facts.bind_source(owner,Hostile())
        rows=trace_rows();rows[-1]['private-key']='private'
        with patch.object(facts,'create',side_effect=AssertionError('default allocation')),patch.object(producer_phase,'write_unexpected_keys',side_effect=AssertionError('default IO')):
            with self.assertRaises(RuntimeError):tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT)

    def test_source_binding_is_once_and_internal_fault_is_only_channel_refusal(self):
        from unittest.mock import patch
        import producer_phase
        for case in ('conflict','invalid','internal'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve()
                with facts.create(output) as owner:
                    facts.bind_source(owner,SOURCE)
                    if case=='conflict':facts.bind_source(owner,'b'*40)
                    elif case=='invalid':facts.bind_source(owner,True)
                    else:
                        rows=trace_rows();rows[-1]['private-key']='private'
                        with patch.object(facts,'validate',side_effect=RuntimeError('private failure')):
                            with self.assertRaises(RuntimeError) as caught:self.observe_rows(rows,output,owner)
                            self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                self.assertEqual(producer_phase.read_unexpected_keys(output/facts.NAME,source=SOURCE),closed('refused'))
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output):pass
            self.assertFalse((output/facts.NAME).exists())


    def test_entire_closed_schema_has_no_coercion_and_full_catalog_fits_cap(self):
        import producer_phase
        accepted=closed('observed','root',tuple('a'+str(index).zfill(2) for index in range(1,22)),True)
        self.assertEqual(facts.validate(accepted,source=SOURCE),accepted)
        mutations=[{**closed(),key:value} for key,value in (('schema',True),('schema',1.0),('scope',None),('source',SOURCE.upper()),
            ('state','private'),('gate','trace_gate_06_unexpected_key'),('role','root'),('known_keys',()),('known_keys',[True]),('other',0))]
        mutations.extend([{**closed('refused'),'known_keys':['a19']},{**accepted,'extra':'private'},{**accepted,'known_keys':['a01']*22}])
        for value in mutations:
            with self.assertRaisesRegex(ValueError,'^closed tracking unexpected-key observation refused$'):facts.validate(value,source=SOURCE)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory).resolve()/facts.NAME;producer_phase.write_unexpected_keys(path,accepted,source=SOURCE)
            self.assertLessEqual(len(path.read_bytes()),512)
            self.assertEqual(producer_phase.read_unexpected_keys(path,source=SOURCE),accepted)
        with tempfile.TemporaryDirectory() as directory:
            owner=facts.create(Path(directory).resolve());facts.bind_source(owner,SOURCE)
            with unittest.mock.patch.object(facts,'validate',side_effect=KeyboardInterrupt()):
                with self.assertRaises(KeyboardInterrupt):facts.observe(owner,{'name':'postgresql acquire','private':'private'},set(),{})
            owner.__exit__(None,None,None)


class ReadPrimaryContracts(unittest.TestCase):
    def test_new_read_acquisition_keeps_first_primary_and_safely_retires_its_only_fd(self):
        import os
        import stat
        from unittest.mock import patch
        import producer_phase as phase
        from test_emitter_phase import rescue_fixture_descriptors
        class Hostile(RuntimeError):
            def with_traceback(self,*_):raise AssertionError('overridden traceback method')
        for stage in ('open','fstat'):
            for kind in (KeyboardInterrupt,SystemExit,Hostile):
                for same in (False,True):
                    with self.subTest(stage=stage,kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                        root=Path(directory).resolve();path=root/facts.NAME;phase.write_unexpected_keys(path,closed(),source=SOURCE)
                        primary=kind('private');secondary=primary if same else OSError('private secondary');records=[];foreign=[];calls=[];primary_tb=[]
                        original={name:getattr(os,name) for name in ('open','fstat','close')}
                        def opened(*args,**kwargs):
                            if stage=='open':raise primary
                            fd=original['open'](*args,**kwargs);info=original['fstat'](fd)
                            records.append(dict(fd=fd,dev=info.st_dev,ino=info.st_ino,active=True));return fd
                        def fstat(fd):
                            info=original['fstat'](fd)
                            if stat.S_ISDIR(info.st_mode):
                                try:raise primary
                                except BaseException:
                                    import sys
                                    primary_tb.append(sys.exc_info()[2]);raise
                            return info
                        def close(fd):
                            calls.append(fd);records[-1]['active']=False;original['close'](fd)
                            reused=original['open'](root/'foreign',os.O_CREAT|os.O_RDWR,0o600);info=original['fstat'](reused)
                            foreign.append(dict(fd=reused,dev=info.st_dev,ino=info.st_ino,active=True));raise secondary
                        try:
                            with patch.object(os,'open',side_effect=opened),patch.object(os,'fstat',side_effect=fstat),patch.object(os,'close',side_effect=close):
                                captured=None
                                try:phase.read_unexpected_keys(path,source=SOURCE)
                                except BaseException as error:captured=error
                            self.assertIs(captured,primary);self.assertEqual(len(calls),0 if stage=='open' else 1)
                            frames=[];tb=BaseException.__traceback__.__get__(primary)
                            while tb is not None:
                                frames.append(tb.tb_frame.f_code.co_name)
                                if primary_tb and tb is primary_tb[0]:break
                                tb=tb.tb_next
                            self.assertNotIn('close',frames)
                            if primary_tb:self.assertIs(tb,primary_tb[0])
                            for entry in foreign:
                                held=original['fstat'](entry['fd']);self.assertEqual((held.st_dev,held.st_ino),(entry['dev'],entry['ino']))
                        finally:rescue_fixture_descriptors([*records,*foreign],fstat=original['fstat'],close=original['close'])

    def test_new_read_keeps_first_control_flow_primary_and_traceback_across_all_closes(self):
        import os
        import stat
        from unittest.mock import patch
        import producer_phase as phase
        class HostileTraceback(RuntimeError):
            def with_traceback(self,*_):raise AssertionError('overridden traceback method')
        for operation in ('read','fstat'):
            for kind in (KeyboardInterrupt,SystemExit,HostileTraceback):
                for same in (False,True):
                    with self.subTest(operation=operation,kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                        output=Path(directory).resolve();path=output/facts.NAME;phase.write_unexpected_keys(path,closed(),source=SOURCE)
                        primary=kind('private primary');secondary=primary if same else OSError('private secondary')
                        from test_emitter_phase import rescue_fixture_descriptors
                        original_close=os.close;original_fstat=os.fstat;original_open=os.open;closes=[];records=[]
                        def opened(*args,**kwargs):
                            fd=original_open(*args,**kwargs);info=original_fstat(fd)
                            records.append(dict(fd=fd,dev=info.st_dev,ino=info.st_ino,active=True));return fd
                        def failing_read(*_):raise primary
                        def failing_fstat(fd):
                            value=original_fstat(fd)
                            if stat.S_ISREG(value.st_mode):raise primary
                            return value
                        def close_after_actual(fd):
                            closes.append(fd)
                            next(entry for entry in reversed(records) if entry['fd']==fd and entry['active'])['active']=False
                            original_close(fd)
                            if len(closes)==1:raise secondary
                        try:
                            with patch.object(phase.os,'open',side_effect=opened),patch.object(phase.os,'close',side_effect=close_after_actual),patch.object(phase.os,operation,side_effect=failing_read if operation=='read' else failing_fstat):
                                captured=None
                                try:phase.read_unexpected_keys(path,source=SOURCE)
                                except BaseException as error:captured=error
                            self.assertIs(captured,primary);self.assertEqual(len(closes),2);self.assertEqual(len(set(closes)),2)
                            frames=[];tb=BaseException.__traceback__.__get__(primary)
                            while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                            self.assertNotIn('close_after_actual',frames)
                            for fd in closes:
                                with self.assertRaises(OSError):original_fstat(fd)
                        finally:rescue_fixture_descriptors(records,fstat=original_fstat,close=original_close)



class OrchestrationContracts(unittest.TestCase):
    def test_producer_binds_only_its_existing_single_git_read(self):
        from unittest.mock import patch
        import tracking_storage as storage
        diagnostic=storage.diagnostics.Diagnostic('tracking')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output) as owner:
                with patch.object(storage.ci,'read_command',return_value=SOURCE) as command,patch.object(storage.producer_protocol,'capture',return_value={}),patch.object(storage.producer_protocol,'witness',return_value={'runtime_modules':{}}),patch.object(storage.pilot,'write_json'):
                    storage.producer_observation(output,environment={},diagnostic=diagnostic,observation=owner)
                    command.assert_called_once_with(['git','-C',str(storage.pilot.ROOT),'rev-parse','HEAD'])
                rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private'
                with self.assertRaises(RuntimeError):tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=owner)
            self.assertTrue((output/facts.NAME).is_file(),'existing Git source did not bind observation')
            self.assertEqual(json.loads((output/facts.NAME).read_text()),closed('observed','postgresql_acquire',('a19',)))

    def test_stored_loop_forwards_first_actual_refusal_after_pending_without_more_queries(self):
        from unittest.mock import patch
        import tracking_storage as storage
        from test_tracking_oracle import vector
        rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private'
        diagnostic=storage.diagnostics.Diagnostic('tracking');result={}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()
            with facts.create(output) as owner:
                facts.bind_source(owner,SOURCE)
                with patch.object(storage.sdk_storage,'metric_response',return_value=json.dumps(vector())) as metrics,patch.object(storage,'trace_response',side_effect=['','\n'.join(json.dumps(row) for row in rows),'unreachable']) as traces,patch.object(storage.time,'sleep') as sleep:
                    with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$') as caught:
                        storage.stored_metrics_and_traces(token='owned',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result=result,diagnostic=diagnostic,observation=owner)
                    self.assertEqual(caught.exception.diagnostic_reason,'trace_gate_06_unexpected_key')
                    self.assertEqual((metrics.call_count,traces.call_count,sleep.call_count),(2,2,1))
            self.assertEqual(json.loads((output/facts.NAME).read_text()),closed('observed','postgresql_acquire',('a19',)))
            self.assertEqual((diagnostic.snapshot()['phase'],diagnostic.snapshot()['reason']),('trace_validation','trace_gate_06_unexpected_key'))


    def test_earlier_metric_and_other_trace_refusals_leave_unknown_without_later_queries(self):
        from unittest.mock import patch
        import tracking_storage as storage
        from test_tracking_oracle import vector
        for case in ('metric','earlier_trace'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();rows=trace_rows();rows[-1]['span_id']='invalid';rows[-1]['private']='private'
                with facts.create(root) as owner:
                    facts.bind_source(owner,SOURCE)
                    with patch.object(storage.sdk_storage,'metric_response',return_value='{}' if case=='metric' else json.dumps(vector())) as metrics,patch.object(storage,'trace_response',return_value='\n'.join(json.dumps(row) for row in rows)) as traces,patch.object(storage.time,'sleep') as sleep:
                        with self.assertRaises(RuntimeError):storage.stored_metrics_and_traces(token='owned',compose=[],targets=None,observed={'trace_id':TRACE,'root_id':ROOT},result={},diagnostic=storage.diagnostics.Diagnostic('tracking'),observation=owner)
                        self.assertEqual(metrics.call_count,1);self.assertEqual(traces.call_count,0 if case=='metric' else 1);sleep.assert_not_called()
                self.assertEqual(json.loads((root/facts.NAME).read_text()),closed())



def receipt(root):
    metadata=root/'metadata';metadata.mkdir(mode=0o700)
    value=dict(checkout_sha=SOURCE,checkout_tree='b'*40,repository=None,run_id=None,run_attempt=None,event=None,
        provider_execution_sha=SOURCE,provider_pr_head_sha=None,provider_pr_base_sha=None,inputs={'legacy-source':'c'*64},scope='existing fixture scope')
    path=metadata/'source.json';path.write_text(json.dumps(value));path.chmod(0o600)
    return metadata


class CollectionContracts(unittest.TestCase):
    def test_present_invalid_facts_refuse_before_public_destination(self):
        from unittest.mock import patch
        import tracking_storage as storage
        invalid=[b'{"schema":1,"schema":1}',json.dumps({**closed(),'schema':True}).encode(),
            json.dumps({**closed(),'source':'b'*40}).encode(),json.dumps({**closed(),'scope':'sdk'}).encode(),
            json.dumps({**closed(),'raw_key':'private'}).encode(),json.dumps(closed('observed','root',())).encode(),
            json.dumps(closed('observed','private',('a19',))).encode(),json.dumps(closed('observed','root',('a21','a01'))).encode(),
            json.dumps(closed('observed','root',('a19','a19'))).encode(),json.dumps(closed('observed','root',('private',))).encode(),
            json.dumps({**closed(),'other':1}).encode(),b'NaN',b'\xff',b' '*513]
        for index,raw in enumerate(invalid):
            with self.subTest(case=index),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=receipt(root);destination=root/'public'
                path=output/facts.NAME;path.write_bytes(raw);path.chmod(0o600)
                with patch.object(storage.ci,'read_command',return_value=SOURCE):
                    with self.assertRaises(ValueError):storage.collect(output,metadata,destination)
                self.assertFalse(destination.exists(),'public destination acquired before whole new record validation')

    def test_observed_requires_original_failure_consistency_and_valid_legacy_unknown_is_canonical(self):
        from unittest.mock import patch
        import tracking_storage as storage
        import producer_phase
        for case in ('legacy','observed','wrong_diagnostic','refused'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=receipt(root);destination=root/'public'
                value=closed() if case=='legacy' else closed('refused') if case=='refused' else closed('observed','postgresql_acquire',('a19',))
                if case!='legacy':
                    # Valid but deliberately noncanonical formatting must never be raw copied.
                    (output/facts.NAME).write_text(json.dumps(value,indent=2));(output/facts.NAME).chmod(0o600)
                if case=='observed':
                    diagnostic=storage.diagnostics.Diagnostic('tracking');diagnostic.start('trace_validation');diagnostic.fail('trace_gate_06_unexpected_key');diagnostic.persist(output/storage.diagnostics.NAME)
                with patch.object(storage.ci,'read_command',return_value=SOURCE) as command:
                    if case=='wrong_diagnostic':
                        with self.assertRaises(ValueError):storage.collect(output,metadata,destination)
                        self.assertFalse(destination.exists());continue
                    storage.collect(output,metadata,destination);command.assert_called_once()
                self.assertEqual(producer_phase.read_unexpected_keys(destination/facts.NAME,source=SOURCE),value)
                self.assertEqual((destination/facts.NAME).read_bytes(),(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode())
                self.assertEqual(json.loads((destination/'source.json').read_text())['inputs'],{'legacy-source':'c'*64})


class PersistenceContracts(unittest.TestCase):
    def test_new_writer_keeps_real_owned_pin_and_foreign_recreated_temp(self):
        import producer_phase
        from test_emitter_phase import assert_live_temporary_pin
        assert_live_temporary_pin(self,lambda path:producer_phase.write_unexpected_keys(path.with_name(facts.NAME),closed(),source=SOURCE),
            '.tracking-unexpected-keys.json.new',ValueError)

    def test_new_writer_faults_attempt_all_owned_closes_without_retrying_foreign_reuse(self):
        import os
        import stat
        from contextlib import ExitStack
        from unittest.mock import patch
        import producer_phase as phase
        from test_emitter_phase import rescue_fixture_descriptors
        for stage in ('open_temp','dup','write','zero_write','replace','cleanup','writer_close','pin_close','directory_close','interrupt','system_exit'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();path=root/facts.NAME;records=[];active={};foreign=[];pins=[]
                original={name:getattr(os,name) for name in ('open','close','dup','fstat','write','replace','unlink')}
                primary=KeyboardInterrupt() if stage=='interrupt' else SystemExit(2) if stage=='system_exit' else OSError('private primary')
                secondary=OSError('private secondary');operation_failed=False
                def remember(fd):
                    info=original['fstat'](fd);entry=dict(fd=fd,dev=info.st_dev,ino=info.st_ino,active=True,attempts=0,directory=stat.S_ISDIR(info.st_mode))
                    records.append(entry);active[fd]=entry;return fd
                def opened(*args,**kwargs):
                    if stage=='open_temp' and kwargs.get('dir_fd') is not None:raise primary
                    return remember(original['open'](*args,**kwargs))
                def duplicate(fd):
                    if stage=='dup':raise primary
                    pin=remember(original['dup'](fd));pins.append(pin);return pin
                def write(fd,raw):
                    if stage=='write':raise primary
                    if stage=='zero_write':return 0
                    return original['write'](fd,raw)
                def replace(*args,**kwargs):
                    nonlocal operation_failed
                    if stage in ('replace','cleanup','interrupt','system_exit'):
                        operation_failed=True;raise primary
                    return original['replace'](*args,**kwargs)
                def unlink(*args,**kwargs):
                    if stage=='cleanup':raise secondary
                    return original['unlink'](*args,**kwargs)
                def close(fd):
                    entry=active[fd];entry['attempts']+=1;entry['active']=False;original['close'](fd)
                    if (stage=='writer_close' and not entry['directory'] and fd not in pins
                            or stage=='pin_close' and fd in pins or stage=='directory_close' and entry['directory']):
                        reused=original['open'](root/'foreign',os.O_CREAT|os.O_RDWR,0o600);info=original['fstat'](reused)
                        foreign.append(dict(fd=reused,dev=info.st_dev,ino=info.st_ino,active=True));raise primary
                    if operation_failed and stage in ('interrupt','system_exit'):raise secondary
                try:
                    with ExitStack() as stack:
                        for name,operation in (('open',opened),('dup',duplicate),('write',write),('replace',replace),('unlink',unlink),('close',close)):
                            stack.enter_context(patch.object(os,name,side_effect=operation))
                        caught=None
                        try:phase.write_unexpected_keys(path,closed(),source=SOURCE)
                        except BaseException as error:caught=error
                    if stage in ('interrupt','system_exit'):self.assertIs(caught,primary)
                    else:self.assertIsInstance(caught,ValueError);self.assertEqual(str(caught),facts.MESSAGE)
                    self.assertLessEqual(len(pins),1)
                    for entry in records:self.assertEqual(entry['attempts'],1)
                    for entry in foreign:
                        held=original['fstat'](entry['fd']);self.assertEqual((held.st_dev,held.st_ino),(entry['dev'],entry['ino']))
                    self.assertEqual(path.exists(),stage in ('pin_close','directory_close'))
                finally:rescue_fixture_descriptors([*records,*foreign],fstat=original['fstat'],close=original['close'])

    def test_new_record_refuses_unsafe_files_collision_partial_write_and_drift(self):
        import os
        from unittest.mock import patch
        import producer_phase as phase
        for case in ('mode','symlink','hardlink','fifo','directory','collision','partial','drift'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();path=root/facts.NAME;temporary=root/'.tracking-unexpected-keys.json.new'
                if case=='collision':
                    temporary.write_bytes(b'foreign');temporary.chmod(0o600)
                    with self.assertRaises(ValueError):phase.write_unexpected_keys(path,closed(),source=SOURCE)
                    self.assertEqual(temporary.read_bytes(),b'foreign');self.assertFalse(path.exists());continue
                phase.write_unexpected_keys(path,closed(),source=SOURCE)
                if case=='mode':path.chmod(0o644)
                elif case=='symlink':path.rename(root/'held');path.symlink_to(root/'held')
                elif case=='hardlink':os.link(path,root/'held')
                elif case=='fifo':path.unlink();os.mkfifo(path,0o600)
                elif case=='directory':path.unlink();path.mkdir(mode=0o700)
                elif case=='partial':
                    original=os.write
                    with patch.object(os,'write',side_effect=lambda fd,raw:original(fd,raw[:3])):
                        phase.write_unexpected_keys(path,closed('observed','root',('a01',)),source=SOURCE)
                    self.assertEqual(phase.read_unexpected_keys(path,source=SOURCE),closed('observed','root',('a01',)))
                    self.assertEqual(path.stat().st_mode&0o777,0o600);self.assertFalse(temporary.exists());continue
                elif case=='drift':
                    original=os.read;changed=[]
                    def read(fd,size):
                        raw=original(fd,size)
                        if not changed:
                            changed.append(True);path.unlink();path.write_text(json.dumps(closed()));path.chmod(0o600)
                        return raw
                    with patch.object(os,'read',side_effect=read):
                        with self.assertRaises(ValueError):phase.read_unexpected_keys(path,source=SOURCE)
                    continue
                with self.assertRaises(ValueError):phase.read_unexpected_keys(path,source=SOURCE)
                with self.assertRaises(ValueError):phase.write_unexpected_keys(path,closed(),source=SOURCE)
                self.assertFalse(temporary.exists())

    def test_exit_is_once_and_never_replaces_primary_or_its_traceback(self):
        from unittest.mock import patch
        import producer_phase
        class Hostile(RuntimeError):
            def with_traceback(self,*_):raise AssertionError('overridden traceback method')
        for kind in (KeyboardInterrupt,SystemExit,Hostile):
            for same in (False,True):
                with self.subTest(kind=kind.__name__,same=same),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory).resolve();owner=facts.create(output);facts.bind_source(owner,SOURCE)
                    primary=kind('private');secondary=primary if same else OSError('private secondary')
                    def persist(*_args,**_kwargs):raise secondary
                    try:raise primary
                    except BaseException as original:
                        tb=BaseException.__traceback__.__get__(original)
                        with patch.object(producer_phase,'write_unexpected_keys',side_effect=persist) as write:
                            self.assertFalse(owner.__exit__(kind,original,tb));self.assertFalse(owner.__exit__(kind,original,tb))
                            write.assert_called_once()
                        self.assertIs(BaseException.__traceback__.__get__(original),tb);self.assertIs(original,primary)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(producer_phase,'write_unexpected_keys',side_effect=OSError('private')):
                with self.assertRaisesRegex(ValueError,'^closed tracking unexpected-key observation refused$'):
                    with facts.create(Path(directory).resolve()) as owner:facts.bind_source(owner,SOURCE)

    def test_worker_persists_only_after_original_result_diagnostic_and_storage_cleanup(self):
        import contextlib
        import os
        from types import SimpleNamespace
        from unittest.mock import patch
        from contextlib import ExitStack
        import producer_phase
        import tracking_storage as storage
        for failed in (False,True):
            with self.subTest(failed=failed),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();(root/'owner.json').write_text(json.dumps({'project':'owned','supervisor_pid':os.getppid()}));(root/'compose.json').write_text('{}')
                events=[];primary=RuntimeError('private capture');original_write=producer_phase.write_unexpected_keys
                @contextlib.contextmanager
                def guard(*_args):
                    try:yield
                    finally:events.append('storage_cleanup')
                def capture(**_kwargs):
                    if failed:raise primary
                    return {}
                def stored(**kwargs):
                    rows=trace_rows();rows[-1]['span_attr:messaging.message.id']='private'
                    return tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT,observation=kwargs['observation'])
                def persisted(path,value,**kwargs):events.append('unexpected');original_write(path,value,**kwargs)
                def result(path,_value):
                    if path.name=='tracking-storage.json':events.append('result')
                with ExitStack() as stack:
                    for target,name,value in ((storage.pilot,'worker_storage_guard',guard),(storage.pilot,'install_plugin',lambda *_:None),
                        (storage.pilot,'command',lambda *_args,**_kwargs:'none'),(storage.ownership,'plan',lambda *_:{}),
                        (storage.ownership,'TrackingTargets',lambda *_:SimpleNamespace(targets={'alloy':{'id':'a'},'postgres':{'id':'p'}})),
                        (storage.pilot,'verify_trace_store_logging',lambda *_:None),(storage.pilot,'await_otlp_ready',lambda **_:None),
                        (storage.source_status_query,'_read_private_token',lambda *_:'owned'),(storage.pilot,'await_fact',lambda *_args,**_kwargs:None),
                        (storage.ci,'read_command',lambda *_:SOURCE),(storage.producer_protocol,'capture',capture),
                        (storage.producer_protocol,'witness',lambda *_:{'runtime_modules':{}}),(storage.pilot,'write_json',result),
                        (storage.diagnostics.Diagnostic,'persist',lambda *_:events.append('diagnostic')),
                        (storage,'stored_metrics_and_traces',stored),(producer_phase,'write_unexpected_keys',persisted)):
                        stack.enter_context(patch.object(target,name,side_effect=value))
                    captured=None
                    try:storage.worker(root)
                    except RuntimeError as error:captured=error
                if failed:self.assertIs(captured,primary)
                else:self.assertEqual(captured.diagnostic_reason,'trace_gate_06_unexpected_key')
                self.assertEqual(events,['storage_cleanup','result','diagnostic','unexpected'])
                self.assertEqual(json.loads((root/facts.NAME).read_text()),closed() if failed else closed('observed','postgresql_acquire',('a19',)))


if __name__=='__main__':unittest.main()
