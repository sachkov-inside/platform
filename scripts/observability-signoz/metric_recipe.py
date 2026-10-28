"""Offline-only fixed SigNoz v5 payload constructors; no transport or SQL input."""
LIMITS = (' SETTINGS max_execution_time=5, max_rows_to_read=100000, '
          'max_bytes_to_read=8388608, max_memory_usage=134217728, '
          "read_overflow_mode='throw', result_overflow_mode='throw', max_result_rows=4")

def require(ok):
    if not ok:
        raise ValueError('closed metric operation required')

def envelope(query, start, end, request_type):
    return {'schemaVersion': 'v1', 'start': start, 'end': end,
            'requestType': request_type, 'compositeQuery': {'queries': [
                {'type': 'clickhouse_sql', 'spec': {'name': 'A', 'query': query}}]}}

class FixedMetricReads:
    def __init__(self, phase, start_ms, end_ms):
        # Trusted fixture phase/window only, never agent-provided SQL/identifier/value fragments.
        require(type(phase) is int and 0 <= phase <= 13)
        require(type(start_ms) is int and type(end_ms) is int)
        require(0 < start_ms < end_ms < 2**53 and end_ms - start_ms <= 600000)
        self.cohort = '1566' * 9 + format(phase, '04x')
        self.start, self.end = start_ms, end_ms

    def call(self, operation, parameters):
        require(type(parameters) is dict and parameters == {})
        require(operation == 'retained_sample_count')
        start, end = self.start, self.end
        # Exporter rounds time-series catalog unix_milli DOWN TO AN HOUR.
        catalog_start = start // 3600000 * 3600000
        if operation == 'retained_sample_count':
            query = f'''SELECT count() AS raw_count, uniqExact(value) AS distinct_indices,
min(value) AS min_index, max(value) AS max_index,
countIf(value != floor(value)) AS noninteger_indices,
countIf(flags != 0) AS flagged_samples
FROM signoz_metrics.distributed_samples_v4
WHERE metric_name = 'pilot_requests' AND temporality = 'Unspecified'
AND unix_milli >= {start} AND unix_milli <= {end}
AND (env, temporality, metric_name, fingerprint) GLOBAL IN
(SELECT env, temporality, metric_name, fingerprint
 FROM signoz_metrics.distributed_time_series_v4
 WHERE metric_name = 'pilot_requests' AND temporality = 'Unspecified'
 AND unix_milli >= {catalog_start} AND unix_milli <= {end}
 AND resource_attrs['service.name'] = 'platform-pilot'
 AND resource_attrs['service.version'] = '{self.cohort}'
 AND attrs['http.route'] = '/pilot')'''
            return envelope(query + LIMITS, start, end, 'scalar')
