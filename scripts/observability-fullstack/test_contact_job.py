"""Owned real-child preparation contracts. No Docker or external services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import contact_job
import stage_timing

SOURCE='a'*40


class ContactJob(unittest.TestCase):
    def output(self,directory):
        output=Path(directory)
        (output/'evidence.json').write_text(json.dumps({'source':SOURCE}))
        (output/'worker.json').write_text(json.dumps({'pid':os.getpid(),'group':os.getpgrp()}))
        (output/'owner.json').write_text('{}')
        return output

    def test_real_child_verifies_same_parent_group_source_nonce_and_private_record(self):
        with tempfile.TemporaryDirectory() as directory:
            output=self.output(directory)
            program='''import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import contact_job
output=Path(sys.argv[2]);source=contact_job.verify(output,sys.argv[4])
(output/'observed.json').write_text(json.dumps({'source':source,'parent':os.getppid(),'group':os.getpgrp()}))
'''
            with contact_job.start(output,[sys.executable,'-c',program,str(Path(contact_job.__file__).parent),directory]) as job:
                job.wait()
            observed=json.loads((output/'observed.json').read_text())
            self.assertEqual(observed,{'source':SOURCE,'parent':os.getpid(),'group':os.getpgrp()})
            self.assertEqual((output/contact_job.NAME).stat().st_mode&0o777,0o600)
            with self.assertRaises(ProcessLookupError):os.kill(job.process.pid,0)

    def test_real_child_failure_cannot_be_accepted_and_primary_error_survives_close(self):
        with tempfile.TemporaryDirectory() as directory:
            output=self.output(directory)
            with self.assertRaisesRegex(RuntimeError,'contacts_preparation_failed'):
                with contact_job.start(output,[sys.executable,'-c','raise SystemExit(7)']) as job:job.wait()
            self.assertEqual(job.process.returncode,7)
            with self.assertRaises(ProcessLookupError):os.kill(job.process.pid,0)
        with tempfile.TemporaryDirectory() as directory:
            output=self.output(directory);primary=ValueError('original_failure')
            try:
                with contact_job.start(output,[sys.executable,'-c','import signal;signal.pause()']) as job:raise primary
            except ValueError as error:self.assertIs(error,primary)
            else:self.fail('primary failure was lost')
            with self.assertRaises(ProcessLookupError):os.kill(job.process.pid,0)

    def test_deadline_starts_before_spawn_and_late_success_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            output=self.output(directory);clock=[10.0];real_spawn=subprocess.Popen
            def delayed_spawn(*args,**options):
                clock[0]=86.0
                return real_spawn(*args,**options)
            with patch.object(contact_job.time,'monotonic',side_effect=lambda:clock[0]),patch.object(contact_job.subprocess,'Popen',side_effect=delayed_spawn):
                with self.assertRaisesRegex(TimeoutError,'contacts_preparation_deadline'):
                    with contact_job.start(output,[sys.executable,'-c','pass']) as job:job.wait()
            with self.assertRaises(ProcessLookupError):os.kill(job.process.pid,0)
        class Late:
            def wait(self,*,timeout):clock[0]=86;return 0
        clock=[10]
        with patch.object(contact_job.time,'monotonic',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(TimeoutError,'contacts_preparation_deadline'):contact_job.Job(Late(),85).wait()

    def test_changed_owner_source_nonce_or_parent_refuses_before_child_work(self):
        for changed in ('owner','source','nonce','parent','mode','symlink'):
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as directory:
                output=self.output(directory)
                program='''import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import contact_job
try:contact_job.verify(Path(sys.argv[2]),sys.argv[4])
except (ValueError,OSError):sys.exit(23)
sys.exit(0)
'''
                real_spawn=subprocess.Popen
                def spawn(argv,**options):
                    if changed=='owner':(output/'owner.json').write_text('{"changed":true}')
                    elif changed=='source':(output/'evidence.json').write_text(json.dumps({'source':'b'*40}))
                    elif changed=='nonce':argv[-1]='b'*64
                    elif changed=='parent':
                        value=json.loads((output/contact_job.NAME).read_text());value['worker']+=1
                        (output/contact_job.NAME).write_text(json.dumps(value))
                    elif changed=='mode':(output/contact_job.NAME).chmod(0o644)
                    elif changed=='symlink':
                        path=output/contact_job.NAME;path.rename(output/'foreign-owner');path.symlink_to(output/'foreign-owner')
                    return real_spawn(argv,**options)
                with patch.object(contact_job.subprocess,'Popen',side_effect=spawn):
                    with self.assertRaisesRegex(RuntimeError,'contacts_preparation_failed'):
                        with contact_job.start(output,[sys.executable,'-c',program,str(Path(contact_job.__file__).parent),directory]) as job:job.wait()
                self.assertEqual(job.process.returncode,23)

    def test_no_foreign_record_or_timing_is_replaced_or_spawned(self):
        for name in (contact_job.NAME,stage_timing.CONTACTS_NAME):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                output=self.output(directory);(output/name).write_text('foreign')
                with patch.object(contact_job.subprocess,'Popen') as spawn:
                    with self.assertRaises((ValueError,OSError)): 
                        with contact_job.start(output,['never']):pass
                    spawn.assert_not_called()
                self.assertEqual((output/name).read_text(),'foreign')

    def test_contact_timing_is_closed_separate_and_cannot_collect_arbitrary_stage_or_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output=self.output(directory)
            parent=stage_timing.Timing(output,SOURCE)
            child=stage_timing.Timing(output,SOURCE,name=stage_timing.CONTACTS_NAME)
            child.call('seed_contacts',lambda:None);child.call('seed_contact_count',lambda:None);child.finish()
            parent.call('seed_contacts_join',lambda:None);parent.finish()
            self.assertEqual([row['stage'] for row in stage_timing.read(output,SOURCE)['stages']],['seed_contacts_join'])
            value=stage_timing.read(output,SOURCE,name=stage_timing.CONTACTS_NAME)
            self.assertEqual(value['state'],'completed')
            value['stages'][0]['stage']='horizon_install'
            with self.assertRaises(ValueError):stage_timing.write(output,value,SOURCE,name=stage_timing.CONTACTS_NAME)
            for name in ('../foreign.json','private.json',True,None):
                with self.assertRaises(ValueError):stage_timing.read(output,SOURCE,name=name)


    def test_collection_canonicalizes_contact_timing_before_copy_and_keeps_owner_private(self):
        import fullstack
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'private';output.mkdir(mode=0o700);self.output(output)
            metadata=root/'metadata';metadata.mkdir()
            timer=stage_timing.Timing(output,SOURCE,name=stage_timing.CONTACTS_NAME)
            timer.call('seed_contacts',lambda:None);timer.call('seed_contact_count',lambda:None);timer.finish()
            (output/contact_job.NAME).write_text('private-sentinel')
            path=output/stage_timing.CONTACTS_NAME;good=path.read_text()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
                for index,bad in enumerate((good[:-2]+',"private":"private-sentinel"}\n',good.replace(SOURCE,'b'*40),good.replace('seed_contacts','horizon_install'))):
                    path.write_text(bad);destination=root/('refused'+str(index))
                    with self.assertRaises(ValueError):fullstack.collect(output,metadata,destination)
                    self.assertFalse(destination.exists())
                path.write_text(good);destination=root/'public';fullstack.collect(output,metadata,destination)
            self.assertEqual(stage_timing.read(destination,SOURCE,name=stage_timing.CONTACTS_NAME,binding_output=output),stage_timing.read(output,SOURCE,name=stage_timing.CONTACTS_NAME))
            self.assertFalse((destination/contact_job.NAME).exists())
            self.assertNotIn('private-sentinel',(destination/stage_timing.CONTACTS_NAME).read_text())


class ContactChildAdapter(unittest.TestCase):
    output=ContactJob.output
    def test_actual_contact_child_keeps_durable_batches_and_refuses_wrong_cardinality(self):
        import fullstack
        import socket
        for count,expected in (('256','completed'),('255','failed')):
            with self.subTest(count=count),tempfile.TemporaryDirectory() as directory:
                output=self.output(directory)
                source=subprocess.run(['git','rev-parse','HEAD'],capture_output=True,text=True,check=True,timeout=2).stdout.strip()
                (output/'evidence.json').write_text(json.dumps({'source':source}))
                endpoint=output/'docker.sock'
                with socket.socket(socket.AF_UNIX) as listener:
                    listener.bind(str(endpoint));info=endpoint.stat()
                    owner={'project':'inside-observability-fullstack-fixture','daemon':{'platform':'linux','context':'fixture',
                        'endpoint':'unix://'+str(endpoint),'daemon_id':'fixture','storage':directory,
                        'socket_device':info.st_dev,'socket_inode':info.st_ino}}
                    (output/'owner.json').write_text(json.dumps(owner))
                    bindir=output/'bin';bindir.mkdir()
                    executable=bindir/'docker'
                    executable.write_text('#!'+sys.executable+'\n'+(Path(__file__).parent/'fixtures/contact-docker.py').read_text())
                    executable.chmod(0o700)
                    program="""import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import fullstack
