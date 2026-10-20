"""Behavioral contracts for the bounded pilot source-status read model."""
import json
import unittest

import source_status


def envelope(rows):
    return json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': rows}}).encode()


def row(name='up', job='platform-collector', value='1', **dimensions):
    return {'metric': {'__name__': name, 'job': job, 'instance': 'pilot', **dimensions},
            'value': [100, value]}


def times(rows, stamp='99'):
    return [{**item, 'metric': {key: value for key, value in item['metric'].items()
                              if key != '__name__'} | {'source_metric': item['metric']['__name__']},
             'value': [100, stamp]} for item in rows]


class SourceStatusTests(unittest.TestCase):
    def test_fresh_measurement_and_explicit_uncovered_sources(self):
        rows = [row(), row(job='platform-trace-store')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows)),
                                        evaluated_at=100, completed_at=101)
        self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
        self.assertEqual(report['sources']['collector']['sample_age_seconds'], 2)
        self.assertEqual(report['sources']['trace_store']['state'], 'fresh_up')
        self.assertEqual(report['not_covered'], ['host', 'containers', 'rabbitmq', 'logto', 'caddy', 'backups'])

    def test_retained_up_is_stale_and_absent_source_is_missing(self):
        rows = [row()]
        report = source_status.evaluate(envelope(rows), envelope(times(rows, '89')),
                                        evaluated_at=100, completed_at=100)
        self.assertEqual(report['sources']['collector']['state'], 'stale')
        self.assertEqual(report['sources']['trace_store']['state'], 'missing')

    def test_exact_boundary_and_observed_down_are_distinct(self):
        rows = [row(value='0')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows, '90')),
                                        evaluated_at=100, completed_at=100)
        self.assertEqual(report['sources']['collector']['state'], 'fresh_down')

    def test_malformed_and_unavailable_never_inherit_health(self):
        rows = [row()]
        for bad in (b'{}', b'{"status":"success","status":"success"}', b'\xff', b'[]'):
            with self.subTest(bad=bad):
                result = source_status.evaluate(bad, envelope(times(rows)), evaluated_at=100, completed_at=101)
                self.assertEqual(result['sources']['collector']['state'], 'malformed')
        result = source_status.unavailable('timeout')
        self.assertEqual(result['sources']['collector']['state'], 'query_unavailable')
        self.assertNotIn('raw', result)

    def test_source_timestamp_matching_and_clock_skew_fail_closed(self):
        rows = [row()]
        for stamps in ([], times(rows, '101'), times(rows) + times(rows)):
            with self.subTest(stamps=stamps):
                result = source_status.evaluate(envelope(rows), envelope(stamps), evaluated_at=100, completed_at=101)
                self.assertEqual(result['sources']['collector']['state'], 'malformed')
        result = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100, completed_at=99)
        self.assertEqual(result['sources']['collector']['state'], 'malformed')

    def test_counters_reset_progress_and_incomplete_intervals_are_not_loss(self):
        previous_rows = [row(), row('otelcol_receiver_accepted_spans_total', value='12', receiver='otlp/pilot')]
        current_rows = [row(), row('otelcol_receiver_accepted_spans_total', value='19', receiver='otlp/pilot')]
        prior = {'values': envelope(previous_rows), 'timestamps': envelope(times(previous_rows, '80')),
                 'evaluated_at': 100, 'completed_at': 100}
        report = source_status.evaluate(envelope(current_rows), envelope(times(current_rows)),
                                        evaluated_at=100, completed_at=101, previous=prior)
        counter = report['sources']['collector']['metrics'][1]
        self.assertEqual(counter['comparison'], {'state': 'progress', 'delta': 7, 'incomplete': True})
        current_rows[1]['value'][1] = '2'
        report = source_status.evaluate(envelope(current_rows), envelope(times(current_rows)),
                                        evaluated_at=100, completed_at=101, previous=prior)
        self.assertEqual(report['sources']['collector']['metrics'][1]['comparison'],
                         {'state': 'reset_observed', 'delta': None, 'incomplete': True})
        self.assertNotIn('loss', report)

    def test_metric_freshness_is_independent_and_last_success_never_implies_recovery(self):
        rows = [row(value='0'), row('otelcol_exporter_queue_size', value='3', exporter='otlphttp/traces')]
        stamps = times(rows)
        stamps[1]['value'][1] = '80'
        prior_rows = [row()]
        prior = {'values': envelope(prior_rows), 'timestamps': envelope(times(prior_rows, '90')),
                 'evaluated_at': 100, 'completed_at': 100}
        report = source_status.evaluate(envelope(rows), envelope(stamps), evaluated_at=100,
                                        completed_at=101, previous=prior)
        source = report['sources']['collector']
        self.assertEqual(source['state'], 'fresh_down')
        self.assertEqual(source['last_successful_observation'], 90)
        self.assertEqual(source['metrics'][1]['state'], 'stale')
        self.assertEqual(source['metrics'][1]['comparison']['state'], 'not_counter')
        self.assertIsNone(source['metrics'][1]['comparison']['delta'])

    def test_closed_catalog_and_safe_numbers_reject_unknown_or_rounded_samples(self):
        for bad_row in (row(value='2'), row(value='NaN'), row(value='Infinity'),
                        row('secret_counter', value='1'), {**row(), 'metric': {**row()['metric'], 'instance': 'foreign'}},
                        row('otelcol_receiver_accepted_spans_total', value='9007199254740992'),
                        row('otelcol_receiver_accepted_spans_total', value='1.5'),
                        row('otelcol_exporter_queue_size', value='-1'), row(private='secret')):
            with self.subTest(metric=bad_row['metric']['__name__']):
                report = source_status.evaluate(envelope([bad_row]), envelope(times([bad_row])),
                                                evaluated_at=100, completed_at=101)
                self.assertEqual(report['sources']['collector']['state'], 'malformed')
        rows = [row('otelcol_receiver_accepted_spans_total', value='9007199254740991')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100, completed_at=101)
        self.assertEqual(report['sources']['collector']['metrics'][0]['value'], 9007199254740991)

    def test_duplicate_aliases_evaluation_mismatch_and_partial_results_are_refused(self):
        rows = [row('otelcol_receiver_accepted_spans', value='1'),
                row('otelcol_receiver_accepted_spans_total', value='1')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100, completed_at=101)
        self.assertEqual(report['sources']['collector']['state'], 'malformed')
        for mutation in ('timestamp', 'warnings', 'partial', 'duplicate'):
            rows = [row()]
            body = json.loads(envelope(rows))
            if mutation == 'timestamp':
                body['data']['result'][0]['value'][0] = 99
            elif mutation == 'duplicate':
                body['data']['result'].append(row())
            else:
                body[mutation] = True
            report = source_status.evaluate(json.dumps(body).encode(), envelope(times(rows)),
                                            evaluated_at=100, completed_at=101)
            self.assertEqual(report['sources']['collector']['state'], 'malformed')

    def test_missing_lazy_vt_counter_stays_absent_not_zero(self):
        rows = [row(job='platform-trace-store'),
                row('vt_rows_ingested_total', job='platform-trace-store', value='5',
                    type='opentelemetry_traces_otlphttp_protobuf')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100, completed_at=101)
        self.assertEqual(report['sources']['trace_store']['state'], 'fresh_up')
        self.assertEqual(len(report['sources']['trace_store']['metrics']), 2)
        self.assertNotIn('index_push_errors', json.dumps(report))

    def test_repeated_or_backwards_counter_timestamp_cannot_manufacture_progress(self):
        previous_rows = [row('otelcol_receiver_accepted_spans_total', value='10')]
        prior = {'values': envelope(previous_rows), 'timestamps': envelope(times(previous_rows)),
                 'evaluated_at': 100, 'completed_at': 100}
        rows = [row('otelcol_receiver_accepted_spans_total', value='11')]
        result = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100,
                                        completed_at=101, previous=prior)
        self.assertEqual(result['sources']['collector']['state'], 'malformed')
        result = source_status.evaluate(envelope(rows), envelope(times(rows, '98')), evaluated_at=100,
                                        completed_at=101, previous=prior)
        self.assertEqual(result['sources']['collector']['metrics'][0]['comparison']['state'], 'unknown')

    def test_body_row_depth_and_boolean_clock_caps(self):
        for raw in (b' ' * 1048577, envelope([row()] * 1001), b'[' * 18 + b'0' + b']' * 18):
            report = source_status.evaluate(raw, envelope([]), evaluated_at=100, completed_at=101)
            self.assertEqual(report['sources']['collector']['state'], 'malformed')
        report = source_status.evaluate(envelope([]), envelope([]), evaluated_at=True, completed_at=101)
        self.assertEqual(report['sources']['collector']['state'], 'malformed')

    def test_absent_timestamp_identity_and_huge_clock_return_closed_malformed(self):
        rows = [row()]
        stamps = times(rows)
        del stamps[0]['metric']['source_metric']
        result = source_status.evaluate(envelope(rows), envelope(stamps), evaluated_at=100, completed_at=101)
        self.assertEqual(result['sources']['collector']['state'], 'malformed')
        result = source_status.evaluate(envelope([]), envelope([]), evaluated_at=10**1000, completed_at=10**1000)
        self.assertEqual(result['sources']['collector']['state'], 'malformed')

    def test_identical_scrape_timestamp_cannot_change_up_value(self):
        prior_rows = [row()]
        rows = [row(value='0')]
        prior = {'values': envelope(prior_rows), 'timestamps': envelope(times(prior_rows)),
                 'evaluated_at': 100, 'completed_at': 100}
        result = source_status.evaluate(envelope(rows), envelope(times(rows)), evaluated_at=100,
                                        completed_at=101, previous=prior)
        self.assertEqual(result['sources']['collector']['state'], 'malformed')


if __name__ == '__main__':
    unittest.main()
