"""Source-neutral SDK facts and immutable native-wrapper compatibility."""
import copy
import ast
import json
from pathlib import Path
import subprocess
import types
import linecache
import unittest

from decimal import Decimal
from unittest.mock import patch

import oracle
import test_oracle
import sdk_semantics
from test_oracle import trace_fixture, raw_traces, vector


def span_facts():
    return [{
        'name': row['name'], 'trace_id': row['trace_id'], 'span_id': row['span_id'],
        'parent_span_id': row.get('parent_span_id', ''),
        'start': int(row['start_time_unix_nano']), 'end': int(row['end_time_unix_nano']),
        'duration': int(row['duration']), 'flags': int(row['flags']),
        'kind': int(row['kind']), 'status_code': int(row['status_code']),
        'resource': {key.removeprefix('resource_attr:'): value for key, value in row.items() if key.startswith('resource_attr:')},
        'scope': {'name': row['scope_name'], 'version': None, 'attributes': None},
        'attributes': {key.removeprefix('span_attr:'): value for key, value in row.items() if key.startswith('span_attr:')},
        'extras': {key: None for key in ('trace_state', 'status_message', 'dropped_attributes_count',
                                        'dropped_events_count', 'dropped_links_count', 'link_metadata')},
    } for row in trace_fixture()]