# Native Python/CLI protocol contract on macOS; Linux guard is controlled here.
# This never acquires Docker and supplies no Linux runtime/capacity evidence.
fullstack.sys.platform='linux'
fullstack.contacts_worker(Path(sys.argv[2]),sys.argv[4])
"""
                    with patch.dict(os.environ,{'PATH':str(bindir)+':/usr/bin:/bin','CONTACT_TEST_OUTPUT':directory,'CONTACT_TEST_COUNT':count}):
                        if count=='256':
                            with contact_job.start(output,[sys.executable,'-c',program,str(fullstack.HERE),directory]) as job:job.wait()
                        else:
                            with self.assertRaisesRegex(RuntimeError,'contacts_preparation_failed'):
                                with contact_job.start(output,[sys.executable,'-c',program,str(fullstack.HERE),directory]) as job:job.wait()
                self.assertEqual((output/'protocol').read_text().splitlines(),[
                    'admit 0','durable 64','admit 64','durable 64','admit 128','durable 64','admit 192','durable 64','durable 256','cardinality'])
                self.assertEqual(stage_timing.read(output,source,name=stage_timing.CONTACTS_NAME)['state'],expected)


class ExternalSupervisor(unittest.TestCase):
    def test_existing_supervisor_owns_contact_tree_on_success_failure_deadline_and_signals(self):
        import fullstack
        import socket
        fixture=Path(__file__).parent/'fixtures/contact-process.py'
        foreign=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'])
        try:
            for mode,expected in (('success',0),('failure',1),('main-failure',1),('timeout',124),('sigterm',143),('sigkill',137)):
                with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                    output=Path(directory)
                    def cleanup(*args,**options):return {'diagnostics':'passed','down':'passed','residue':'passed'}
                    with patch.object(fullstack.pilot,'cleanup_project',side_effect=cleanup):
                        status=fullstack.pilot.supervise_worker([sys.executable,str(fixture),mode,directory],[],output,'inside-observability-fullstack-fixture',deadline_seconds=.8 if mode=='timeout' else 3)
                    self.assertEqual(status,expected)
                    self.assertIsNone(foreign.poll())
                    if mode!='success':
                        self.assertTrue((output/'contact.ready').exists())
                        def closed():
                            with socket.socket(socket.AF_UNIX) as probe:
                                probe.settimeout(.2)
                                try:probe.connect(str(output/'child.sock'))
                                except (FileNotFoundError,ConnectionRefusedError):return True
                                return False
                        fullstack.pilot.await_fact(closed,bool,budget=1)
                    outcome=json.loads((output/'worker-outcome.json').read_text())
                    self.assertEqual(outcome['exit_code'],expected)
                    self.assertEqual(outcome['cleanup']['residue'],'passed')
        finally:
            foreign.terminate();foreign.wait(timeout=1)


if __name__=='__main__':unittest.main()
