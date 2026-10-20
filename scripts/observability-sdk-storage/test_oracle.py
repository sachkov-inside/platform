"""Full raw SDK storage seam: malformed neighbors cannot hide behind pending."""
import copy
import json
import unittest
import oracle


class StoredSdkS3(unittest.TestCase):
    def test_empty_vector_is_pending_but_unknown_private_neighbor_fails_first(self):
        response = {'status': 'success', 'stats': {'seriesFetched': '0', 'executionTimeMsec': 0},
                    'data': {'resultType': 'vector', 'result': []}}
        self.assertIsNone(oracle.metrics(json.dumps(response), release='a'*40))
        poison = copy.deepcopy(response)
        poison['data']['result'] = [{'metric': {'__name__': 'private.key', 'key': 'sdk-storage-private'}, 'value': [1, '1']}]
        with self.assertRaisesRegex(RuntimeError, '^SDK storage metric contract failed$'):
            oracle.metrics(json.dumps(poison), release='a'*40)


def vector():
    common = {'service.name': 'platform-api', 'deployment.environment.name': 'test', 'service.version': 'a'*40, 'scope.name': 'inside-collector'}
    rows = []
    def row(name, value, attrs):
        rows.append({'metric': {'__name__': name, **common, **attrs}, 'value': [1800000000, str(value)]})
    for operation in ('getObject.read', 'http.GET'):
        attrs = {'dependency': 's3', 'operation': operation, 'outcome': 'completed'}
        row('inside.dependency.operations', 1, attrs)
        row('inside.dependency.duration_count', 1, attrs)
        row('inside.dependency.duration_sum', '0.25', attrs)
        for bound in ('0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf'):
            row('inside.dependency.duration_bucket', 0 if bound == '0' else 1, {**attrs, 'le': bound})
    attrs = {'http.request.method': 'GET', 'http.route': '/pilot', 'http.request.outcome': 'completed', 'http.response.status_code': '200'}
    row('http.server.request.count', 1, attrs)
    row('http.server.request.duration_count', 1, attrs)
    row('http.server.request.duration_sum', '0.25', attrs)
    for bound in ('0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf'):
        row('http.server.request.duration_bucket', 0 if bound == '0' else 1, {**attrs, 'le': bound})
    for name in ('http.server.active_requests', 'telemetry.trace.dropped', 'telemetry.trace.export.failures', 'telemetry.metric.export.failures', 'inside.postgresql.pool.available', 'inside.postgresql.pool.total', 'inside.postgresql.pool.idle', 'inside.postgresql.pool.waiting', 'inside.postgresql.pool.registry_overflow'):
        row(name, 0, {})
    row('telemetry.trace.sampling.ratio', 1, {})
    return {'status': 'success', 'stats': {'seriesFetched': '67', 'executionTimeMsec': 0}, 'data': {'resultType': 'vector', 'result': rows}}


