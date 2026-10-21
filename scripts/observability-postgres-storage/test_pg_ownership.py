"""PG-only derived fixture plan; actual private files, no daemon acquisition."""
import copy
import json
import os
import re
import time
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import postgres_source
import ownership as tracking


class PrivatePlan(unittest.TestCase):
    def test_actual_prepare_derives_private_synchronous_plan_without_changing_tracking(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private'
            postgres_source.ownership.prepare(output)
            actual=postgres_source.ownership.plan(output)
            self.assertEqual(actual['services']['metrics']['logging'],{'driver':'none'})
            self.assertTrue(actual==json.loads((output/'compose.json').read_text()),'private compose plan mismatch')
            self.assertEqual(actual['services']['metrics']['command'][-2:],['-envflag.enable=true','-envflag.prefix=INSIDE_PG_SOURCE_'])
            key=actual['services']['metrics']['environment']['INSIDE_PG_SOURCE_forceFlushAuthKey']
            self.assertTrue(re.fullmatch('[0-9a-f]{64}',key) is not None,'invalid private key format')
            self.assertNotIn(key,' '.join(actual['services']['metrics']['command']))
            baseline=tracking.plan(output);normalized=copy.deepcopy(actual)
            for field in ('logging','command'):
                normalized['services']['metrics'][field]=baseline['services']['metrics'][field]
            del normalized['services']['metrics']['environment']
            normalized['services']['alloy']['volumes']=baseline['services']['alloy']['volumes']
            self.assertEqual(normalized,baseline)
            text=(output/'postgres-completion.alloy').read_text()
            self.assertIn('timeout = "2s"',text)
            self.assertIn('sending_queue {\n    enabled = false\n  }',text)
            for name in ('postgres-completion-auth.json','postgres-completion.alloy','compose.json'):
                self.assertEqual(stat.S_IMODE((output/name).stat().st_mode),0o600)

    def test_auth_and_overlay_invalid_present_files_refuse_without_adoption(self):
        for fault in ('mode','link','duplicate','unknown','empty','config','collision'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve()/'private';postgres_source.ownership.prepare(output)
                auth=output/'postgres-completion-auth.json';held=auth.read_bytes()
                if fault=='mode':auth.chmod(0o644)
                elif fault=='link':
                    backup=output/'held-auth';auth.rename(backup);auth.symlink_to(backup.name)
                elif fault=='duplicate':auth.write_text('{"schema":1,"schema":1}')
                elif fault=='unknown':auth.write_text(json.dumps({'schema':1,'key':'a'*64,'extra':1}))
                elif fault=='empty':auth.write_text(json.dumps({'schema':1,'key':''}))
                elif fault=='config':(output/'postgres-completion.alloy').write_text('foreign config')
                else:
                    with self.assertRaises(FileExistsError):postgres_source.ownership._write(output,'postgres-completion-auth.json',held)
                    self.assertEqual(auth.read_bytes(),held);continue
                with self.assertRaises((ValueError,OSError)):postgres_source.ownership.plan(output)

    def targets(self,output):
        from test_source_status_scenario import FakePilot,PROJECT
        import pg_ownership
        pg_ownership.prepare(output);fake=FakePilot(output);fake.plan=pg_ownership.plan(output);fake.ids['postgres']='8'*64
        target=pg_ownership.Targets(output,fake.compose,fake.plan,fake.command)
        self.assertEqual(len(target.targets),8)
        self.assertEqual(set(json.loads((output/'tracking-pg-owned.json').read_text())),{'project','container','volume','networks'})
        self.assertEqual(target.postgres(),'8'*64)
        return target,fake

    def test_actual_core_registry_and_pg_target_preserve_old_identity_witnesses(self):
        with tempfile.TemporaryDirectory() as directory:
            target,fake=self.targets(Path(directory).resolve()/'private')
            witness=json.loads((target.output/'source-freshness-owned.json').read_text())
            self.assertEqual((len(witness['containers']),len(witness['volumes']),len(witness['networks'])),(7,4,2))
            fake.ids['postgres']='9'*64
            with self.assertRaises((ValueError,RuntimeError)):target.postgres()

    def test_exact_private_metrics_env_and_local_bridge_admission_refuse_foreign_state(self):
        import pg_ownership
        for fault in (None,'logging','env','extra_env','command','image','network','driver','internal','attachment','ip','gateway','bridge','remote','nonlinux'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                target,fake=self.targets(Path(directory).resolve()/'private');original=target.read;project=target.project;network='b'*64
                config={'Id':network,'Name':project+'_pilot','Driver':'bridge','Internal':True,
                    'Labels':{'com.docker.compose.project':project,'com.docker.compose.network':'pilot'},'Options':{},
                    'IPAM':{'Config':[{'Subnet':'172.18.0.0/16','Gateway':'172.18.0.1'}]}}
                attachment={'NetworkID':network,'IPAddress':'172.18.0.2','IPPrefixLen':16,'Gateway':'172.18.0.1'}
                if fault=='network':config['Id']='d'*64
                if fault=='driver':config['Driver']='overlay'
                if fault=='internal':config['Internal']=False
                if fault=='attachment':attachment['NetworkID']='d'*64
                if fault=='ip':attachment['IPAddress']='127.0.0.1'
                if fault=='gateway':attachment['Gateway']='172.18.0.3'
                env=[pg_ownership.KEY+'='+pg_ownership.secret(target.output)]
                if fault=='env':env=[pg_ownership.KEY+'='+'0'*64]
                if fault=='extra_env':env.append(pg_ownership.PREFIX+'other=1')
                state={'logging':'json-file' if fault=='logging' else 'none','environment':env,
                    'command':['-forceFlushAuthKey=foreign'] if fault=='command' else fake.plan['services']['metrics']['command'],'running':True}
                def read(args):
                    if args[:3]==['docker','network','inspect']:return json.dumps(config)
                    if args[:3]==['docker','inspect','--format']:
                        if '.Config.Env' in args[3]:return json.dumps(state)
                        if 'index .NetworkSettings.Networks' in args[3]:return json.dumps(attachment)
                        value=original(args)
                        if fault=='image' and args[-1]==fake.ids['metrics']:
                            parsed=json.loads(value);parsed['image']='foreign';return json.dumps(parsed)
                        return value
                    return original(args)
                target.read=read;endpoint='tcp://foreign:2375' if fault=='remote' else 'unix:///var/run/docker.sock'
                identity={'platform':'linux','endpoint':endpoint}
                packed=b'\0'*20+pg_ownership.socket.inet_aton('172.18.0.3' if fault=='bridge' else '172.18.0.1')
                with patch.object(pg_ownership.sys,'platform','darwin' if fault=='nonlinux' else 'linux'), \
                        patch.object(pg_ownership.pilot,'FROZEN_DOCKER_ENDPOINT',endpoint),patch.object(pg_ownership.pilot,'FROZEN_DOCKER_IDENTITY',identity), \
                        patch.object(pg_ownership.pilot,'assert_docker_identity'),patch.object(pg_ownership.socket,'if_nametoindex',return_value=12), \
                        patch.object(pg_ownership.fcntl,'ioctl',return_value=packed):
                    if fault is None:self.assertEqual(target.flush_target(time.monotonic()+5),('172.18.0.2','172.18.0.1',12))
                    else:
                        with self.assertRaises((ValueError,RuntimeError)):target.flush_target(time.monotonic()+5)

    def test_private_file_stat_and_close_faults_close_all_fds_once_preserving_primary(self):
        import pg_ownership
        for primary,secondary in ((RuntimeError('controlled stat'),KeyboardInterrupt()),(KeyboardInterrupt(),SystemExit(17))):
            with self.subTest(kind=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();opened=[];closed=[];leaf=[];saved=[]
                original_open=os.open;original_close=os.close;original_stat=os.fstat
                def acquire(name,*args,**kwargs):
                    descriptor=original_open(name,*args,**kwargs);opened.append(descriptor)
                    if name==pg_ownership.AUTH:leaf.append(descriptor)
                    return descriptor
                def inspect(descriptor):
                    if leaf and descriptor==leaf[0]:
                        try:raise primary
                        except BaseException:saved.append(primary.__traceback__);raise
                    return original_stat(descriptor)
                def close(descriptor):
                    closed.append(descriptor);original_close(descriptor)
                    if leaf and descriptor==leaf[0]:raise secondary
                with patch.object(pg_ownership.os,'open',side_effect=acquire),patch.object(pg_ownership.os,'fstat',side_effect=inspect), \
                        patch.object(pg_ownership.os,'close',side_effect=close):
                    try:pg_ownership._write(output,pg_ownership.AUTH,b'{}')
                    except BaseException as error:caught=error
                    else:self.fail('stat failure admitted')
                self.assertIs(caught,primary);self.assertCountEqual(closed,opened);self.assertEqual(len(closed),len(set(closed)))
                frames=[];names=[];trace=caught.__traceback__
                while trace is not None:frames.append(trace);names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                self.assertTrue(any(item is saved[0] for item in frames));self.assertNotIn('close',names)
                for descriptor in opened:
                    with self.assertRaises(OSError):original_stat(descriptor)
