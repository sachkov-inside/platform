"""Large native snapshot stays in the owned database, not the bounded public response transport."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import recovery_runtime as runner
import runtime


class SnapshotTransport(unittest.TestCase):
    def test_large_sql_dump_uses_private_owned_file_without_raising_shared_response_cap(self):
        commands=[]
        def execute(base,args,**options):
            return runtime.invoke(base,args,**options)
        def command(args,**options):
            commands.append(args)
            if 'pg_dump' in args:return SimpleNamespace(returncode=0,stdout='x'*(runtime.FIXTURE_BYTES+1),stderr='')
            return SimpleNamespace(returncode=0,stdout='',stderr='')
        with patch.object(runtime.pilot,'assert_docker_identity'),patch.object(runtime.pilot,'docker_args',side_effect=lambda args:args),patch.object(runtime.subprocess,'run',side_effect=command):
            with self.assertRaisesRegex(RuntimeError,'response exceeds budget'):
                runtime.invoke(['owned'],['pg_dump'])
            commands.clear()
            runner._maintenance_snapshot(['owned'],execute=execute)
            runner._maintenance_restore(['owned'],execute=execute)
        self.assertEqual(runtime.FIXTURE_BYTES,65_536)
        self.assertEqual(len(commands),2)
        self.assertIn('ulimit -f 2048',commands[0][-1])
        self.assertIn('--file=/tmp/inside-1566-native-snapshot.sql',commands[0][-1])
        self.assertIn('1048576',commands[0][-1])
        self.assertEqual(commands[1][-1],'--file=/tmp/inside-1566-native-snapshot.sql')

    def test_private_dump_is_written_and_consumed_locally_and_oversize_is_refused(self):
        import os
        from pathlib import Path
        import subprocess
        import sys
        import tempfile
        real_run=subprocess.run
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);tools=root/'bin';tools.mkdir();snapshot=root/'snapshot.sql'
            dump=tools/'pg_dump';dump.write_text('#!'+sys.executable+'\nimport os,pathlib,sys\np=next(a[7:] for a in sys.argv if a.startswith("--file="))\npathlib.Path(p).write_bytes(b"x"*int(os.environ["DUMP_BYTES"]))\n');dump.chmod(0o700)
            restore=tools/'psql';restore.write_text('#!'+sys.executable+'\nimport pathlib,sys\np=next(a[7:] for a in sys.argv if a.startswith("--file="))\nassert pathlib.Path(p).read_bytes()==b"x"*65537\n');restore.chmod(0o700)
            stat=tools/'stat';stat.write_text('#!'+sys.executable+'\nimport pathlib,sys\nprint(pathlib.Path(sys.argv[-1]).stat().st_size)\n');stat.chmod(0o700)
            size=[65_537]
            def command(args,**options):
                translated=[item.replace('/tmp/inside-1566-native-snapshot.sql',str(snapshot)) for item in args[4:]]
                return real_run(translated,**options,env={**os.environ,'PATH':str(tools)+os.pathsep+os.environ['PATH'],'DUMP_BYTES':str(size[0])})
            with patch.object(runtime.pilot,'assert_docker_identity'),patch.object(runtime.pilot,'docker_args',side_effect=lambda args:args),patch.object(runtime.subprocess,'run',side_effect=command):
                runner._maintenance_snapshot(['owned'],execute=runtime.invoke)
                self.assertEqual(snapshot.stat().st_size,65_537)
                runner._maintenance_restore(['owned'],execute=runtime.invoke)
                snapshot.unlink();size[0]=1_048_577
                with self.assertRaises(runtime.FixtureCommandFailed):runner._maintenance_snapshot(['owned'],execute=runtime.invoke)
