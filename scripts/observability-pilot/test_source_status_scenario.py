"""Deterministic scenario contracts at Docker/query/clock seams, never live Docker."""
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

import pilot
import source_status_scenario as scenario
from fixtures.owned_scenario_process import owned_scenario_process, group_absent

PROJECT = 'inside-observability-pilot-012345abcdef'


class FakePilot:
    def __init__(self, output):
        self.output = output
        self.now = 0
        self.stamp = 100
        self.stopped = set()
        self.changes = []
        images = {role: 'fixture/' + role + '@sha256:' + 'a' * 64 for role in pilot.SERVICES}
        self.plan = pilot.compose_plan(pilot.CONFIG, output, images, credential_owner=(1000, 1000))
        self.ids = {role: f'{index + 1:064x}' for index, role in enumerate(pilot.SERVICES)}
        self.compose = ['docker', 'compose', '-p', PROJECT, '-f', str(output / 'compose.json')]

    def identity(self, **_):
        pass

    def command(self, argv, **_):
        if argv[:6] == self.compose:
            return self.ids[argv[-1]]
        if argv[1] == 'inspect':
            role = next(role for role, cid in self.ids.items() if cid == argv[-1])
            mounts = []
            for value in self.plan['services'][role].get('volumes', []):
                source, target, *options = value.split(':')
                volume = source in self.plan['volumes']
                mounts.append({'Type': 'volume' if volume else 'bind',
                               'Name': PROJECT + '_' + source if volume else '',
                               'Source': '/data' if volume else source, 'Destination': target, 'RW': 'ro' not in options})
            return json.dumps({'id': self.ids[role], 'image': self.plan['services'][role]['image'],
                               'project': PROJECT, 'service': role, 'config_files': self.compose[-1],
                               'mounts': mounts, 'networks': {PROJECT + '_' + name: {'NetworkID':
                                   ('b' if name == 'pilot' else 'c') * 64}
                                   for name in self.plan['services'][role]['networks']}})
        role = next(role for role, cid in self.ids.items() if cid == argv[-1])
        if argv[1] == 'stop':
            self.stopped.add(role)
        elif argv[1] == 'start':
            self.stopped.remove(role)
        else:
            raise AssertionError('unexpected Docker action')
        self.changes.append((argv[1], role))
        self.stamp += 1
        return self.ids[role]

    def observe(self, _output, **_):
        states = {'collector': 'fresh_up', 'trace_store': 'fresh_up'}
        if 'traces' in self.stopped:
            states['trace_store'] = 'fresh_down'
        if 'alloy' in self.stopped:
            states = {key: 'stale' for key in states}
        if 'metrics' in self.stopped:
            states = {key: 'query_unavailable' for key in states}
        return {'sources': {key: {'state': state, 'measured_at': self.stamp} for key, state in states.items()}}


