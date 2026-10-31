"""Frozen f578 Core owner, source-order/default compatibility oracle only.

Original module SHA256 906dda16dde9011d5c120d3c89b6a1bbd8081e5de2c73792a32f85f2f6ab0cc1; no native runtime evidence.
"""
import json
from pathlib import Path
import re
import source_status
from source_status_scenario import ScenarioFailed

INSPECT = ('{"id":{{json .Id}},"image":{{json .Config.Image}},'
           '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
           '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
           '"config_files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},'
           '"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}')


CORE_ROLES = ('metrics', 'logs', 'traces', 'alloy', 'vmauth', 'gateway', 'grafana')


class OwnedTargets:
    def __init__(self, output, compose, plan, read):
        self.output, self.compose, self.plan, self.read = output, compose, plan, read
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
            cid = read(compose + ['ps', '-q', role]).strip()
            if not re.fullmatch(r'[0-9a-f]{64}', cid) or cid in {item['id'] for item in self.targets.values()}:
                raise ScenarioFailed('ownership')
            self.targets[role] = self.inspect(role, cid)
        networks = {}
        for item in self.targets.values():
            for name, network in item['networks'].items():
                if name in networks and networks[name] != network:
                    raise ScenarioFailed('ownership')
                networks[name] = network
        witness = {'project': self.project, 'containers': [item['id'] for item in self.targets.values()],
                   'volumes': sorted({mount[1] for item in self.targets.values() for mount in item['mounts'] if mount[0] == 'volume'}),
                   'networks': sorted(networks.values())}
        if len(witness['volumes']) != 4 or len(witness['networks']) != 2:
            raise ScenarioFailed('ownership')
        (output / 'source-freshness-owned.json').write_text(json.dumps(witness, separators=(',', ':')))

    def inspect(self, role, cid):
        try:
            item = source_status.decode_json(self.read(['docker', 'inspect', '--format', INSPECT, cid]).encode())
            if (set(item) != {'id', 'image', 'project', 'service', 'config_files', 'mounts', 'networks'}
                    or item['id'] != cid or item['image'] != self.plan['services'][role]['image']
                    or item['project'] != self.project or item['service'] != role
                    or item['config_files'] != self.compose[5] or not isinstance(item['mounts'], list)
                    or len(item['mounts']) > 8 or not isinstance(item['networks'], dict)):
                raise ScenarioFailed('ownership')
            expected = []
            for value in self.plan['services'][role].get('volumes', []):
                source, destination, *options = value.split(':')
                volume = source in self.plan['volumes']
                expected.append(('volume' if volume else 'bind', self.project + '_' + source if volume else source,
                                 destination, 'ro' not in options))
            actual = []
            for mount in item['mounts']:
                if mount['Type'] == 'tmpfs' and mount['Destination'] in {
                        value.split(':')[0] for value in self.plan['services'][role].get('tmpfs', [])} and mount['RW'] is True:
                    continue
                if type(mount['RW']) is not bool or mount['Type'] not in ('volume', 'bind'):
                    raise ScenarioFailed('ownership')
                actual.append((mount['Type'], mount['Name'] if mount['Type'] == 'volume' else mount['Source'],
                               mount['Destination'], mount['RW']))
            if sorted(actual) != sorted(expected):
                raise ScenarioFailed('ownership')
            names = {self.project + '_' + name for name in self.plan['services'][role]['networks']}
            if set(item['networks']) != names:
                raise ScenarioFailed('ownership')
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
