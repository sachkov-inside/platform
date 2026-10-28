"""Publication boundary: private provider failures and arbitrary JSON never escape."""
import json
from pathlib import Path
import tempfile
import unittest

import evidence
import lifecycle


class Publication(unittest.TestCase):
    def test_complete_closed_functional_receipt_remains_explicitly_not_capacity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'private';source.mkdir(mode=0o700)
            lock=lifecycle.verify_packet();pins={r['repository'].split('/')[-1]:r for r in lock['images']}
            images={}
            for role,name in lifecycle.ROLE_IMAGES.items():
                row=pins[name];images[role]={'reference':row['pinned'],'architecture':'amd64','child_manifest':row['linux_amd64_manifest'],
                    'image_id':row['linux_amd64_manifest'],'selected_image_id':row['linux_amd64_manifest']}
            records={'source':{'commit':'a'*40},'images':images,
                'outcome':{'passed':True,'worker_exit':0,'worker_seconds':30,'runtime_limit_seconds':600,'cleanup':{'passed':True},'full_workload':False,'capacity_acceptance':False},
                'cleanup':{'passed':True,'failed_operations':[],'exact_containers':11,'exact_volumes':7,'exact_networks':1},
                'functional':{**{k:1 for k in evidence.FACTS},'query_seconds':.2,'empty_fixture_span_count':0,'full_workload_acceptance':0,'capacity_acceptance':0},
                'postgres':{'available':True,'counts':{'applied_migrations':1,'migration_lock_rows':1}},
                'states':{r:{'running':r not in ('volume-init','histogram-init','migrator'),'oom_killed':False,'exit_code':0,'restart_count':0} for r in lifecycle.SERVICES},
                'isolation':{'schema':1,'network_mode':'none','namespace_inode':111,'host_namespace_inode':112,'backend_namespace_inode':113,
                    'socket_identity':{'device':12,'inode':34,'uid':1001,'gid':1001,'mode':0o600,'links':1}},
                'agent':{'schema':1,'nonce':'a'*32,'reads':4,'gateway_denials':9,'backend_denials':10,'filesystem_isolated':1,'namespace_inode':111,
                    'socket_inode':34,'socket_device':12,'dns_noname':0,'dns_unavailable':1,'dns_resolved':0},
                'disk-admission':{'host':{'filesystems':{'123':{'total_bytes':100000000000,'free_bytes':90000000000}}},
                    'vm':{'fsid':1,'device':2,'block':4096,'blocks':10000000,'available':9000000,'files':0,'free_files':0}}}
            for name,value in records.items():lifecycle.private_json(source/(name+'.json'),value)
            engine=source/'engine-1-12345678';engine.mkdir(mode=0o700)
            lifecycle.private_json(engine/'identity.json',{k:'sha256:'+'a'*64 for k in ('cli_sha256','compose_sha256','daemon_sha256','endpoint_sha256')})
            def verified(value):self.assertEqual(value,records['source'])
            public=root/'public';self.assertTrue(evidence.collect(source,public,verified))
            result=json.loads((public/'witness.json').read_text())
            self.assertTrue(result['passed']);self.assertTrue(result['functional_only']);self.assertFalse(result['capacity_acceptance'])
            bad_states=[{}, {k:v for k,v in records['states'].items() if k!='server'}]
            for field,value in [('running',False),('oom_killed',True),('restart_count',1),('exit_code',1)]:
                bad_states.append({**records['states'],'server':{**records['states']['server'],field:value}})
            for index,bad in enumerate(bad_states):
                lifecycle.private_json(source/'states.json',bad)
                self.assertFalse(evidence.collect(source,root/('bad-'+str(index)),verified))
            lifecycle.private_json(source/'states.json',records['states'])
            for index,(name,bad) in enumerate([
                ('agent',{**records['agent'],'namespace_inode':999}),
                ('agent',{**records['agent'],'socket_inode':999}),
                ('agent',{**records['agent'],'backend_denials':0}),
                ('isolation',{**records['isolation'],'network_mode':'bridge'}),
                ('isolation',{**records['isolation'],'namespace_inode':112}),
                ('cleanup',{**records['cleanup'],'exact_volumes':6}),
                ('outcome',{**records['outcome'],'worker_exit':1})]):
                lifecycle.private_json(source/(name+'.json'),bad)
                self.assertFalse(evidence.collect(source,root/('cross-'+str(index)),verified))
                lifecycle.private_json(source/(name+'.json'),records[name])

    def test_early_failure_still_produces_closed_unavailable_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'absent'
            public = Path(tmp) / 'public'
            self.assertFalse(evidence.collect(source, public, lambda _v: None))
            result = json.loads((public / 'witness.json').read_text())
            self.assertFalse(result['passed'])
            self.assertFalse(result['functional']['available'])
            self.assertNotIn('counts', result['postgres'])

    def test_untrusted_fields_and_symlinks_are_never_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'private'; source.mkdir(mode=0o700)
            secret = 'private-key-email-DSN-query-must-never-escape'
            lifecycle.private_json(source / 'functional.json', {'bootstrap': 1, 'query_seconds': secret})
            lifecycle.private_json(source / 'failure.json', {'phase': 'functional', 'category': secret, 'reason': secret})
            lifecycle.private_json(source / 'states.json', {'server': {'running': True, 'oom_killed': False, 'exit_code': 0, 'restart_count': 0, 'raw_log': secret}})
            (source / 'outcome.json').symlink_to(source / 'failure.json')
            (source / 'secret.private').write_text(secret)
            public = root / 'public'
            self.assertFalse(evidence.collect(source, public, lambda _v: (_ for _ in ()).throw(ValueError())))
            encoded = ''.join(path.read_text() for path in public.iterdir())
            self.assertNotIn(secret, encoded)
            self.assertEqual({p.name for p in public.iterdir()}, {'witness.json'})


if __name__ == '__main__': unittest.main()