class CompleteMetricVector(unittest.TestCase):
    def test_full_native_sdk_vector_separates_dependency_from_other_owners(self):
        verdict = oracle.metrics(json.dumps(vector()), release='a'*40)
        self.assertEqual(verdict, {'s3_dependency_series': 38, 'other_sdk_series': 29, 'self_scrape_series': 0, 'full_vector_series': 67, 'privacy': 'passed', 'sdk_metrics': 'passed'})

    def test_full_vector_denies_duplicate_private_unknown_metadata_and_bad_histogram(self):
        for mutation in ('duplicate', 'unknown', 'private', 'stats', 'bucket', 'value', 'missing_dimension', 'wrong_environment', 'unknown_scope', 'wrong_bucket_count'):
            with self.subTest(case=mutation):
                body = vector()
                rows = body['data']['result']
                if mutation == 'duplicate':
                    rows.append(copy.deepcopy(rows[0]))
                elif mutation == 'unknown':
                    rows[-1]['metric']['__name__'] = 'inside.unknown'
                elif mutation == 'private':
                    rows[-1]['metric']['private'] = 'sdk-storage-private'
                elif mutation == 'stats':
                    body['stats']['private'] = 'sdk-storage-private'
                elif mutation == 'bucket':
                    rows[3]['metric']['le'] = '0.001'
                elif mutation == 'value':
                    rows[0]['value'][1] = '2'
                elif mutation == 'missing_dimension':
                    del rows[0]['metric']['outcome']
                elif mutation == 'wrong_environment':
                    rows[0]['metric']['deployment.environment.name'] = 'production'
                elif mutation == 'unknown_scope':
                    rows[0]['metric']['scope.version'] = 'private-filename'
                else:
                    rows[5]['value'][1] = '0'
                with self.assertRaisesRegex(RuntimeError, '^SDK storage metric contract failed$'):
                    oracle.metrics(json.dumps(body), release='a'*40)

    def test_missing_owned_series_is_pending_but_late_poison_still_fails(self):
        body = vector()
        body['data']['result'].pop(0)
        self.assertIsNone(oracle.metrics(json.dumps(body), release='a'*40))
        body['data']['result'][-1]['metric']['private'] = 'private-filename'
        with self.assertRaises(RuntimeError):
            oracle.metrics(json.dumps(body), release='a'*40)

    def test_additional_closed_self_scrape_owner_is_validated_and_counted(self):
        body = vector()
        body['data']['result'].append({'metric': {'__name__': 'up', 'job': 'platform-collector', 'instance': 'pilot'}, 'value': [1800000000, '1']})
        self.assertEqual(oracle.metrics(json.dumps(body), release='a'*40)['self_scrape_series'], 1)
        body['data']['result'][-1]['metric']['url'] = 'http://private/'
        with self.assertRaises(RuntimeError):
            oracle.metrics(json.dumps(body), release='a'*40)


class TraceRows(unittest.TestCase):
    def test_empty_pending_late_private_or_unknown_row_rejected(self):
        self.assertIsNone(oracle.traces('', trace_id='a'*32, root_id='b'*16, release='c'*40))
        with self.assertRaisesRegex(RuntimeError, '^SDK storage trace contract failed$'):
            oracle.traces('{"private":"sdk-storage-private"}\n', trace_id='a'*32, root_id='b'*16, release='c'*40)


def trace_fixture():
    rows = []
    for name, span, parent, kind, start, end, attrs in (
        ('GET /pilot', 'b'*16, '', '2', 1800000000000000000, 1800000000003000000,
         {'http.request.method': 'GET', 'http.route': '/pilot', 'http.request.outcome': 'completed', 'http.response.status_code': '200'}),
        ('s3 getObject.read', 'c'*16, 'b'*16, '1', 1800000000001000000, 1800000000002500000,
         {'dependency.name': 's3', 'dependency.operation': 'getObject.read', 'dependency.outcome': 'completed'}),
        ('s3 http.GET', 'd'*16, 'c'*16, '3', 1800000000001000000, 1800000000002000000,
         {'dependency.name': 's3', 'dependency.operation': 'http.GET', 'dependency.outcome': 'completed', 'http.request.method': 'GET', 'http.response.status_code': '200'})):
        stamp = {1800000000000000000: '2027-01-15T08:00:00Z', 1800000000001000000: '2027-01-15T08:00:00.001Z'}[start]
        rows.append({'trace_id': 'a'*32, 'span_id': span, **({'parent_span_id': parent} if parent else {}),
                     'resource_attr:service.name': 'platform-api', 'resource_attr:deployment.environment.name': 'test', 'resource_attr:service.version': 'c'*40,
                     'scope_name': 'inside-collector', 'name': name, 'kind': kind, 'status_code': '0', 'flags': '1',
                     'start_time_unix_nano': str(start), 'end_time_unix_nano': str(end), 'duration': str(end-start),
                     '_time': stamp, '_stream_id': '0'*16+str(len(rows)+1)*32,
                     '_stream': '{name='+json.dumps(name)+',resource_attr:service.name="platform-api"}', '_msg': '-',
                     **{'span_attr:'+key: value for key, value in attrs.items()}})
    return rows


def raw_traces(rows):
    return '\n'.join(json.dumps(row) for row in rows)


