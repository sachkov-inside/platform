"""Bounded native source-outage proof inside the already-owned disposable Core pilot."""
import json
import math
from pathlib import Path
import re
import subprocess
import time

import source_status
import source_status_query

SCENARIO_SECONDS = 180
ARTIFACT_BYTES = 1_048_576
MAX_ACQUISITIONS = 720


class ScenarioFailed(RuntimeError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__('source freshness scenario failed; raw diagnostics withheld')


INSPECT = ('{"id":{{json .Id}},"image":{{json .Config.Image}},'
           '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
           '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
           '"config_files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},'
           '"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}')
CORE_ROLES = ('metrics', 'logs', 'traces', 'alloy', 'vmauth', 'gateway', 'grafana')


class OwnedTargets:
    def __init__(self, output, compose, plan, read, *, ownership_checkpoint=None):
        self.output, self.compose, self.plan, self.read = output, compose, plan, read
        self._ownership_observer = ownership_checkpoint
        try:
            self._ownership_stage(None, 'registry_shape')
            if (not isinstance(compose, list) or len(compose) != 6 or compose[:3] != ['docker', 'compose', '-p']
                    or compose[4] != '-f' or not re.fullmatch(r'inside-observability-pilot-[0-9a-f]{12}', compose[3])
                    or Path(compose[5]) != output / 'compose.json' or not output.is_absolute()
                    or set(plan['services']) != set(CORE_ROLES)
                    or set(plan['volumes']) != {'metrics', 'logs', 'traces', 'grafana'}
                    or set(plan['networks']) != {'pilot', 'ingress'}):
                raise ScenarioFailed('ownership')
            self.project = compose[3]
            self.targets = {}
            for role in CORE_ROLES:
                self._ownership_stage(role, 'lookup_read')
                cid = read(compose + ['ps', '-q', role]).strip()
                if not re.fullmatch(r'[0-9a-f]{64}', cid):
                    self._ownership_stage(role, 'lookup_empty' if cid == '' else 'lookup_id')
                    raise ScenarioFailed('ownership')
                self._ownership_stage(role, 'lookup_duplicate')
                if cid in {item['id'] for item in self.targets.values()}:
                    raise ScenarioFailed('ownership')
                self.targets[role] = self.inspect(role, cid)
            self._ownership_stage(None, 'registry_networks')
            networks = {}
            for item in self.targets.values():
                for name, network in item['networks'].items():
                    if name in networks and networks[name] != network:
                        raise ScenarioFailed('ownership')
                    networks[name] = network
            witness = {'project': self.project, 'containers': [item['id'] for item in self.targets.values()],
                       'volumes': sorted({mount[1] for item in self.targets.values() for mount in item['mounts'] if mount[0] == 'volume'}),
                       'networks': sorted(networks.values())}
            self._ownership_stage(None, 'registry_volumes')
            if len(witness['volumes']) != 4:
                raise ScenarioFailed('ownership')
            self._ownership_stage(None, 'registry_network_count')
            if len(witness['networks']) != 2:
                raise ScenarioFailed('ownership')
            self._ownership_stage(None, 'witness')
            (output / 'source-freshness-owned.json').write_text(json.dumps(witness, separators=(',', ':')))
        finally:
            self._ownership_observer = None

    def _ownership_stage(self, role, gate):
        if self._ownership_observer is not None:
            self._ownership_observer(role, gate)

    def inspect(self, role, cid):
        try:
            self._ownership_stage(role, 'inspect_read')
            raw = self.read(['docker', 'inspect', '--format', INSPECT, cid]).encode()
            self._ownership_stage(role, 'inspect_decode')
            item = source_status.decode_json(raw)
            self._ownership_stage(role, 'inspect_shape')
            if set(item) != {'id', 'image', 'project', 'service', 'config_files', 'mounts', 'networks'}:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_id')
            if item['id'] != cid:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_image')
            if item['image'] != self.plan['services'][role]['image']:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_project')
            if item['project'] != self.project:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_service')
            if item['service'] != role:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_config')
            if item['config_files'] != self.compose[5]:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_shape')
            if (not isinstance(item['mounts'], list) or len(item['mounts']) > 8
                    or not isinstance(item['networks'], dict)):
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_mount_plan')
            expected = []
            for value in self.plan['services'][role].get('volumes', []):
                source, destination, *options = value.split(':')
                volume = source in self.plan['volumes']
                expected.append(('volume' if volume else 'bind', self.project + '_' + source if volume else source,
                                 destination, 'ro' not in options))
            actual = []
            for mount in item['mounts']:
                self._ownership_stage(role, 'inspect_mount_shape')
                if mount['Type'] == 'tmpfs' and mount['Destination'] in {
                        value.split(':')[0] for value in self.plan['services'][role].get('tmpfs', [])} and mount['RW'] is True:
                    continue
                if type(mount['RW']) is not bool or mount['Type'] not in ('volume', 'bind'):
                    raise ScenarioFailed('ownership')
                actual.append((mount['Type'], mount['Name'] if mount['Type'] == 'volume' else mount['Source'],
                               mount['Destination'], mount['RW']))
            self._ownership_stage(role, 'inspect_mount_set')
            if sorted(actual) != sorted(expected):
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_network_set')
            names = {self.project + '_' + name for name in self.plan['services'][role]['networks']}
            if set(item['networks']) != names:
                raise ScenarioFailed('ownership')
            self._ownership_stage(role, 'inspect_network_ids')
            networks = {name: value['NetworkID'] for name, value in item['networks'].items()}
            if any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in networks.values()):
                raise ScenarioFailed('ownership')
            return {'id': cid, 'image': item['image'], 'mounts': sorted(actual), 'networks': networks}
        except (ValueError, KeyError, TypeError, AttributeError):
            raise ScenarioFailed('ownership') from None

    def check(self, role):
        if role not in ('traces', 'alloy', 'metrics'):
            raise ScenarioFailed('ownership')
        target = self.targets[role]
        current = self.read(self.compose + ['ps', '--all', '-q', role]).strip()
        if current != target['id'] or self.inspect(role, target['id']) != target:
            raise ScenarioFailed('ownership')
        return target['id']