class SpanSemantics(unittest.TestCase):
    def test_actual_three_span_chain_returns_only_semantic_subset_and_unknowns(self):
        facts = span_facts()
        before = copy.deepcopy(facts)
        verdict = sdk_semantics.spans(facts, trace_id='a'*32, root_id='b'*16, release='c'*40)
        self.assertEqual(verdict['sdk_span_semantics'], 'passed')
        self.assertEqual(verdict['stored_spans'], 3)
        self.assertIn('link_metadata', verdict['unknown_fields'])
        self.assertNotIn('privacy', verdict)
        self.assertEqual(facts, before)
        facts[2]['flags'] = 1
        with self.assertRaisesRegex(ValueError, '^SDK span semantics failed: trace_gate_05$'):
            sdk_semantics.spans(facts, trace_id='a'*32, root_id='b'*16, release='c'*40)

    def test_partial_neighbors_and_every_core_predicate_are_checked_before_pending(self):
        args = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        self.assertIsNone(sdk_semantics.spans([], **args))
        self.assertIsNone(sdk_semantics.spans(span_facts()[1:], **args))
        cases = [(1, span_facts(), {'trace_id': 'invalid'}), (2, span_facts()*2, {})]
        mutations = [(3, 2, 'name', 'unregistered'), (4, 2, 'span_id', 'b'*16),
                     (5, 2, 'kind', 1), (5, 2, 'status_code', 2),
                     (5, 2, 'flags', True), (5, 2, 'flags', '257'),
                     (5, 2, 'trace_id', 'f'*32), (6, 2, 'start', '1800000000001000000'),
                     (6, 2, 'duration', True), (7, 2, 'duration', 2),
                     (8, 0, 'span_id', 'f'*16), (9, 1, 'parent_span_id', 'f'*16),
                     (10, 2, 'parent_span_id', 'b'*16), (11, 2, 'parent_span_id', 'f'*16)]
        for gate, index, field, value in mutations:
            facts = span_facts()
            facts[index][field] = value
            cases.append((gate, facts, {}))
        facts = span_facts()
        facts[2].update(end=1800000000002600000, duration=1600000)
        cases.append((12, facts, {}))
        for gate, facts, arguments in cases:
            with self.subTest(gate=gate), self.assertRaisesRegex(ValueError, 'trace_gate_'+str(gate).zfill(2)+'$'):
                sdk_semantics.spans(facts, **{**args, **arguments})
        for field, value in (('_stream_id', 'fabricated'), ('_time', 'fabricated'), ('_msg', '-'),
                             ('attributes', {'url.full': 'private-value'})):
            facts = span_facts()[1:]
            facts[-1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                sdk_semantics.spans(facts, **args)
        facts = span_facts()[1:]
        facts[-1]['parent_span_id'] = 'f'*16
        with self.assertRaisesRegex(ValueError, 'trace_gate_11$'):
            sdk_semantics.spans(facts, **args)

    def test_known_empty_metadata_is_checked_and_missing_metadata_never_means_zero(self):
        facts = span_facts()
        for row in facts:
            row['scope'].update(version='', attributes={})
            row['extras'].update(trace_state='', status_message='', dropped_attributes_count=0,
                                 dropped_events_count=0, dropped_links_count=0)
        args = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        self.assertEqual(sdk_semantics.spans(facts, **args)['unknown_fields'], ('link_metadata',))
        for key, value in (('dropped_links_count', False), ('dropped_attributes_count', 1),
                           ('trace_state', 'private'), ('status_message', 'private'), ('link_metadata', [])):
            poisoned = copy.deepcopy(facts)
            poisoned[-1]['extras'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                sdk_semantics.spans(poisoned, **args)
        for key, value in (('version', 'unknown'), ('attributes', {'url.full': 'private'})):
            poisoned = copy.deepcopy(facts)
            poisoned[-1]['scope'][key] = value
            with self.assertRaises(ValueError):
                sdk_semantics.spans(poisoned, **args)
        facts[-1]['resource']['service.version'] = 'f'*40
        with self.assertRaises(ValueError):
            sdk_semantics.spans(facts, **args)


def metric_facts():
    facts = []
    for row in vector()['data']['result']:
        labels = row['metric']
        name = labels['__name__']
        histogram = name.endswith(('_count', '_sum', '_bucket'))
        gauge = name in ('http.server.active_requests', 'telemetry.trace.sampling.ratio') or name.startswith('inside.postgresql.pool.')
        facts.append({
            'name': name, 'native_name': name.rsplit('_', 1)[0]+'.'+name.rsplit('_', 1)[1] if histogram else name, 'value': float(row['value'][1]), 'timestamp': row['value'][0],
            'resource': {key: labels[key] for key in ('service.name', 'deployment.environment.name', 'service.version')},
            'scope': {'name': 'inside-collector', 'version': None, 'attributes': None},
            'attributes': {key: value for key, value in labels.items() if key not in
                           ('__name__', 'service.name', 'deployment.environment.name', 'service.version', 'scope.name')},
            'kind': 'histogram' if name.endswith('_bucket') else 'gauge' if gauge else 'sum',
            'unit': '1' if name.endswith('_count') else 's' if histogram else '', 'temporality': 'unspecified' if gauge else 'cumulative',
            'monotonic': not gauge, 'flags': 0, 'exemplars': None,
        })
    return facts


class MetricSemantics(unittest.TestCase):
    def test_full_67_series_has_distinct_semantic_verdict_and_checks_metadata(self):
        facts = metric_facts()
        verdict = sdk_semantics.metrics(facts, release='a'*40)
        self.assertEqual(verdict['sdk_metric_semantics'], 'passed')
        self.assertEqual(verdict['logical_series'], 67)
        self.assertIn('exemplars', verdict['unknown_fields'])
        self.assertNotIn('privacy', verdict)
        facts[2]['unit'] = 'ms'
        with self.assertRaisesRegex(ValueError, '^SDK metric semantics failed$'):
            sdk_semantics.metrics(facts, release='a'*40)

    def test_missing_series_pending_only_after_every_observed_poison_is_rejected(self):
        self.assertIsNone(sdk_semantics.metrics([], release='a'*40))
        facts = metric_facts()[1:]
        self.assertIsNone(sdk_semantics.metrics(facts, release='a'*40))
        for key, value in (('kind', 'gauge'), ('temporality', 'delta'), ('flags', 1),
                           ('flags', False), ('unit', 'ms'), ('monotonic', False),
                           ('value', True), ('value', '1'), ('value', float('inf')),
                           ('value', float('nan')), ('value', Decimal('sNaN')),
                           ('value', Decimal('1e10000')), ('timestamp', False),
                           ('timestamp', float('nan')), ('exemplars', []),
                           ('native_name', 'inside.dependency.duration.min')):
            poisoned = copy.deepcopy(facts)
            poisoned[0][key] = value
            with self.subTest(key=key, value=repr(value)), self.assertRaisesRegex(ValueError, '^SDK metric semantics failed$'):
                sdk_semantics.metrics(poisoned, release='a'*40)
        for mutation in ('duplicate', 'scope_variant', 'missing_bound', 'extra_bound', 'fractional',
                         'inconsistent_sum', 'nonmonotonic', 'resource_collision', 'scope_collision',
                         'point_collision', 'unknown_name', 'extra_field', 'unknown_suffix'):
            poisoned = copy.deepcopy(facts)
            if mutation in ('duplicate', 'scope_variant'):
                second = copy.deepcopy(poisoned[0])
                if mutation == 'scope_variant': second['scope']['version'] = 'unknown'
                poisoned = [poisoned[0], second]
            elif mutation == 'missing_bound':
                del poisoned[2]['attributes']['le']
            elif mutation == 'extra_bound': poisoned[2]['attributes']['le'] = '0.001'
            elif mutation == 'fractional': poisoned[0]['value'] = 0.5
            elif mutation == 'inconsistent_sum': poisoned[1]['value'] = 5.25
            elif mutation == 'nonmonotonic': poisoned[4]['value'] = 0
            elif mutation == 'resource_collision': poisoned[-1]['resource']['scope.name'] = 'inside-collector'
            elif mutation == 'scope_collision': poisoned[-1]['scope']['attributes'] = {'service.name': 'platform-api'}
            elif mutation == 'point_collision': poisoned[-1]['attributes']['service.name'] = 'platform-api'
            elif mutation == 'unknown_name': poisoned[-1]['name'] = 'unknown'
            elif mutation == 'extra_field': poisoned[-1]['stats'] = {'seriesFetched': '67'}
            else: poisoned[0]['native_name'] = 'inside_dependency_duration_count'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                sdk_semantics.metrics(poisoned, release='a'*40)

    def test_exact_histogram_bounds_and_native_component_metadata_remain_observations(self):
        facts = metric_facts()
        self.assertEqual([row['attributes']['le'] for row in facts[3:19]],
                         ['0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf'])
        for row in facts:
            row['scope'].update(version='', attributes={})
        self.assertEqual(sdk_semantics.metrics(facts, release='a'*40)['unknown_fields'], ('exemplars',))
        # A vector has no unit/type/temporality/flags metadata. Absence stays visible.
        for row in facts:
            for key in ('kind', 'unit', 'temporality', 'monotonic', 'flags'):
                row[key] = None
        verdict = sdk_semantics.metrics(facts, release='a'*40)
        self.assertEqual(verdict['unknown_fields'], ('exemplars', 'flags', 'kind', 'monotonic', 'temporality', 'unit'))
        for value in (True, '0', 0.0):
            poisoned = copy.deepcopy(facts)
            poisoned[0]['flags'] = value
            with self.assertRaises(ValueError):
                sdk_semantics.metrics(poisoned, release='a'*40)


BASE = '7c5269204d87efaa804038115a374fea3bf3e857'
ORACLE_PATH = 'scripts/observability-sdk-storage/oracle.py'


def baseline_oracle():
    root = Path(__file__).resolve().parents[2]
    source = subprocess.run(['git', 'show', BASE+':'+ORACLE_PATH], cwd=root,
                            check=True, capture_output=True, text=True).stdout
    module = types.ModuleType('immutable_sdk_oracle')
    module.__file__ = str(root/ORACLE_PATH)
    filename = '<immutable-sdk-oracle-'+BASE+'>'
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    exec(compile(source, filename, 'exec'), module.__dict__)
    return module, source


def observation(function, raw, arguments):
    try:
        return ('return', function(raw, **arguments))
    except BaseException as error:
        frames, tb = [], error.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_name != 'observation':
                frames.append((tb.tb_frame.f_code.co_name,
                               linecache.getline(tb.tb_frame.f_code.co_filename, tb.tb_lineno).strip()))
            tb = tb.tb_next
        return ('error', type(error), error.args, getattr(error, 'reason', None),
                error.__suppress_context__, type(error.__cause__), tuple(frames))


class LegacyCompatibility(unittest.TestCase):
    def test_all_original_function_statements_remain_except_terminal_calls(self):
        _, source = baseline_oracle()
        old = ast.parse(source)
        new = ast.parse(Path(oracle.__file__).read_text())
        old_functions = {node.name: node for node in old.body if isinstance(node, ast.FunctionDef)}
        new_functions = {node.name: node for node in new.body if isinstance(node, ast.FunctionDef)}
        for name, function in old_functions.items():
            current = copy.deepcopy(new_functions[name])
            if name in ('traces', 'metrics'):
                body = current.body[0].body
                additions = [i for i, node in enumerate(body) if isinstance(node, ast.Expr)
                             and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
                             and isinstance(node.value.func.value, ast.Name) and node.value.func.value.id == 'sdk_semantics']
                self.assertEqual(additions, [len(body)-2], 'shared check must occur immediately before original terminal success')
                del body[additions[0]]
            self.assertEqual(ast.dump(current, include_attributes=False), ast.dump(function, include_attributes=False))

    def test_original_unmodified_fixture_and_mutation_suite_passes_against_both_oracles(self):
        baseline, _ = baseline_oracle()
        for owner in (baseline, oracle):
            with self.subTest(owner=owner.__name__), patch.object(test_oracle, 'oracle', owner):
                result = unittest.TestResult()
                unittest.defaultTestLoader.loadTestsFromModule(test_oracle).run(result)
                self.assertEqual((result.errors, result.failures), ([], []))
                self.assertGreater(result.testsRun, 10)

    def test_success_pending_poison_and_all_twelve_gates_match_immutable_baseline(self):
        baseline, _ = baseline_oracle()
        arguments = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        cases = [(raw_traces(trace_fixture()), arguments), ('', arguments), ('{', arguments),
                 ('[]', arguments), ('{"name":"sdk-storage-private"}', arguments)]
        for rows in (trace_fixture()[:1], trace_fixture()[1:], trace_fixture()[::2]):
            cases.append((raw_traces(rows), arguments))
        mutations = ((0, 'span_id', 'f'*16), (1, 'parent_span_id', 'f'*16),
                     (2, 'parent_span_id', 'b'*16), (2, 'parent_span_id', 'f'*16),
                     (2, 'name', 'unknown'), (2, 'kind', 3), (2, 'span_id', 'b'*16),
                     (2, 'flags', '1'), (2, 'duration', '01'), (2, 'duration', '2'),
                     (2, 'end_time_unix_nano', '1800000000002600000'))
        for index, key, value in mutations:
            rows = trace_fixture()
            rows[index][key] = value
            if key == 'end_time_unix_nano':
                rows[index]['duration'] = '1600000'
            cases.append((raw_traces(rows), arguments))
        cases.extend([(raw_traces(trace_fixture()*2), arguments),
                      (raw_traces(trace_fixture()), {**arguments, 'trace_id': 'invalid'})])
        for optional in ({'scope_version': '', 'trace_state': '', 'status_message': '',
                          'dropped_attributes_count': '0', 'dropped_events_count': '0', 'dropped_links_count': '0'}, {}):
            rows = trace_fixture()
            for row in rows:
                row.update(optional)
            rows[0]['parent_span_id'] = ''
            cases.append((raw_traces(rows), arguments))
        for raw, kwargs in cases:
            with self.subTest(raw=raw[:30], arguments=kwargs):
                self.assertEqual(observation(oracle.traces, raw, kwargs), observation(baseline.traces, raw, kwargs))
        bodies = [vector(), {'status': 'success', 'data': {'resultType': 'vector', 'result': []}}]
        for scope in ('', 'unknown'):
            body = vector()
            for row in body['data']['result']:
                row['metric']['scope.version'] = scope
            bodies.append(body)
        for mutation in ('missing', 'duplicate', 'private', 'histogram', 'stats', 'self_scrape', 'late_poison'):
            body = vector()
            rows = body['data']['result']
            if mutation == 'missing': rows.pop(0)
            elif mutation == 'duplicate': rows.append(copy.deepcopy(rows[0]))
            elif mutation == 'private': rows[-1]['metric']['private'] = 'private-filename'
            elif mutation == 'histogram': rows[3]['value'][1] = '1'
            elif mutation == 'stats': body['stats']['seriesFetched'] = True
            elif mutation == 'self_scrape': rows.append({'metric': {'__name__': 'up', 'job': 'platform-collector', 'instance': 'pilot'}, 'value': [1800000000, '1']})
            else:
                rows.pop(0)
                rows[-1]['metric']['unknown'] = 'late-poison'
            bodies.append(body)
        for raw in [*(json.dumps(body) for body in bodies), '{', 'null']:
            with self.subTest(metric=raw[:30]):
                self.assertEqual(observation(oracle.metrics, raw, {'release': 'a'*40}),
                                 observation(baseline.metrics, raw, {'release': 'a'*40}))


if __name__ == '__main__':
    unittest.main()
