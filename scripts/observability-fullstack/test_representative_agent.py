"""SOURCE-MODEL: real Unix socket requests and finite callback observations."""
import errno
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import representative_agent as agent


class Protocol(unittest.TestCase):
    def test_fresh_request_drives_callback_and_closed_negatives_do_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary).resolve();directory.chmod(0o700);path=directory/'reader.sock';seen=[]
            def read(operation):seen.append(operation);return {'ok':True,'count':len(seen)}
            with agent.server('a'*64,read,path) as server:
                stop=threading.Event()
                def run():
                    while not stop.is_set():server.handle_request()
                thread=threading.Thread(target=run);thread.start()
                config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                try:
                    for count in (1,2):
                        status,value=agent.wire(config,time.monotonic()+2,path=path,body={'operation':'retained_probes','parameters':{}})
                        self.assertEqual((status,value),(200,{'state':'observed','observation':{'ok':True,'count':count}}))
                    for body in ({'operation':'raw_sql','parameters':{}},{'operation':'retained_probes','parameters':[]},
                            {'operation':'retained_probes','parameters':{'sql':'SELECT 1'}},
                            {'operation':'retained_probes','parameters':{},'window':1}):
                        self.assertEqual(agent.wire(config,time.monotonic()+2,path=path,body=body)[0],403)
                    self.assertEqual(agent.wire(config,time.monotonic()+2,path=path,body={'operation':'retained_probes','parameters':{}},key='wrong')[0],403)
                    self.assertEqual(seen,['retained_probes','retained_probes'])
                finally:stop.set();thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
    def test_socket_replacement_and_foreign_peer_refuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary).resolve()/'reader.sock';Path(temporary).resolve().chmod(0o700)
            with agent.server('a'*64,lambda _: {'ok':True},path):
                config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                wrong=dict(config);wrong['socket_identity']=dict(config['socket_identity'],inode=0)
                with self.assertRaises(ValueError):agent.wire(wrong,time.monotonic()+2,path=path,body={})
                with patch.object(agent,'peer',return_value=(1,os.getuid()+1,os.getgid())),self.assertRaises(ValueError):
                    agent.wire(config,time.monotonic()+2,path=path,body={})
    def test_only_kernel_network_unreachable_counts_as_denial(self):
        for error in (errno.ECONNREFUSED,errno.ETIMEDOUT,errno.EHOSTUNREACH):
            with patch.object(socket,'create_connection',side_effect=OSError(error,'model')),self.assertRaises(ValueError):agent.deny_tcp('10.0.0.2',8080,1)
        with patch.object(socket,'create_connection',side_effect=OSError(errno.ENETUNREACH,'model')):
            self.assertEqual(agent.deny_tcp('10.0.0.2',8080,1),{'kernel_denied':True})