def run(output, compose, plan, *, command, assert_identity, observe=None,
        clock=time.monotonic, pause=time.sleep):
    observe = observe or source_status_query.read_report
    started = clock()
    deadline = started + SCENARIO_SECONDS
    report = {'state': 'incomplete', 'phases': [], 'scope': 'pilot source freshness only',
              'ingestion_lag_acceptance': False, 'end_to_end_loss_accounting': False}
    acquisitions = 0
    last_clock = started
    def persist():
        raw = json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if len(raw.encode()) + 1 > ARTIFACT_BYTES:
            raise ScenarioFailed('artifact_cap')
        (output / 'source-freshness.json').write_text(raw + '\n')
    def remaining():
        nonlocal last_clock
        now = clock()
        if type(now) not in (int, float) or not math.isfinite(now) or now < last_clock:
            raise ScenarioFailed('clock')
        last_clock = now
        value = deadline - now
        if value <= 0:
            raise ScenarioFailed('deadline')
        return value
    def wait(phase, predicate):
        nonlocal acquisitions
        phase_started = clock()
        phase_acquisitions = acquisitions
        report['active_phase'] = phase
        persist()
        while True:
            if acquisitions >= MAX_ACQUISITIONS:
                raise ScenarioFailed('acquisition_cap')
            acquisitions += 1
            current = observe(output, deadline_seconds=min(10, remaining()))
            remaining()
            if len(json.dumps(current, allow_nan=False).encode()) > source_status.MAX_OUTPUT_BYTES:
                raise ScenarioFailed('observation_cap')
            if not isinstance(current, dict) or set(current.get('sources', {})) != {'collector', 'trace_store'}:
                raise ScenarioFailed('malformed')
            report['last_report'] = current
            persist()
            if any(row['state'] == 'malformed' for row in current['sources'].values()):
                raise ScenarioFailed('malformed')
            if predicate(current):
                report.pop('last_report', None)
                report.pop('active_phase', None)
                report['phases'].append({'phase': phase, 'report': current, 'outcome': 'passed',
                                         'attempts': acquisitions - phase_acquisitions,
                                         'duration_seconds': last_clock - phase_started})
                persist()
                return current
            pause(min(.25, remaining()))
    def up(current):
        return all(current['sources'][key]['state'] == 'fresh_up'
                   and type(current['sources'][key].get('measured_at')) in (int, float)
                   and math.isfinite(current['sources'][key]['measured_at'])
                   for key in ('collector', 'trace_store'))
    def newer(current, previous, keys=('collector', 'trace_store')):
        return all(type(current['sources'][key].get('measured_at')) in (int, float)
                   and current['sources'][key]['measured_at'] > previous['sources'][key]['measured_at']
                   for key in keys)
    def read(args):
        assert_identity(deadline=deadline)
        value = command(args, timeout=min(10, remaining()))
        assert_identity(deadline=deadline)
        remaining()
        return value
    def change(role, action):
        cid = targets.check(role)
        read(['docker', action, *(['--time', '2'] if action == 'stop' else []), cid])
        targets.check(role)
    try:
        persist()
        baseline = wait('baseline', up)
        targets = OwnedTargets(output, compose, plan, read)
        change('traces', 'stop')
        down = wait('vt_down', lambda value: value['sources']['collector']['state'] == 'fresh_up'
                    and value['sources']['trace_store']['state'] == 'fresh_down'
                    and newer(value, baseline, ('trace_store',)))
        change('traces', 'start')
        vt_recovered = wait('vt_recovered', lambda value: up(value) and newer(value, down, ('trace_store',)))
        change('alloy', 'stop')
        wait('alloy_down', lambda value: all(row['state'] in ('stale', 'missing') for row in value['sources'].values()))
        change('alloy', 'start')
        alloy_recovered = wait('alloy_recovered', lambda value: up(value) and newer(value, vt_recovered))
        change('metrics', 'stop')
        wait('query_unavailable', lambda value: all(row['state'] == 'query_unavailable' for row in value['sources'].values()))
        change('metrics', 'start')
        wait('query_recovered', lambda value: up(value) and newer(value, alloy_recovered))
        remaining()
        report.update(state='passed', acquisitions=acquisitions, duration_seconds=last_clock - started)
        persist()
        return report
    except BaseException as error:
        if isinstance(error, ScenarioFailed) and error.reason == 'artifact_cap':
            report.pop('last_report', None)
        report.update(state='failed', reason=error.reason if isinstance(error, ScenarioFailed) else 'boundary_failed',
                      acquisitions=acquisitions, duration_seconds=max(0, last_clock - started))
        try:
            persist()
        except Exception:
            if isinstance(error, Exception):
                raise ScenarioFailed('artifact_write') from None
        if isinstance(error, Exception):
            raise ScenarioFailed(report['reason']) from None
        raise


