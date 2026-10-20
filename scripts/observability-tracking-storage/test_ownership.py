"""New PG ownership and typed absence extend rather than weaken the Core7 proof."""
import fnmatch
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import tracking_storage
import ownership


class TrackingOwnership(unittest.TestCase):
    def test_exact_plan_is_eight_services_five_volumes_two_networks_without_ryuk(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'private'
            ownership.prepare(output)
            plan=ownership.plan(output)
            self.assertEqual(json.loads((output/'compose.json').read_text()),plan)
            self.assertEqual(set(plan['services']),set(ownership.SERVICES))
            self.assertEqual(len(plan['services']),8)
            self.assertEqual(len(plan['volumes']),5)
            self.assertEqual(len(plan['networks']),2)
            self.assertEqual(sum(float(value['cpus']) for value in plan['services'].values()),2)
            self.assertEqual(sum(int(value['mem_limit'][:-1]) for value in plan['services'].values()),4096)
            self.assertEqual(plan['services']['postgres']['image'],ownership.PG_IMAGE)
            self.assertEqual(plan['services']['postgres']['logging'],{'driver':'none'})
            self.assertEqual(plan['services']['postgres']['volumes'],['postgres:/var/lib/postgresql'])
            self.assertEqual(plan['services']['postgres']['environment']['PGDATA'],'/var/lib/postgresql/18/docker')
            self.assertEqual(plan['services']['postgres']['ports'],['127.0.0.1:15432:5432'])

    def fixture(self,output):
        project='inside-observability-pilot-'+'a'*12
        value={'project':project,'container':'b'*64,'volume':project+'_postgres','networks':['c'*64,'d'*64]}
        (output/'tracking-pg-owned.json').write_text(json.dumps(value))
        (output/'source-freshness-owned.json').write_text(json.dumps({'project':project,
            'containers':['e'+str(i)*63 for i in range(7)],
            'volumes':[project+'_'+name for name in ('metrics','logs','traces','grafana')],
            'networks':['c'*64,'d'*64]}))
        (output/'cleanup.json').write_text(json.dumps({'source_freshness':{'outcome':'passed','containers':7,'volumes':4,'networks':2}}))
        return project,value

    def test_absence_needs_exact_missing_container_and_volume_plus_successful_core_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);project,value=self.fixture(output);calls=[]
            def absent(argv,**_):
                calls.append(argv)
                kind,identity=argv[1],argv[-1]
                error=('Error response from daemon: No such container: '+identity if kind=='container' else
                       'Error response from daemon: get '+identity+': no such volume')
                raise subprocess.CalledProcessError(1,argv,output='[]',stderr=error)
            with patch.object(ownership.pilot,'assert_docker_identity'),patch.object(ownership.pilot,'command',side_effect=absent):
                self.assertEqual(ownership.verify_pg_absence(output,project),{'outcome':'passed','containers':8,'volumes':5,'networks':2})
            self.assertEqual(calls,[['docker','container','inspect',value['container']],['docker','volume','inspect',value['volume']]])

    def test_daemon_failure_still_present_bad_identity_and_failed_core_remain_unproved(self):
        for case in ('exists','daemon','wrong_volume','wrong_container','wrong_network','core'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory);project,value=self.fixture(output)
                if case=='wrong_volume': value['volume']='foreign-volume'
                elif case=='wrong_container': value['container']='not-an-id'
                elif case=='wrong_network': value['networks']=['c'*64,'c'*64]
                elif case=='core': (output/'cleanup.json').write_text('{}')
                (output/'tracking-pg-owned.json').write_text(json.dumps(value))
                failure=subprocess.CalledProcessError(1,['docker'],output='',stderr='daemon unavailable')
                with patch.object(ownership.pilot,'assert_docker_identity'),patch.object(ownership.pilot,'command',side_effect=failure if case!='exists' else None,return_value='present'):
                    self.assertEqual(ownership.verify_pg_absence(output,project),{'outcome':'unproved'})

    def test_actual_source_input_closure_is_fully_routed_to_its_separate_workflow(self):
        root=tracking_storage.pilot.ROOT
        workflow=(root/'.github/workflows/observability-tracking-storage.yml').read_text()
        block=workflow.split('    paths:\n',1)[1].split('\n\n',1)[0]
        patterns=[line.removeprefix('      - ').strip('"') for line in block.splitlines()]
        paths={str(path.relative_to(root)) for path in tracking_storage.source_inputs()}
        required={'apps/backend/src/entrypoints/api/create-api-application.ts',
            'apps/backend/src/modules/communications/facets/tracking-visits/tracking-visits.ts',
            'apps/backend/src/modules/communications/infrastructure/postgres/migrations/0112-tracking-trace-context.ts',
            'apps/backend/src/migrations/index.ts','apps/backend/prisma/schema.prisma',
            'apps/backend/prisma.config.ts','apps/backend/test/support/proof-dependencies.ts','docs/contracts/runtime/diagnostic-error.ts',
            '.github/actions/setup-platform/action.yml','pnpm-lock.yaml','.github/workflows/observability-tracking-storage.yml',
            'scripts/observability-tracking-storage/producer.mjs','scripts/observability-tracking-storage/tracking_oracle.py',
            'scripts/observability-tracking-storage/logging-fixture.mjs','scripts/observability-tracking-storage/logging_contract.py',
            'scripts/observability-tracking-storage/trace_flags_contract.py','scripts/observability-sdk-storage/test_trace_flags.py',
            'scripts/observability-tracking-storage/contract_runner.py','scripts/observability-tracking-storage/contract-runner.mjs',
            'scripts/observability-umami/process-owner.mjs','scripts/process-group-signal.mjs'}
        self.assertFalse(required-paths)
        for path in sorted(paths):
            with self.subTest(path=path):
                self.assertTrue(any(fnmatch.fnmatchcase(path,pattern) for pattern in patterns),'bound input would skip new workflow')