class ScenarioTests(unittest.TestCase):
    def test_real_supervisor_reaps_scenario_on_success_failure_timeout_and_interruption(self):
        for mode, status, state in (('success', 0, 'passed'), ('failure', 1, 'failed'),
                                     ('timeout', 124, 'incomplete'), ('sigterm', 143, 'incomplete')):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                with owned_scenario_process(output, mode) as process:
                    stdout, stderr = process.communicate(timeout=8)
                    self.assertEqual(process.returncode, status, stderr)
                    self.assertNotIn('private boundary diagnostic', stdout + stderr)
                    report = json.loads((output / 'source-freshness.json').read_text())
                    self.assertEqual(report['state'], state)
                    outcome = json.loads((output / 'worker-outcome.json').read_text())
                    self.assertEqual(outcome['exit_code'], status)
                    self.assertEqual(outcome['cleanup']['source_freshness']['outcome'], 'passed')
                    worker = json.loads((output / 'worker.json').read_text())
                    self.assertTrue(group_absent(worker['group']))
                    self.assertNotIn('private boundary diagnostic', json.dumps(report))

    def test_real_worker_cli_withholds_boundary_diagnostics_paths_and_command_details(self):
        for mode in ('cli_failure', 'cli_command_failure'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                with owned_scenario_process(output, mode) as process:
                    stdout, stderr = process.communicate(timeout=8)
                    self.assertEqual(process.returncode, 1, stderr)
                    report = json.loads((output / 'source-freshness.json').read_text())
                    self.assertEqual(report['state'], 'failed')
                    self.assertIn('ScenarioFailed', stderr)
                    public = stdout + stderr + json.dumps(report)
                    for secret in ('private boundary diagnostic', 'private-config-sentinel',
                                   'private-output-sentinel', 'private-error-sentinel',
                                   'private-token-sentinel', str(output)):
                        self.assertNotIn(secret, public)
                    self.assertNotIn('Traceback', stderr)

    def test_interrupt_and_explicit_exit_keep_their_original_semantics(self):
        for error in (KeyboardInterrupt(), SystemExit(23)):
            with self.subTest(kind=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                fake = FakePilot(output)
                def observe(*_, **__):
                    raise error
                with self.assertRaises(type(error)) as raised:
                    scenario.run(output, fake.compose, fake.plan, command=fake.command,
                                 assert_identity=fake.identity, observe=observe, clock=lambda: 0)
                self.assertIs(raised.exception, error)
                self.assertEqual(json.loads((output / 'source-freshness.json').read_text())['state'], 'failed')

    def test_outer_timeout_and_assertion_failure_always_reap_both_owned_groups(self):
        for mode in ('outer_timeout', 'assertion_failure'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                expected = subprocess.TimeoutExpired if mode == 'outer_timeout' else AssertionError
                groups = []
                with self.assertRaises(expected):
                    with owned_scenario_process(output, mode) as process:
                        pilot.await_fact(lambda: (output / 'boundary-entered').exists(), bool, budget=1)
                        worker = json.loads((output / 'worker.json').read_text())
                        groups = [process.pid, worker['group']]
                        if mode == 'outer_timeout':
                            process.communicate(timeout=.01)
                        else:
                            self.fail('forced assertion failure exercises emergency cleanup')
                self.assertEqual(len(groups), 2)
                self.assertTrue(all(group_absent(group) for group in groups))

    def test_seven_real_source_transitions_share_the_existing_project(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            result = scenario.run(output, fake.compose, fake.plan, command=fake.command,
                                  assert_identity=fake.identity, observe=fake.observe,
                                  clock=lambda: fake.now, pause=lambda _: None)
            self.assertEqual(result['state'], 'passed')
            self.assertEqual([row['phase'] for row in result['phases']],
                             ['baseline', 'vt_down', 'vt_recovered', 'alloy_down', 'alloy_recovered',
                              'query_unavailable', 'query_recovered'])
            self.assertEqual(fake.changes, [('stop', 'traces'), ('start', 'traces'), ('stop', 'alloy'),
                                            ('start', 'alloy'), ('stop', 'metrics'), ('start', 'metrics')])
            self.assertFalse(fake.stopped)
            self.assertEqual(json.loads((output / 'source-freshness.json').read_text())['state'], 'passed')

    def test_unproved_project_cid_image_mount_network_or_source_never_reaches_stop(self):
        for field in ('project', 'id', 'image', 'mounts', 'networks', 'config_files'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                fake = FakePilot(output)
                def read(argv, **kwargs):
                    raw = fake.command(argv, **kwargs)
                    if argv[1] == 'inspect':
                        item = json.loads(raw)
                        item[field] = [] if field == 'mounts' else {} if field == 'networks' else 'foreign-secret'
                        return json.dumps(item)
                    return raw
                with self.assertRaises(scenario.ScenarioFailed):
                    scenario.run(output, fake.compose, fake.plan, command=read,
                                 assert_identity=fake.identity, observe=fake.observe,
                                 clock=lambda: fake.now, pause=lambda _: None)
                self.assertEqual(fake.changes, [])
                artifact = (output / 'source-freshness.json').read_text()
                self.assertNotIn('foreign-secret', artifact)
                self.assertEqual(json.loads(artifact)['state'], 'failed')

    def test_replaced_current_container_or_unexpected_service_refuses_lifecycle(self):
        for mutation in ('cid', 'service'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                fake = FakePilot(output)
                seen = 0
                def command(argv, **kwargs):
                    nonlocal seen
                    raw = fake.command(argv, **kwargs)
                    if argv[:6] == fake.compose and argv[-1] == 'traces':
                        seen += 1
                        if mutation == 'cid' and seen > 1:
                            return 'f' * 64
                    if mutation == 'service' and argv[1] == 'inspect':
                        item = json.loads(raw)
                        item['service'] = 'foreign'
                        return json.dumps(item)
                    return raw
                with self.assertRaises(scenario.ScenarioFailed):
                    scenario.run(output, fake.compose, fake.plan, command=command,
                                 assert_identity=fake.identity, observe=fake.observe,
                                 clock=lambda: fake.now, pause=lambda _: None)
                self.assertEqual(fake.changes, [])

    def test_phase_reports_include_attempts_and_shared_budget_durations(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            result = scenario.run(output, fake.compose, fake.plan, command=fake.command,
                                  assert_identity=fake.identity, observe=fake.observe,
                                  clock=lambda: fake.now, pause=lambda _: None)
            self.assertTrue(all(row['attempts'] == 1 and row['duration_seconds'] == 0
                                and row['outcome'] == 'passed' for row in result['phases']))

    def test_malformed_baseline_and_interruption_leave_closed_failure_without_stop(self):
        for mode in ('malformed', 'interrupt', 'identity'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                fake = FakePilot(output)
                def observe(*args, **kwargs):
                    if mode == 'interrupt':
                        raise KeyboardInterrupt()
                    value = fake.observe(*args, **kwargs)
                    if mode == 'malformed':
                        value['sources']['collector']['state'] = 'malformed'
                    return value
                def identity(**_):
                    raise RuntimeError('private diagnostic must not escape')
                with self.assertRaises((scenario.ScenarioFailed, KeyboardInterrupt, RuntimeError)):
                    scenario.run(output, fake.compose, fake.plan, command=fake.command,
                                 assert_identity=identity if mode == 'identity' else fake.identity,
                                 observe=observe, clock=lambda: 0, pause=lambda _: None)
                self.assertEqual(fake.changes, [])
                artifact = (output / 'source-freshness.json').read_text()
                self.assertEqual(json.loads(artifact)['state'], 'failed')
                self.assertNotIn('private diagnostic', artifact)

    def test_retained_old_up_after_alloy_stop_cannot_claim_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            def observe(*args, **kwargs):
                value = fake.observe(*args, **kwargs)
                if 'alloy' in fake.stopped:
                    for row in value['sources'].values():
                        row.update(state='fresh_up', measured_at=102)
                return value
            def advance(_):
                fake.now += 1
            with self.assertRaises(scenario.ScenarioFailed):
                scenario.run(output, fake.compose, fake.plan, command=fake.command,
                             assert_identity=fake.identity, observe=observe,
                             clock=lambda: fake.now, pause=advance)
            self.assertEqual(fake.changes, [('stop', 'traces'), ('start', 'traces'), ('stop', 'alloy')])
            self.assertEqual(json.loads((output / 'source-freshness.json').read_text())['reason'], 'deadline')

    def test_old_down_or_recovery_samples_cannot_complete_a_phase(self):
        for stage in ('down', 'recovered'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                fake = FakePilot(output)
                def observe(*args, **kwargs):
                    value = fake.observe(*args, **kwargs)
                    if (stage == 'down' and 'traces' in fake.stopped) or (stage == 'recovered' and len(fake.changes) >= 2):
                        value['sources']['trace_store']['measured_at'] = 100
                    return value
                def advance(_):
                    fake.now += 1
                with self.assertRaises(scenario.ScenarioFailed):
                    scenario.run(output, fake.compose, fake.plan, command=fake.command,
                                 assert_identity=fake.identity, observe=observe,
                                 clock=lambda: fake.now, pause=advance)
                self.assertEqual(fake.changes, [('stop', 'traces')] if stage == 'down' else [('stop', 'traces'), ('start', 'traces')])
                self.assertEqual(json.loads((output / 'source-freshness.json').read_text())['reason'], 'deadline')

    def test_cleanup_accepts_only_typed_absence_of_exact_saved_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            scenario.run(output, fake.compose, fake.plan, command=fake.command,
                         assert_identity=fake.identity, observe=fake.observe,
                         clock=lambda: fake.now, pause=lambda _: None)
            calls = []
            def gone(args, **_):
                kind, identity = args[1], args[-1]
                calls.append((kind, identity))
                message = ('Error response from daemon: No such container: ' + identity if kind == 'container' else
                           'Error response from daemon: get ' + identity + ': no such volume' if kind == 'volume' else
                           'Error response from daemon: network ' + identity + ' not found')
                raise subprocess.CalledProcessError(1, args, output='[]', stderr=message + '\n')
            result = scenario.verify_cleanup(output, PROJECT, read=gone, clock=lambda: 0)
            self.assertEqual(result, {'outcome': 'passed', 'containers': 7, 'volumes': 4, 'networks': 2})
            self.assertEqual(len(calls), 13)
            def ambiguous(args, **_):
                raise subprocess.CalledProcessError(1, args, output='', stderr='daemon private-secret unavailable')
            result = scenario.verify_cleanup(output, PROJECT, read=ambiguous, clock=lambda: 0)
            self.assertEqual(result['outcome'], 'unproved')
            self.assertNotIn('private-secret', json.dumps(result))

    def test_cleanup_identity_consumes_shared_budget_before_inspect_can_start(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            scenario.run(output, fake.compose, fake.plan, command=fake.command,
                         assert_identity=fake.identity, observe=fake.observe,
                         clock=lambda: 0, pause=lambda _: None)
            now, identity_calls, inspections = [0], [], []
            def identity(**kwargs):
                identity_calls.append(kwargs)
                if len(identity_calls) == 5:
                    now[0] = 10
            def command(args, **kwargs):
                if args[1] == 'container':
                    inspections.append(args)
                return '[]' if '--format' in args else ''
            with patch.object(pilot, 'assert_docker_identity', side_effect=identity), \
                    patch.object(pilot, 'command', side_effect=command), \
                    patch.object(pilot.time, 'monotonic', side_effect=lambda: now[0]):
                result = pilot.cleanup_project(fake.compose, output, PROJECT)
            self.assertEqual(inspections, [])
            self.assertEqual(identity_calls[-1], {'deadline': 10})
            self.assertEqual(result['source_freshness']['outcome'], 'unproved')

    def test_original_cleanup_cannot_pass_when_saved_resource_absence_is_unproved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            (output / 'source-freshness-owned.json').write_text('{}')
            with patch.object(pilot, 'assert_docker_identity'), patch.object(pilot, 'command', return_value=''), \
                    patch.object(pilot, 'container_states', return_value={}), \
                    patch.object(scenario, 'verify_cleanup', return_value={'outcome': 'unproved'}):
                result = pilot.cleanup_project(['docker', 'compose'], output, PROJECT)
            self.assertEqual(result['down'], 'passed')
            self.assertNotEqual(result['residue'], 'passed')
            self.assertEqual(result['source_freshness']['outcome'], 'unproved')

    def test_worker_runs_freshness_after_existing_smoke_and_before_success_evidence(self):
        from contextlib import nullcontext
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            (output / 'owner.json').write_text(json.dumps({'supervisor_pid': pilot.os.getppid(), 'project': PROJECT}))
            (output / 'auth.json').write_text(json.dumps({'users': [{'bearer_token': 'private-token'}]}))
            (output / 'evidence.json').write_text('{}')
            order = []
            def smoke(*_):
                order.append('original smoke')
                return {}
            def freshness(*_, **kwargs):
                order.append('freshness')
                self.assertIs(kwargs['command'], pilot.command)
                self.assertIs(kwargs['assert_identity'], pilot.assert_docker_identity)
                return {'state': 'passed', 'duration_seconds': 12}
            with patch.object(pilot, 'worker_storage_guard', return_value=nullcontext()), \
                    patch.object(pilot, 'install_plugin'), patch.object(pilot, 'command'), \
                    patch.object(pilot, 'smoke', side_effect=smoke), patch.object(scenario, 'run', side_effect=freshness):
                pilot.run_worker(output)
            self.assertEqual(order, ['original smoke', 'freshness'])
            self.assertEqual(json.loads((output / 'evidence.json').read_text())['source_freshness'], 'passed')

    def test_oversized_observation_retains_bounded_failure_without_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            fake = FakePilot(output)
            def oversized(*args, **kwargs):
                report = fake.observe(*args, **kwargs)
                report['padding'] = 'x' * 140000
                return report
            with self.assertRaises(scenario.ScenarioFailed):
                scenario.run(output, fake.compose, fake.plan, command=fake.command,
                             assert_identity=fake.identity, observe=oversized, clock=lambda: 0)
            self.assertEqual(fake.changes, [])
            artifact = (output / 'source-freshness.json').read_bytes()
            self.assertLessEqual(len(artifact), scenario.ARTIFACT_BYTES)
            self.assertEqual(json.loads(artifact)['state'], 'failed')


if __name__ == '__main__':
    unittest.main()
