"""Live Docker authority facts are checked before private Caddy traffic or mutation."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import overlay
import runtime_identity
from test_source_status_scenario import FakePilot


GATEWAY={'logging':'none','ports':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18427'}]},
         'cap_add':['CAP_NET_BIND_SERVICE'],'cap_drop':['ALL'],'security':['no-new-privileges:true'],
         'privileged':False,'read_only':True,'publish_all':False,'pid_mode':'','ipc_mode':'private','uts_mode':'',
         'devices':None,'device_requests':None,'device_rules':None,'volumes_from':None,'links':None,'extra_hosts':None}


class RuntimeAuthority(unittest.TestCase):
    def test_live_log_or_extra_port_or_host_privilege_refuses_before_traffic(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);plan=overlay.plan(output)
            gateway={**GATEWAY,'user':plan['services']['gateway']['user']}
            runtime_identity.validate(json.dumps(gateway).encode(),'gateway',plan)
            for key,value in (('logging','json-file'),('privileged',True),('pid_mode','host'),('read_only',False),
                              ('extra_hosts',['host.docker.internal:host-gateway']),('devices',[{'PathOnHost':'/dev/disk0'}]),
                              ('cap_add',['CAP_NET_BIND_SERVICE','CAP_SYS_ADMIN'])):
                with self.subTest(key=key),self.assertRaises(ValueError):
                    runtime_identity.validate(json.dumps({**gateway,key:value}).encode(),'gateway',plan)
            ports=copy.deepcopy(GATEWAY['ports']);ports['9091/tcp']=[{'HostIp':'127.0.0.1','HostPort':'19091'}]
            with self.assertRaises(ValueError):runtime_identity.validate(json.dumps({**gateway,'ports':ports}).encode(),'gateway',plan)

    def test_registered_gateway_replacement_is_refused_before_exec_or_mutation(self):
        import owned
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output)
            fake=FakePilot(output);fake.plan=overlay.plan(output)
            def read(argv):
                if argv[:3]==['docker','inspect','--format'] and argv[3]==runtime_identity.INSPECT:
                    role=next(role for role,cid in fake.ids.items() if cid==argv[-1])
                    plan=fake.plan['services'][role];ports={}
                    for value in plan.get('ports',[]):
                        host,source,target=value.split(':');ports[target+'/tcp']=[{'HostIp':host,'HostPort':source}]
                    return json.dumps({**GATEWAY,'logging':plan['logging']['driver'],'ports':ports,
                                       'cap_add':['CAP_NET_BIND_SERVICE'] if role=='gateway' else None,'user':plan.get('user','')})
                return fake.command(argv)
            targets=owned.Targets(output,fake.compose,fake.plan,read)
            fake.ids['gateway']='f'*64
            with self.assertRaises((ValueError,RuntimeError)):targets.check('gateway')
            self.assertEqual(fake.changes,[])

    def test_private_live_user_is_required_and_not_defaulted(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);plan=overlay.plan(output)
            with self.assertRaises(ValueError):runtime_identity.validate(json.dumps(GATEWAY).encode(),'gateway',plan)

    def test_all_seven_role_user_contracts_and_complete_raw_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);plan=overlay.plan(output)
            for role,service in plan['services'].items():
                ports={}
                for publication in service.get('ports',[]):
                    host,source,target=publication.split(':');ports[target+'/tcp']=[{'HostIp':host,'HostPort':source}]
                value={**GATEWAY,'logging':service['logging']['driver'],'ports':ports,
                       'cap_add':service.get('cap_add'),'user':service.get('user','')}
                with self.subTest(role=role):
                    self.assertTrue(runtime_identity.validate(json.dumps(value).encode(),role,plan))
                    malformed=[{k:v for k,v in value.items() if k!='user'},dict(value,unknown='private-canary')]
                    malformed += [dict(value,user=bad) for bad in (None,True,1,[],{},'x'*129,'ж'*65)]
                    if role in ('alloy','gateway','vmauth'):
                        expected=service['user'];uid,gid=expected.split(':')
                        malformed += [dict(value,user=bad) for bad in ('','root',uid,uid+':',':'+gid,
                            '0'+expected,'+'+expected,expected+' ',' '+expected,'9999999999:'+gid,uid+':9999999999',
                            str((int(uid)+1)%4294967295)+':'+gid,uid+':'+str((int(gid)+1)%4294967295))]
                    else:
                        for user in ('','472','image-user'):
                            self.assertTrue(runtime_identity.validate(json.dumps(dict(value,user=user)).encode(),role,plan))
                        changed=copy.deepcopy(plan);changed['services'][role]['user']='1:1'
                        with self.assertRaises(ValueError):runtime_identity.validate(json.dumps(value).encode(),role,changed)
                    for row in malformed:
                        with self.assertRaises(ValueError):runtime_identity.validate(json.dumps(row).encode(),role,plan)
                    raw=json.dumps(value)
                    for poison in (raw[:-1]+',"user":"private-canary"}',raw[:-1]+',"unknown":NaN}',
                                   raw[:-1]+',"unknown":{"x":1,"x":2}}'):
                        with self.assertRaises(ValueError):runtime_identity.validate(poison.encode(),role,plan)

    def test_explicit_user_requires_canonical_expected_identity_even_when_observed_equal(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);plan=overlay.plan(output)
            for user,valid in (('0:0',True),('4294967294:4294967294',True),('00:0',False),
                    ('0:00',False),('4294967295:0',False),('0:4294967295',False),('-1:0',False),
                    ('1e2:0',False),('root:root',False),('',False),(None,False),(True,False)):
                changed=copy.deepcopy(plan);changed['services']['gateway']['user']=user
                raw=json.dumps({**GATEWAY,'user':user}).encode()
                with self.subTest(valid=valid,user_type=type(user).__name__):
                    if valid:self.assertTrue(runtime_identity.validate(raw,'gateway',changed))
                    else:
                        with self.assertRaises(ValueError):runtime_identity.validate(raw,'gateway',changed)