class ActualOwnershipRows(unittest.TestCase):
    def test_new_pg_inspection_rejects_foreign_image_network_and_anonymous_mount(self):
        for case in ('accepted','image','network','anonymous_mount','alias'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                output=Path(directory)/'private';ownership.prepare(output)
                plan=ownership.plan(output);project='inside-observability-pilot-'+'a'*12
                compose=['docker','compose','-p',project,'-f',str(output/'compose.json')]
                roles=list(ownership.SERVICES);ids={role:format(i+1,'064x') for i,role in enumerate(roles)}
                actual={}
                for role,service in plan['services'].items():
                    mounts=[]
                    for value in service.get('volumes',[]):
                        source,destination,*options=value.split(':');volume=source in plan['volumes']
                        mounts.append({'Type':'volume' if volume else 'bind','Name':project+'_'+source if volume else '',
                            'Source':source,'Destination':destination,'RW':'ro' not in options})
                    actual[ids[role]]={'id':ids[role],'image':service['image'],'project':project,'service':role,
                        'config_files':str(output/'compose.json'),'mounts':mounts,
                        'networks':{project+'_'+name:{'NetworkID':('c' if name=='pilot' else 'd')*64} for name in service['networks']}}
                if case=='image': actual[ids['postgres']]['image']='foreign:latest'
                elif case=='network': actual[ids['postgres']]['networks'][project+'_pilot']['NetworkID']='f'*64
                elif case=='anonymous_mount': actual[ids['postgres']]['mounts'].append({'Type':'volume','Name':'unknown','Source':'unknown','Destination':'/unregistered','RW':True})
                elif case=='alias': ids['postgres']=ids['alloy']
                def read(argv):
                    if argv[:6] == compose: return ids[argv[-1]]
                    return json.dumps(actual[argv[-1]])
                if case=='accepted':
                    targets=ownership.TrackingTargets(output,compose,plan,read)
                    self.assertEqual(len(targets.targets),8)
                    self.assertEqual(targets.postgres(),ids['postgres'])
                    self.assertEqual(len(json.loads((output/'source-freshness-owned.json').read_text())['containers']),7)
                    self.assertEqual(json.loads((output/'tracking-pg-owned.json').read_text())['container'],ids['postgres'])
                else:
                    with self.assertRaises(RuntimeError): ownership.TrackingTargets(output,compose,plan,read)
