"""Preparation scheduler contracts. Real child, controlled Docker/SQL/assets boundaries."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import fullstack


class PreparationOverlap(unittest.TestCase):
    def test_monitoring_preparation_finishes_while_contacts_are_still_draining(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);(output/'runtime/rabbitmq').mkdir(parents=True)
            (output/'monitoring').mkdir();(output/'provider').mkdir()
            (output/'monitoring/umami.database.password').write_text('a'*64)
            (output/'compose.json').write_text(json.dumps({'services':{'grafana':{'user':'1000:1000'}}}))
            events=[];source='a'*40
            (output/'evidence.json').write_text(json.dumps({'source':source}))
            (output/'worker.json').write_text(json.dumps({'pid':fullstack.os.getpid(),'group':fullstack.os.getpgrp()}))
            (output/'owner.json').write_text('{}')
            real_spawn=subprocess.Popen
            def spawn(argv,**options):
                # External child adapter: no Docker, providers or credentials. The
                # contact branch is deliberately pending until asset acquisition commits.
                return real_spawn([sys.executable,'-c',
                    'import pathlib,sys,time; p=pathlib.Path(sys.argv[1]); (p/"contacts.started").touch(); '
                    '\nwhile not (p/"assets.done").exists(): time.sleep(.01)',str(output)],**options)
            def invoke(compose,args,**options):
                if 'telegram-establish' in args:
                    raise RuntimeError('serialized_contacts_prevent_independent_preparation')
                if args[-1:] == ['establish']:
                    return json.dumps({'created':256,'accounts':[f'{index:08x}-0000-0000-0000-000000000000' for index in range(256)]})
                if args[-1:] == ['seed']:return '{"key":"synthetic"}'
                return '{}'
            def sql(compose,query,**options):
                if 'public_materials' in query:return '{"accounts":256,"materials":512,"public_materials":512}'
                return ''
            def assets(*args):
                # Observe the committed start, rather than guessing scheduling by time.
                fullstack.pilot.await_fact(lambda:(output/'contacts.started').exists(),bool,budget=2)
                events.append('assets');(output/'assets.done').touch()
            with patch.object(fullstack.subprocess,'Popen',side_effect=spawn), \
                    patch.object(fullstack,'invoke',side_effect=invoke),patch.object(fullstack,'sql',side_effect=sql), \
                    patch.object(fullstack.resource_runtime,'wait_ready'),patch.object(fullstack,'ready'), \
                    patch.object(fullstack.extra,'initialize'),patch.object(fullstack.telegram,'initialize'), \
                    patch.object(fullstack.source_cache,'select_caddy_server',return_value='srv0'), \
                    patch.object(fullstack.source_guard,'prove',return_value={'closed':'proof'}), \
                    patch.object(fullstack.horizon_build,'verify',side_effect=assets), \
                    patch.object(fullstack.production.pilot,'install_plugin',side_effect=lambda *_:events.append('plugin')):
                result=fullstack.seed([],output)
            self.assertEqual(result,{'closed':'proof'})
            self.assertEqual(events,['assets','plugin'])
            self.assertTrue((output/'assets.done').exists())


if __name__=='__main__':unittest.main()
