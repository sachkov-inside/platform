"""Public pure contract; fixed native bodies are observations, not a metrics engine."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-pilot'))
import owner_overview as overview


REQUEST = dict(service='platform-api', environment='test', before_sha='a'*40,
               after_sha='b'*40, before_start='2026-10-21T08:00:00Z',
               before_end='2026-10-21T09:00:00Z', after_start='2026-10-21T09:00:00Z',
               after_end='2026-10-21T10:00:00Z', evaluated_at='2026-10-21T10:00:00Z')


class OverviewContract(unittest.TestCase):
    def test_plan_has_ten_fixed_queries_with_explicit_windows_and_native_bounds(self):
        plan = overview.plan(REQUEST)
        self.assertEqual([q['id'] for q in plan['queries']], [
            'B.volume', 'B.speed', 'B.load', 'B.quality', 'A.volume', 'A.speed',
            'A.load', 'A.quality', 'freshness.values', 'freshness.timestamps'])
        self.assertEqual(len(plan['queries']), 10)
        for query in plan['queries']:
            self.assertEqual(query['arguments']['timeout'], '2s')
            self.assertIs(query['arguments']['nocache'], True)
            self.assertIs(query['arguments']['trace'], False)
            self.assertEqual(query['tool'], 'query')
        self.assertEqual(plan['queries'][0]['arguments']['time'], REQUEST['before_end'])
        self.assertEqual(plan['queries'][4]['arguments']['time'], REQUEST['after_end'])

    def test_reduce_preserves_native_estimates_and_rejects_unwitnessed_freshness(self):
        import json
        plan = overview.plan(REQUEST)
        instant = 1792576800
        def response(fields):
            body = {'status': 'success', 'data': {'resultType': 'vector', 'result': [
                {'metric': {'field': key}, 'value': [instant - 3600, str(value)]}
                for key, value in fields.items()]}}
            return {'content': [{'type': 'text', 'text': json.dumps(body)}]}
        result = overview.reduce(plan, [{'id': 'B.volume', 'state': 'received',
            'response': response({'requests_estimate': 201.5, 'five_xx_estimate': 4}),
            'completed_at': '2026-10-21T10:00:01Z'}])
        self.assertEqual(result['cohorts']['B']['values']['requests_estimate'], 201.5)
        self.assertIsNone(result['cohorts']['B']['values']['p95_seconds'])
        self.assertEqual(result['sources']['collector']['state'], 'unknown')
        self.assertEqual(result['causality'], 'not_established')
        self.assertEqual(result['cohorts']['B']['historical_gap_count'], None)

    def test_quality_completion_and_poison_preserve_only_admitted_observations(self):
        import copy
        import json
        from datetime import datetime
        import source_status
        prepared = overview.plan(REQUEST)
        epoch = int(datetime.fromisoformat(REQUEST['evaluated_at'][:-1] + '+00:00').timestamp())
        def wire(rows):
            return {'content': [{'type': 'text', 'text': json.dumps(
                {'status': 'success', 'data': {'resultType': 'vector', 'result': rows}})}]}
        def fixture():
            result = []
            for query in prepared['queries'][:8]:
                kind = query['id'].split('.')[1]
                values = {
                    'volume': dict(requests_estimate=200.5, five_xx_estimate=4, four_xx_estimate=2,
                                   aborted_estimate=0, duration_observations_estimate=200),
                    'speed': dict(p50_seconds=.2, p95_seconds=.8, p99_seconds=1.2, five_xx_share=.02),
                    'load': dict(requests_per_second_estimate=.05, active_requests_sample_mean=1,
                                 active_requests_sample_max=3),
                    'quality': dict(minimum_counter_samples=718, minimum_histogram_samples=718,
                        counter_resets=0, minimum_trace_sampling_ratio=1, metric_export_failures_estimate=0,
                        trace_drops_estimate=0, current_sources_usable=1, collection_failure_estimate=0),
                }[kind]
                if query['id'] == 'A.speed':
                    values['p95_seconds'] = 1.0
                at = epoch - 3600 if query['id'].startswith('B.') else epoch
                result.append(dict(id=query['id'], state='received', completed_at='2026-10-21T10:00:01Z',
                    response=wire([{'metric': {'field': key}, 'value': [at, str(value)]}
                                   for key, value in values.items()])))
            rows = []
            for key, job in source_status.SOURCES.items():
                rows.append({'metric': {'__name__': 'up', 'job': job, 'instance': 'pilot'}, 'value': [epoch, '1']})
                if key == 'collector':
                    families = {name: {} for name in source_status.COLLECTOR_COUNTERS | source_status.COLLECTOR_GAUGES}
                else:
                    families = {name: dimensions[0] for name, dimensions in source_status.TRACE_COUNTERS.items()}
                for name, dimensions in families.items():
                    rows.append({'metric': {'__name__': name, 'job': job, 'instance': 'pilot', **dimensions},
                                 'value': [epoch, '0']})
            stamps = [{'metric': {**{key: value for key, value in row['metric'].items() if key != '__name__'},
                                  'source_metric': row['metric']['__name__']}, 'value': [epoch, str(epoch)]} for row in rows]
            for name, payload in [('freshness.values', rows), ('freshness.timestamps', stamps)]:
                result.append(dict(id=name, state='received', completed_at='2026-10-21T10:00:01Z', response=wire(payload)))
            return result
        base = fixture()
        report = overview.reduce(prepared, base)
        self.assertEqual(report['cohorts']['B']['values']['p95_seconds'], .8)
        self.assertEqual(report['cohorts']['A']['values']['p95_seconds'], 1)
        self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
        for field, value in [('duration_observations_estimate', 99), ('counter_resets', 1),
                             ('minimum_counter_samples', 717), ('minimum_histogram_samples', 717),
                             ('metric_export_failures_estimate', 1), ('collection_failure_estimate', 1),
                             ('current_sources_usable', 0)]:
            with self.subTest(quality=field):
                changed = copy.deepcopy(base)
                idx = 0 if field == 'duration_observations_estimate' else 3
                body = json.loads(changed[idx]['response']['content'][0]['text'])
                row = next(row for row in body['data']['result'] if row['metric']['field'] == field)
                row['value'][1] = str(value)
                changed[idx]['response']['content'][0]['text'] = json.dumps(body)
                result = overview.reduce(prepared, changed)
                self.assertIsNone(result['cohorts']['B']['values']['p50_seconds'])
                self.assertEqual(result['cohorts']['B']['reason'], 'quality_gate_mismatch')
        for completed in (None, '2026-10-21T10:00:11Z', '2026-10-21T09:59:59Z', 'not-time-private'):
            with self.subTest(completion=completed):
                changed = copy.deepcopy(base)
                changed[-1]['completed_at'] = completed
                result = overview.reduce(prepared, changed)
                self.assertIsNone(result['cohorts']['B']['values']['p95_seconds'])
                self.assertNotIn('not-time-private', json.dumps(result))
        for poison in ('duplicate', 'unknown', 'private-label', 'nonfinite', 'error', 'oversize'):
            with self.subTest(poison=poison):
                changed = copy.deepcopy(base)
                body = json.loads(changed[1]['response']['content'][0]['text'])
                if poison == 'duplicate':
                    body['data']['result'].append(body['data']['result'][0])
                elif poison == 'unknown':
                    body['data']['result'][-1]['metric']['field'] = 'private-canary'
                elif poison == 'private-label':
                    body['data']['result'][-1]['metric']['account'] = 'private-canary'
                elif poison == 'nonfinite':
                    body['data']['result'][-1]['value'][1] = 'Infinity'
                changed[1]['response']['content'][0]['text'] = json.dumps(body)
                if poison == 'error':
                    changed[1]['response']['isError'] = True
                if poison == 'oversize':
                    changed[1]['response']['content'][0]['text'] = 'private-canary' * 100000
                result = overview.reduce(prepared, changed)
                self.assertIsNone(result['cohorts']['B']['values']['p50_seconds'])
                self.assertEqual(result['cohorts']['B']['values']['requests_estimate'], 200.5)
                self.assertNotIn('private-canary', json.dumps(result))
        partial = base[:2] + [dict(id='B.load', state='interrupted', response=None, completed_at=None)]
        result = overview.reduce(prepared, partial)
        self.assertEqual(result['cohorts']['B']['values']['requests_estimate'], 200.5)
        self.assertEqual(result['sources']['collector']['state'], 'unknown')
        self.assertEqual(result['query_evidence'][-1]['state'], 'interrupted')
        self.assertIsNone(result['query_evidence'][-1]['completed_at'])

    def test_invalid_requests_are_refused_before_query_rendering(self):
        for key, value in [('after_sha', 'a'*40), ('before_sha', 'private-canary'),
                           ('service', '.*'), ('environment', 'unknown'),
                           ('after_start', '2026-10-21T08:30:00Z'),
                           ('after_end', '2026-10-21T11:00:00Z'),
                           ('evaluated_at', '2026-10-21T10:00:00+00:00')]:
            with self.subTest(key=key):
                changed = {**REQUEST, key: value}
                with self.assertRaisesRegex(ValueError, 'values withheld'):
                    overview.plan(changed)
        with self.assertRaises(ValueError):
            overview.plan({**REQUEST, 'query': 'private-canary'})

    def test_native_and_dashboard_quality_mask_share_one_catalogue(self):
        prepared = overview.plan(REQUEST)
        before = prepared['queries'][1]['arguments']['query']
        after = prepared['queries'][5]['arguments']['query']
        for expression in (before, after):
            self.assertIn('and on()', expression)
            self.assertIn('>= 100', expression)
            self.assertIn('>= 718', expression)
            self.assertIn('label_match(label_set(vector(1)', expression)
            self.assertIn('<= 10', expression)
            self.assertNotIn('bool', expression)
            self.assertNotIn('vector(0)', expression)
        self.assertEqual(prepared['queries'][3]['row_cap'], 16)
        self.assertLess(len(before.encode()), 65536)
        dashboard = overview.dashboard()
        target = next(panel for panel in dashboard['dashboard']['panels'] if panel.get('title') == 'B: Speed and 5xx share, quality gated')['targets'][0]
        self.assertIn('>= 100', target['expr'])
        self.assertIn('>= 718', target['expr'])
        self.assertIn('and on()', target['expr'])

    def test_actual_targets_contain_hostile_variable_literals_without_reinterpretation(self):
        import json
        import re
        import urllib.parse
        view = overview.dashboard()['dashboard']
        targets = [target['expr'] for panel in view['panels'] for target in panel.get('targets', [])]
        self.assertEqual(len(targets), 10)
        self.assertEqual(json.dumps(view).count('Temporary semantic Grafana overview'), 1)
        substitutions = dict(service='platform-api', environment='test', before_sha='a'*40, after_sha='b'*40)
        # Source-qualified model of scenes8.13.5 strict percentencode, not vendor execution.
        def interpolate(expression, value):
            values = {**substitutions, 'before_sha': value}
            def replace(match):
                entry = values[match.group(1)]
                if isinstance(entry, list):
                    entry = '{' + ','.join(entry) + '}'
                return urllib.parse.quote(entry, safe='-_.~')
            return re.sub(r'\$\{(service|environment|before_sha|after_sha):percentencode\}', replace, expression)
        cases = [('', ''), ('"\\\n\x00%!*()\'', '%22%5C%0A%00%25%21%2A%28%29%27'),
                 ('а', '%D0%B0'), (['a'*40, 'b'*40], '%7B'+'a'*40+'%2C'+'b'*40+'%7D'),
                 ('x'*10000, 'x'*10000), ('a'*40, 'a'*40)]
        for value, encoded in cases:
            with self.subTest(kind=type(value).__name__, length=len(value)):
                found = 0
                for expression in targets:
                    if '${before_sha:percentencode}' not in expression:
                        continue
                    actual = interpolate(expression, value)
                    self.assertIn('"' + encoded + '"', actual)
                    self.assertNotIn('${before_sha:', actual)
                    self.assertIn('service.version=~"^[0-9a-f]{40}$"', actual)
                    self.assertNotIn(':regex}', expression)
                    self.assertNotIn(':json}', expression)
                    found += 1
                self.assertGreater(found, 0)
        for variable in view['templating']['list']:
            self.assertFalse(variable['multi'])
            self.assertFalse(variable['includeAll'])
        with self.assertRaises(UnicodeEncodeError):
            interpolate(targets[0], '\ud800')
        native = overview.plan(REQUEST)['queries'][1]['arguments']['query']
        dashboard_target = next(panel for panel in view['panels'] if panel.get('title') == 'B: Speed and 5xx share, quality gated')['targets'][0]['expr']
        # Undo ONLY known renderer substitutions, not execute/parse the expressions.
        restored = dashboard_target
        for name, value in substitutions.items():
            restored = restored.replace('${' + name + ':percentencode}', value)
        restored = restored.replace('((${__to}) / 1000)', '1792576800')
        self.assertEqual(restored, '(' + native + ') @ (1792576800 - 3600)')