class CompleteTraces(unittest.TestCase):
    def test_three_native_rows_prove_exact_kind_and_read_http_parent_edges(self):
        self.assertEqual(oracle.traces(raw_traces(trace_fixture()), trace_id='a'*32, root_id='b'*16, release='c'*40),
                         {'stored_spans': 3, 'test_owned_root': 'passed', 's3_read_http_causality': 'passed', 'privacy': 'passed'})

    def test_missing_row_pending_but_all_observed_fields_checked(self):
        rows = trace_fixture()[1:]
        self.assertIsNone(oracle.traces(raw_traces(rows), trace_id='a'*32, root_id='b'*16, release='c'*40))
        for key, value in (('unknown', 'private-value'), ('span_attr:url.full', 'http://private/'), ('parent_span_id', 'b'*16), ('kind', '1'), ('flags', '0'), ('status_message', 'raw-error'), ('_time', '2027-01-15T08:00:00.002Z')):
            with self.subTest(field=key):
                poison = copy.deepcopy(rows)
                poison[-1][key] = value
                with self.assertRaisesRegex(RuntimeError, '^SDK storage trace contract failed$'):
                    oracle.traces(raw_traces(poison), trace_id='a'*32, root_id='b'*16, release='c'*40)

    def test_duplicate_and_extra_row_rejected(self):
        for rows in ([*trace_fixture(), trace_fixture()[0]], [trace_fixture()[0], trace_fixture()[0]]):
            with self.assertRaises(RuntimeError):
                oracle.traces(raw_traces(rows), trace_id='a'*32, root_id='b'*16, release='c'*40)


class HistogramSemantics(unittest.TestCase):
    def test_one_observation_histogram_bucket_must_agree_with_stored_sum(self):
        body = vector()
        body['data']['result'][3]['value'][1] = '1'
        with self.assertRaisesRegex(RuntimeError, '^SDK storage metric contract failed$'):
            oracle.metrics(json.dumps(body), release='a'*40)


class LogicalSdkDuplicates(unittest.TestCase):
    def test_full_and_partial_vectors_reject_scope_variants_of_the_same_metric(self):
        # Each optional scope form is individually allowed. Combining them must
        # never create a second observation of one logical SDK metric.
        scopes = (None, '', 'unknown')
        metrics = (('dependency_counter', 0, '2'), ('dependency_sum', 2, '0.5'),
                   ('dependency_bucket', 3, '1'), ('http_counter', 38, '2'),
                   ('http_sum', 40, '0.5'), ('http_bucket', 41, '1'),
                   ('health_scalar', 57, '0'))
        for mode in ('full', 'partial'):
            for name, index, contradictory in metrics:
                for first_scope in scopes:
                    for second_scope in scopes:
                        if first_scope == second_scope:
                            continue
                        for values in (('same',) if name == 'health_scalar' else ('same', 'contradictory')):
                            with self.subTest(vector=mode, metric=name, first_scope=first_scope,
                                              second_scope=second_scope, values=values):
                                body = vector()
                                first = body['data']['result'][index]
                                if first_scope is not None:
                                    first['metric']['scope.version'] = first_scope
                                second = copy.deepcopy(first)
                                second['metric'].pop('scope.version', None)
                                if second_scope is not None:
                                    second['metric']['scope.version'] = second_scope
                                if values == 'contradictory':
                                    second['value'][1] = contradictory
                                body['data']['result'] = ([*body['data']['result'], second]
                                                         if mode == 'full' else [first, second])
                                with self.assertRaisesRegex(RuntimeError, '^SDK storage metric contract failed$'):
                                    oracle.metrics(json.dumps(body), release='a'*40)

    def test_each_single_scope_variant_remains_valid_without_duplicate_observations(self):
        for scope in (None, '', 'unknown'):
            with self.subTest(scope=scope):
                body = vector()
                if scope is not None:
                    for row in body['data']['result']:
                        row['metric']['scope.version'] = scope
                self.assertEqual(oracle.metrics(json.dumps(body), release='a'*40)['s3_dependency_series'], 38)


if __name__ == '__main__':
    unittest.main()
