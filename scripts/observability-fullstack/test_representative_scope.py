"""Actual owned-file/subprocess transfer. All namespace receipts are SOURCE-MODEL on Mac."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import representative_scope as scopes
import test_representative_owner as owner_tests
from test_signoz_queries import START,CUT

MODEL={'start_ticks':'123456','netns':'net:[123]','pidns':'pid:[456]'}


class NativeScope(unittest.TestCase):
    prepare=owner_tests.NativeOwner.prepare
    def test_mint_serializes_dispatch_and_consumes_generation_before_next_read(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                self.assertEqual(len(dispatch.digest),64)
                self.assertNotIn('scope',repr(dispatch))
                with self.assertRaises(ValueError):scopes.mint(owner,4,START,CUT+1)
                dispatch.close()
                with patch.object(scopes.time,'time',return_value=(CUT+2000)/1000):next_dispatch=scopes.mint(owner,4,START,CUT+2000)
                self.assertNotEqual(dispatch.digest,next_dispatch.digest)
                next_dispatch.close()
                with self.assertRaisesRegex(ValueError,'replay'):scopes.mint(owner,4,START,CUT)
            receipt=json.loads((output/'representative-owner/resources.json').read_text())
            self.assertEqual(receipt['generation'],2);self.assertIsNone(receipt['dispatch'])
            self.assertTrue(owner.cleanup_exact())

import os
import signal
import subprocess
import sys
import signoz_queries


class SubprocessScope(unittest.TestCase):
    prepare=owner_tests.NativeOwner.prepare

    def helper(self,output,digest,*,change='',body='',timeout=10):
        # Fixed paths are baked into this owned SOURCE-MODEL helper. Digest is the
        # ONLY invocation argument, exactly like the trusted Engine exec channel.
        driver=output/'signoz/driver';private=output/'signoz/private/representative-scope'
        script=output/'model-helper.py'
        script.write_text('import sys,json\nfrom pathlib import Path\n'
            +'sys.path.insert(0,'+repr(str(driver/'scripts/observability-fullstack'))+')\n'
            +'import representative_scope as scopes\n'
            +'scopes._PRIVATE=Path('+repr(str(private))+')\n'
            +'scopes._process_receipt=lambda pid:'+repr(MODEL)+'\n'
            +'scopes.time.time=lambda:'+repr(CUT/1000)+'\n'+change+'\n'
            +'scope=scopes.load_current(sys.argv[1])\n'
            +'import signoz_queries as queries\n'
            +'reader=queries.RepresentativeReads.from_native_scope(scope)\n'
            +"assert 'fullstack' not in sys.modules and 'representative_owner' not in sys.modules\n"
            +(body or "request=reader.prepare('retained_probes',{})\nprint(json.dumps({'binding':reader.binding,'payload':request.payload}))\n"))
        proc=subprocess.Popen([sys.executable,'-I','-B',str(script),digest],stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:
            stdout,stderr=proc.communicate(timeout=timeout)
            return proc.returncode,stdout,stderr
        finally:
            if proc.poll() is None:os.killpg(proc.pid,signal.SIGKILL)
            proc.wait(timeout=2)
            proc.stdout.close();proc.stderr.close()

    def test_owned_file_to_helper_matches_existing_payload_at_two_live_cuts(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            for cut in (CUT-2000,CUT):
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=cut/1000):
                    with scopes.mint(owner,4,START,cut) as dispatch:
                        code,stdout,stderr=self.helper(output,dispatch.digest)
                        self.assertEqual(code,0,stderr.decode())
                        value=json.loads(stdout)
                        reader=signoz_queries.RepresentativeReads(layout,4,START,cut)
                        self.assertEqual(value,{'binding':reader.binding,'payload':reader.prepare('retained_probes',{}).payload})
            self.assertTrue(owner.cleanup_exact())

    def test_helper_refuses_digest_replay_import_substitution_and_detached_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                try:
                    for change in (
                        "scopes._process_receipt=lambda pid:{'start_ticks':'different','netns':'net:[123]','pidns':'pid:[456]'}",
                        "import types\nsys.modules['core_layout']=types.SimpleNamespace(__file__='/foreign/core_layout.py')",
                        "scopes.load_current(sys.argv[1])",
                        "scopes.time.monotonic_ns=lambda:2**63-1",
                        "scopes.time.time=lambda:0",
                    ):
                        code,stdout,stderr=self.helper(output,dispatch.digest,change=change)
                        self.assertNotEqual(code,0,change);self.assertEqual(stdout,b'')
                    code,stdout,stderr=self.helper(output,'f'*64)
                    self.assertNotEqual(code,0);self.assertIn(b'representative_scope_digest',stderr)
                    body="queries.RepresentativeReads.from_native_scope(scope)\n"
                    self.assertNotEqual(self.helper(output,dispatch.digest,body=body)[0],0)
                    body="scopes._PRIVATE.joinpath('current.json').unlink()\nreader.prepare('retained_probes',{})\n"
                    code,stdout,stderr=self.helper(output,dispatch.digest,body=body)
                    self.assertNotEqual(code,0)
                    # Helper cannot write the real readonly bind. SOURCE-MODEL test
                    # intentionally has host filesystem authority, so restore same inode
                    # is impossible and controller close must refuse replacement.
                    path=output/'signoz/private/representative-scope/current.json'
                    self.assertFalse(path.exists())
                finally:
                    with self.assertRaises(FileNotFoundError):dispatch.close()
                    (output/'signoz/private/representative-scope').rmdir()
            self.assertTrue(owner.cleanup_exact())

    def test_closed_schema_and_filesystem_tampering_refuse_before_queries(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                path=output/'signoz/private/representative-scope/current.json';original=path.read_bytes()
                document=json.loads(original)
                forged=document|{'binding':document['binding']|{'source':{'commit':'f'*40,'tree':'e'*40}}}
                forged_raw=scopes._encoded(forged);path.write_bytes(forged_raw)
                self.assertNotEqual(scopes._sha(forged_raw),dispatch.digest)
                code,stdout,stderr=self.helper(output,dispatch.digest)
                self.assertNotEqual(code,0);self.assertIn(b'representative_scope_digest',stderr)
                for key,value in [('generation',True),('phase',True),('phase',14),('pair',True),('cut_ms',CUT+1),
                    ('start_ms',0),('mode','off'),('cohort','foreign'),('deadline_mono_ns',True),('unknown',1),
                    ('web',{'ok':True}),('binding',document['binding']|{'extra':True})]:
                    changed=document|{key:value};raw=scopes._encoded(changed);path.write_bytes(raw)
                    code,stdout,stderr=self.helper(output,scopes._sha(raw))
                    self.assertNotEqual(code,0,(key,value));self.assertEqual(stdout,b'')
                for raw in (b'{"schema":1,"schema":1}',b'NaN',b'{}'+b' '*32769):
                    path.write_bytes(raw)
                    self.assertNotEqual(self.helper(output,scopes._sha(raw))[0],0)
                path.write_bytes(original)
                # Hardlinks, symlinks and fresh identical bytes cannot replace ownership.
                extra=path.with_name('extra');os.link(path,extra)
                self.assertNotEqual(self.helper(output,dispatch.digest)[0],0);extra.unlink()
                path.chmod(0o644);self.assertNotEqual(self.helper(output,dispatch.digest)[0],0);path.chmod(0o600)
                mirror=output/'signoz/driver/scripts/observability-signoz/metric_recipe.py';old=mirror.read_bytes()
                mirror.write_bytes(old+b'\n')
                self.assertNotEqual(self.helper(output,dispatch.digest)[0],0);mirror.write_bytes(old)
                path.rename(extra);path.symlink_to(extra)
                self.assertNotEqual(self.helper(output,dispatch.digest)[0],0);path.unlink();extra.rename(path)
                path.rename(extra);path.write_bytes(original);path.chmod(0o600)
                with self.assertRaisesRegex(ValueError,'replacement'):dispatch.close()
                path.unlink();extra.unlink();path.parent.rmdir()
            self.assertTrue(owner.cleanup_exact())

    def test_mint_rejects_future_stale_bool_web_agent_and_caller_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                for phase,start,cut,web in [(True,START,CUT,None),(4,START,CUT+1,None),(4,START,CUT-1001,None),
                    (4,True,CUT,None),(4,START,CUT,{'ok':True,'positive_count':True,'not_found_count':1,'process_start_seconds':1,'observed_at_seconds':2})]:
                    with self.subTest(phase=phase,cut=cut),self.assertRaises(ValueError):scopes.mint(owner,phase,start,cut,web)
                for foreign in (layout,{},object()):
                    with self.assertRaises(ValueError):scopes.mint(foreign,4,START,CUT)
                    with self.assertRaises(ValueError):signoz_queries.RepresentativeReads.from_native_scope(foreign)
            self.assertTrue(owner.cleanup_exact())

    def test_fixed_exec_uses_only_digest_and_preserves_first_failure_after_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            original=native.call;seen=[]
            def call(args,timeout=10):
                if args[0]=='exec':
                    seen.append(args)
                    self.assertEqual(args[2:6],['python','-I','-B','/driver/scripts/observability-fullstack/representative_scope.py'])
                    self.assertEqual(len(args),7)
                    path=output/'signoz/private/representative-scope/current.json'
                    document=json.loads(path.read_text())
                    return json.dumps({'scope_verified':True,'generation':document['generation'],'digest':args[-1]})
                return original(args,timeout)
            native.call=call
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                self.assertEqual(dispatch.execute(),{'ok':True});self.assertEqual(len(seen),1)
                with self.assertRaises(ValueError):dispatch.execute()
                with patch.object(scopes.time,'time',return_value=(CUT+1000)/1000):
                    dispatch=scopes.mint(owner,4,START,CUT+1000)
                    def fail(args,timeout=10):
                        if args[0]=='exec':
                            path=output/'signoz/private/representative-scope/current.json'
                            path.rename(path.with_name('old'));path.write_text('replacement');path.chmod(0o600)
                            raise RuntimeError('first-native-error')
                        return original(args,timeout)
                    native.call=fail
                    with self.assertRaisesRegex(RuntimeError,'first-native-error'):dispatch.execute()
                    for path in (output/'signoz/private/representative-scope').iterdir():path.unlink()
                    (output/'signoz/private/representative-scope').rmdir()
            self.assertTrue(owner.cleanup_exact())

    def test_extra_mirror_module_is_refused_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with scopes.mint(owner,4,START,CUT) as dispatch:
                    foreign=output/'signoz/driver/scripts/observability-fullstack/representative_owner.py'
                    foreign.write_text("raise RuntimeError('foreign-import')\n");foreign.chmod(0o600)
                    code,stdout,stderr=self.helper(output,dispatch.digest)
                    self.assertNotEqual(code,0);self.assertNotIn(b'foreign-import',stderr)
                    foreign.unlink()
            self.assertTrue(owner.cleanup_exact())


    def test_all_ten_payloads_and_parser_zero_unavailable_unknown_survive_transfer(self):
        from test_signoz_queries import response,SOURCE_COLUMNS,SOURCE
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            web={'ok':True,'positive_count':3,'not_found_count':2,'process_start_seconds':(START-1000)/1000,'observed_at_seconds':(CUT-2000)/1000}
            rows=[['postgresql',0,(CUT-1000)/1000,CUT-500,CUT-500,1,1,0,0,0,CUT],
                  ['caddy',1,(CUT-2000)/1000,CUT-500,CUT-500,1,1,0,0,0,CUT]]
            unavailable=response(SOURCE_COLUMNS,rows);rows[0][3]=CUT+1
            unknown=response(SOURCE_COLUMNS,rows)
            zero=response(('raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples','first_ms','last_ms'),[[0]*8])
            body="requests={op:reader.prepare(op,{}) for op in queries.OPERATIONS}\n"
            body+="result={'payloads':{op:request.payload for op,request in requests.items()}}\n"
            for name,op,raw in [('zero','retained_probes',zero),('unavailable','source_status',unavailable),('unknown','source_status',unknown)]:
                body+='result['+repr(name)+']=reader.observe(requests['+repr(op)+'],200,'+repr(raw)+')\n'
            body+='print(json.dumps(result))\n'
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with scopes.mint(owner,4,START,CUT,web) as dispatch:
                    code,stdout,stderr=self.helper(output,dispatch.digest,body=body)
                    self.assertEqual(code,0,stderr.decode());value=json.loads(stdout)
                    expected=signoz_queries.RepresentativeReads(layout,4,START,CUT,web=web)
                    self.assertEqual(value['payloads'],{op:expected.prepare(op,{}).payload for op in signoz_queries.OPERATIONS})
                    self.assertEqual(value['zero'],{'ok':True,'count':0})
                    self.assertEqual(value['unavailable']['reason'],'unavailable')
                    self.assertEqual(value['unavailable']['sources']['postgresql']['available'],0)
                    self.assertFalse(value['unknown']['ok'])
            self.assertTrue(owner.cleanup_exact())

    def test_tiny_helper_timeout_reaps_only_owned_process_and_closes_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            unrelated=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True,
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                    with scopes.mint(owner,4,START,CUT) as dispatch:
                        with self.assertRaises(subprocess.TimeoutExpired):
                            self.helper(output,dispatch.digest,body='import time;time.sleep(60)\n',timeout=.2)
                    self.assertIsNone(unrelated.poll())
                    self.assertFalse((output/'signoz/private/representative-scope').exists())
            finally:os.killpg(unrelated.pid,signal.SIGKILL);unrelated.wait(timeout=2)
            self.assertTrue(owner.cleanup_exact())

    def test_crash_recovery_consumes_registered_generation_without_replaying_it(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                self.assertFalse((output/'signoz/private/representative-scope').exists())
                with self.assertRaises((ValueError,OSError)):dispatch.execute()
                self.assertTrue(recovered.cleanup_exact())

    def test_dispatch_ack_is_closed_typed_and_duplicate_free(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            original=native.call
            for index,kind in enumerate(('bool_generation','numeric_verified','duplicate','extra','wrong_digest'),1):
                def call(args,timeout=10):
                    if args[0]!='exec':return original(args,timeout)
                    document=json.loads((output/'signoz/private/representative-scope/current.json').read_text())
                    value={'scope_verified':True,'generation':document['generation'],'digest':args[-1]}
                    if kind=='bool_generation':value['generation']=True
                    elif kind=='numeric_verified':value['scope_verified']=1
                    elif kind=='extra':value['extra']=1
                    elif kind=='wrong_digest':value['digest']='f'*64
                    raw=json.dumps(value)
                    if kind=='duplicate':raw=raw[:-1]+',"generation":'+str(document['generation'])+'}'
                    return raw
                native.call=call
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=(CUT+index)/1000):
                    dispatch=scopes.mint(owner,4,START,CUT+index)
                    with self.subTest(kind=kind),self.assertRaises(ValueError):dispatch.execute()
            self.assertTrue(owner.cleanup_exact())


    def test_expired_consume_keeps_exact_scope_for_recovery_in_original_cleanup_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            original_deadline=native.deadline
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                path=output/'signoz/private/representative-scope/current.json';identity=(path.stat().st_dev,path.stat().st_ino)
                with patch.object(owner_tests.owners.time,'monotonic',return_value=original_deadline+1):
                    with self.assertRaisesRegex(ValueError,'deadline'):dispatch.close()
                    self.assertTrue(path.exists(),'failed durable consumption must preserve recoverable inode')
                    self.assertEqual((path.stat().st_dev,path.stat().st_ino),identity)
                    recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                    self.assertFalse(path.exists());self.assertTrue(recovered.cleanup_exact())
                    self.assertLessEqual(native.deadline,original_deadline+90)



class RemediationScope(unittest.TestCase):
    prepare=owner_tests.NativeOwner.prepare

    def native_ack(self,native,output):
        original=native.call
        def call(args,timeout=10):
            if args[0]!='exec':return original(args,timeout)
            native.calls.append(list(args))
            value=json.loads((output/'signoz/private/representative-scope/current.json').read_text())
            return json.dumps({'scope_verified':True,'generation':value['generation'],'digest':args[-1]})
        native.call=call

    def test_context_managed_execute_succeeds_and_replay_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            self.native_ack(native,output)
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with scopes.mint(owner,4,START,CUT) as dispatch:self.assertEqual(dispatch.execute(),{'ok':True})
                with self.assertRaises(ValueError):dispatch.execute()
            self.assertTrue(owner.cleanup_exact())

    def test_concurrent_execute_claims_one_generation_once(self):
        import threading
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            self.native_ack(native,output);returned=threading.Event();release=threading.Event();results=[]
            original=owner_tests.owners.CompositeOwner._scope_exec
            def pause(own,generation,digest):
                raw=original(own,generation,digest)
                if threading.current_thread().name=='first-dispatch':returned.set();self.assertTrue(release.wait(5))
                return raw
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                def execute():
                    try:results.append(dispatch.execute())
                    except BaseException as error:results.append(error)
                with patch.object(owner_tests.owners.CompositeOwner,'_scope_exec',pause):
                    first=threading.Thread(target=execute,name='first-dispatch');second=threading.Thread(target=execute,name='second-dispatch')
                    try:
                        first.start();self.assertTrue(returned.wait(5));second.start();second.join(1)
                    finally:release.set();first.join(5);second.join(5)
                self.assertFalse(first.is_alive());self.assertFalse(second.is_alive())
                self.assertEqual(sum(args[0]=='exec' for args in native.calls),1)
                self.assertEqual(results.count({'ok':True}),1)
                self.assertEqual(sum(isinstance(result,ValueError) for result in results),1)
                self.assertIsNone(json.loads((output/'representative-owner/resources.json').read_text())['dispatch'])
            self.assertTrue(owner.cleanup_exact())

    def test_crash_before_scope_receipt_preserves_unknown_inode_and_cleans_native(self):
        class Crash(BaseException):pass
        for stage in ('directory','file'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
                target=output/'signoz/private/representative-scope';original_directory=scopes._directory;original_write=scopes._write
                def check(path):
                    if path==target:raise Crash('after-directory-creation')
                    return original_directory(path)
                def write(path,raw,*args,**kwargs):
                    result=original_write(path,raw,*args,**kwargs)
                    if path==target/'current.json':raise Crash('after-file-fsync')
                    return result
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                    with patch.object(scopes.Dispatch,'close',side_effect=Crash('process-gone')):
                        with patch.object(scopes,'_directory',check) if stage=='directory' else patch.object(scopes,'_write',write):
                            with self.assertRaises(Crash):scopes.mint(owner,4,START,CUT)
                recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                if target.exists():
                    identity=(target.stat().st_dev,target.stat().st_ino)
                    with self.assertRaises((ValueError,OSError)):recovered.cleanup_exact()
                    self.assertEqual((target.stat().st_dev,target.stat().st_ino),identity)
                    self.assertFalse(json.loads((output/'representative-owner/cleanup.json').read_text())['passed'])
                else:self.assertTrue(recovered.cleanup_exact())
                self.assertEqual(native.acquired,set())

    def test_consumed_scope_retains_cleanup_pointer_until_unlink_completes(self):
        class Crash(BaseException):pass
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            target=output/'signoz/private/representative-scope/current.json';original=Path.unlink
            def unlink(path,*args,**kwargs):
                if path==target:raise Crash('after-consume-before-unlink')
                return original(path,*args,**kwargs)
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                with patch.object(Path,'unlink',unlink),self.assertRaises(Crash):dispatch.close()
                self.assertTrue(target.exists())
                recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                self.assertFalse(target.exists(),'durable consume must retain the exact cleanup pointer')
                with self.assertRaises((ValueError,OSError)):dispatch.execute()
                self.assertTrue(recovered.cleanup_exact())


    def test_execute_close_and_failure_recovery_races_preserve_first_native_error(self):
        import threading
        for action in ('close_success','close_failure','recover_failure'):
            with self.subTest(action=action),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
                self.native_ack(native,output);original_call=native.call
                first_error=RuntimeError('first-native-error');results={};returned=threading.Event();release=threading.Event();closing=threading.Event()
                def call(args,timeout=10):
                    result=original_call(args,timeout)
                    if args[0]=='exec' and action!='close_success':raise first_error
                    return result
                native.call=call;original_exec=owner_tests.owners.CompositeOwner._scope_exec
                def pause(own,generation,digest):
                    try:return original_exec(own,generation,digest)
                    finally:returned.set();self.assertTrue(release.wait(5))
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                    dispatch=scopes.mint(owner,4,START,CUT)
                    def execute():
                        try:results['execute']=dispatch.execute()
                        except BaseException as error:results['execute']=error
                    def close():
                        closing.set()
                        try:results['close']=dispatch.close()
                        except BaseException as error:results['close']=error
                    with patch.object(owner_tests.owners.CompositeOwner,'_scope_exec',pause):
                        worker=threading.Thread(target=execute);closer=None;recovered=None
                        try:
                            worker.start();self.assertTrue(returned.wait(5))
                            if action=='recover_failure':
                                recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                            else:
                                closer=threading.Thread(target=close);closer.start();self.assertTrue(closing.wait(5))
                        finally:
                            release.set();worker.join(5)
                            if closer is not None:closer.join(5)
                    self.assertFalse(worker.is_alive())
                    if closer is not None:self.assertFalse(closer.is_alive());self.assertIsInstance(results['close'],ValueError)
                    if action=='close_success':self.assertEqual(results['execute'],{'ok':True})
                    else:self.assertIs(results['execute'],first_error)
                    self.assertEqual(sum(args[0]=='exec' for args in native.calls),1)
                    with self.assertRaises((ValueError,OSError)):dispatch.execute()
                self.assertTrue((recovered or owner).cleanup_exact());self.assertEqual(native.acquired,set())

    def test_scope_record_failure_and_expiry_recover_each_registered_acquisition(self):
        for expired in (False,True):
            with self.subTest(expired=expired),tempfile.TemporaryDirectory() as directory:
                output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
                deadline=native.deadline;first=RuntimeError('first-scope-record-failure')
                clock=[owner_tests.owners.time.monotonic()];original_record=owner_tests.owners.CompositeOwner._scope_record
                def record(own,*args):
                    if not expired:raise first
                    clock[0]=deadline+1
                    return original_record(own,*args)
                with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                    with patch.object(owner_tests.owners.CompositeOwner,'_scope_record',record),patch.object(owner_tests.owners.time,'monotonic',side_effect=lambda:clock[0]):
                        with self.assertRaises(ValueError if expired else RuntimeError) as caught:scopes.mint(owner,4,START,CUT)
                    if expired:self.assertIn('deadline',str(caught.exception))
                    else:self.assertIs(caught.exception,first)
                    target=output/'signoz/private/representative-scope'
                    if expired:
                        pending=json.loads((output/'representative-owner/resources.json').read_text())['dispatch']
                        self.assertEqual(pending['status'],'minting');self.assertIsNotNone(pending['directory']);self.assertIsNotNone(pending['file'])
                    with patch.object(owner_tests.owners.time,'monotonic',return_value=deadline+1):
                        recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                        self.assertFalse(target.exists());self.assertTrue(recovered.cleanup_exact());self.assertLessEqual(native.deadline,deadline+90)
                    self.assertEqual(native.acquired,set())

    def test_context_failure_after_successful_execute_keeps_original_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk');self.native_ack(native,output)
            first=RuntimeError('context-primary-error')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with self.assertRaises(RuntimeError) as caught:
                    with scopes.mint(owner,4,START,CUT) as dispatch:
                        self.assertEqual(dispatch.execute(),{'ok':True});raise first
                self.assertIs(caught.exception,first)
            self.assertTrue(owner.cleanup_exact())


    def test_recovery_rejects_every_malformed_inflight_identity_before_worker_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                path=output/'representative-owner/resources.json';original=path.read_bytes();record=json.loads(original);pending=record['dispatch']
                changes=[pending|{'generation':True},pending|{'generation':2},pending|{'status':'unknown'},pending|{'digest':True},
                    pending|{'file':None},pending|{'directory':None},pending|{'file':[1,True,os.getuid()]},
                    pending|{'directory':pending['directory']+[1]},pending|{'extra':1}]
                changes += [{k:v for k,v in pending.items() if k!=field} for field in pending]
                for changed in changes:
                    path.write_text(json.dumps(record|{'dispatch':changed}));before=list(native.calls)
                    with self.subTest(changed=changed),patch.object(owner_tests.owners,'_stop_worker') as stop:
                        with self.assertRaises(ValueError):owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
                        stop.assert_not_called();self.assertEqual(native.calls,before)
                path.write_bytes(original);dispatch.close()
            self.assertTrue(owner.cleanup_exact())

    def test_process_death_after_file_open_preserves_unregistered_inode_and_cleans_native(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            target=output/'signoz/private/representative-scope/current.json'
            child=os.fork()
            if child==0:
                try:
                    os.setsid();original=owner_tests.owners.CompositeOwner._scope_acquire
                    def acquire(own,generation,**receipt):
                        if 'file' in receipt:os._exit(23)
                        return original(own,generation,**receipt)
                    with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000),patch.object(owner_tests.owners.CompositeOwner,'_scope_acquire',acquire):
                        scopes.mint(owner,4,START,CUT)
                except BaseException:os._exit(24)
                os._exit(25)
            reaped=False
            try:
                import time
                end=time.monotonic()+5
                while True:
                    done,status=os.waitpid(child,os.WNOHANG)
                    if done:reaped=True;break
                    if time.monotonic()>=end:
                        os.kill(child,signal.SIGKILL);os.waitpid(child,0);reaped=True;self.fail('owned mint child timed out')
                    time.sleep(.01)
                self.assertEqual(os.waitstatus_to_exitcode(status),23)
            finally:
                if not reaped:
                    try:os.kill(child,signal.SIGKILL);os.waitpid(child,0)
                    except ProcessLookupError:pass
            self.assertTrue(target.exists());self.assertEqual(target.read_bytes(),b'')
            identity=(target.stat().st_dev,target.stat().st_ino)
            pending=json.loads((output/'representative-owner/resources.json').read_text())['dispatch']
            self.assertIsNotNone(pending['directory']);self.assertIsNone(pending['file'])
            recovered=owner_tests.owners.CompositeOwner.recover(native,output,owner_tests.BINDINGS,owner_tests.pins())
            with self.assertRaises(ValueError):recovered.cleanup_exact()
            self.assertEqual(native.acquired,set());self.assertEqual((target.stat().st_dev,target.stat().st_ino),identity)
            self.assertFalse(json.loads((output/'representative-owner/cleanup.json').read_text())['passed'])


if __name__=='__main__':unittest.main()


class ReaderDispatch(unittest.TestCase):
    prepare=owner_tests.NativeOwner.prepare
    def test_read_uses_literal_entrypoint_same_generation_and_preserves_verify_only(self):
        with tempfile.TemporaryDirectory() as directory:
            output,native,owner,layout=self.prepare(Path(directory).resolve());owner.create();owner.start('sig-disk')
            original=native.call;commands=[]
            def call(args,timeout=10):
                if args[0]!='exec':return original(args,timeout)
                commands.append((args,timeout));document=json.loads((output/'signoz/private/representative-scope/current.json').read_text())
                if args[-2].endswith('representative_reader.py'):
                    return json.dumps({'read_verified':True,'generation':document['generation'],'digest':args[-1],'reads':10})
                return json.dumps({'scope_verified':True,'generation':document['generation'],'digest':args[-1]})
            native.call=call
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                with scopes.mint(owner,4,START,CUT) as dispatch:
                    self.assertEqual(dispatch.read(),{'ok':True})
                    with self.assertRaises(ValueError):dispatch.execute()
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=(CUT+1)/1000):
                with scopes.mint(owner,4,START,CUT+1) as dispatch:
                    self.assertEqual(dispatch.execute(),{'ok':True})
                    with self.assertRaises(ValueError):dispatch.read()
            self.assertTrue(commands[0][0][-2].endswith('/representative_reader.py'))
            self.assertTrue(commands[1][0][-2].endswith('/representative_scope.py'))
            self.assertTrue(all(timeout==10 and len(args)==7 for args,timeout in commands))
            self.assertTrue(owner.cleanup_exact())
