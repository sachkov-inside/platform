"""Live Docker authority facts are checked before private Caddy traffic or mutation."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import overlay
import runtime_identity


GATEWAY={'logging':'none','ports':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18427'}]},
         'cap_add':['CAP_NET_BIND_SERVICE'],'cap_drop':['ALL'],'security':['no-new-privileges:true'],
         'privileged':False,'read_only':True,'publish_all':False,'pid_mode':'','ipc_mode':'private','uts_mode':'',
         'devices':None,'device_requests':None,'device_rules':None,'volumes_from':None,'links':None,'extra_hosts':None}


class RuntimeAuthority(unittest.TestCase):
    def test_live_log_or_extra_port_or_host_privilege_refuses_before_traffic(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'private';overlay.prepare(output);plan=overlay.plan(output)
            runtime_identity.validate(json.dumps(GATEWAY).encode(),'gateway',plan)
            for key,value in (('logging','json-file'),('privileged',True),('pid_mode','host'),('read_only',False),
                              ('extra_hosts',['host.docker.internal:host-gateway']),('devices',[{'PathOnHost':'/dev/disk0'}]),
                              ('cap_add',['CAP_NET_BIND_SERVICE','CAP_SYS_ADMIN'])):
                with self.subTest(key=key),self.assertRaises(ValueError):
                    runtime_identity.validate(json.dumps({**GATEWAY,key:value}).encode(),'gateway',plan)
            ports=copy.deepcopy(GATEWAY['ports']);ports['9091/tcp']=[{'HostIp':'127.0.0.1','HostPort':'19091'}]
            with self.assertRaises(ValueError):runtime_identity.validate(json.dumps({**GATEWAY,'ports':ports}).encode(),'gateway',plan)