def verify_cleanup(output, project, *, read, clock=None):
    """Prove absence by exact saved identities; daemon failures remain unknown."""
    clock = clock or time.monotonic
    failed = {'outcome': 'unproved'}
    try:
        path = output / 'source-freshness-owned.json'
        if path.is_symlink() or path.stat().st_size > 65536:
            return failed
        witness = source_status.decode_json(path.read_bytes())
        if (set(witness) != {'project', 'containers', 'volumes', 'networks'}
                or witness['project'] != project
                or not re.fullmatch(r'inside-observability-pilot-[0-9a-f]{12}', project)):
            return failed
        for key, count in (('containers', 7), ('volumes', 4), ('networks', 2)):
            values = witness[key]
            if not isinstance(values, list) or len(values) != count or len(set(values)) != count:
                return failed
            if key == 'volumes':
                if set(values) != {project + '_' + role for role in ('metrics', 'logs', 'traces', 'grafana')}:
                    return failed
            elif any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value) for value in values):
                return failed
        previous = clock()
        deadline = previous + 10
        for key, kind in (('containers', 'container'), ('volumes', 'volume'), ('networks', 'network')):
            for identity in witness[key]:
                now = clock()
                if not math.isfinite(now) or now < previous or now >= deadline:
                    return failed
                previous = now
                try:
                    read(['docker', kind, 'inspect', identity], timeout=deadline - now, deadline=deadline)
                except subprocess.CalledProcessError as error:
                    expected = ('Error response from daemon: No such container: ' + identity if kind == 'container' else
                                'Error response from daemon: get ' + identity + ': no such volume' if kind == 'volume' else
                                'Error response from daemon: network ' + identity + ' not found')
                    if error.returncode != 1 or (error.stdout or '').strip() not in ('', '[]') or (error.stderr or '').strip() != expected:
                        return failed
                else:
                    return failed
        now = clock()
        if not math.isfinite(now) or now < previous or now >= deadline:
            return failed
        return {'outcome': 'passed', 'containers': 7, 'volumes': 4, 'networks': 2}
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError):
        return failed
