"""Behavioral contracts for the bounded pilot source-status read model."""
import json
import unittest
from itertools import product
from unittest.mock import patch

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


def native_envelope(rows, stats):
    body = json.loads(envelope(rows))
    body['stats'] = stats
    return json.dumps(body, separators=(',', ':')).encode()


class SourceStatusTests(unittest.TestCase):
    def test_fresh_measurement_and_explicit_uncovered_sources(self):
        rows = [row(), row(job='platform-trace-store')]
        report = source_status.evaluate(envelope(rows), envelope(times(rows)),
                                        evaluated_at=100, completed_at=101)
        self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
        self.assertEqual(report['sources']['collector']['sample_age_seconds'], 2)
        self.assertEqual(report['sources']['trace_store']['state'], 'fresh_up')
        self.assertEqual(report['not_covered'], ['host', 'containers', 'rabbitmq', 'logto', 'caddy', 'backups'])

    def test_native_stats_zero_and_max_preserve_current_and_previous_acquisitions(self):
        current = [row(), row(job='platform-trace-store'),
                   row('otelcol_receiver_accepted_spans_total', value='19', receiver='otlp/pilot')]
        prior_rows = [row(), row(job='platform-trace-store'),
                      row('otelcol_receiver_accepted_spans_total', value='12', receiver='otlp/pilot')]
        prior = {'values': envelope(prior_rows), 'timestamps': envelope(times(prior_rows, '80')),
                 'evaluated_at': 100, 'completed_at': 100}
        bare = source_status.evaluate(envelope(current), envelope(times(current)),
                                      evaluated_at=100, completed_at=101, previous=prior)
        for fetched, elapsed in (('0', 0), ('9223372036854775807', 9223372036854)):
            with self.subTest(fetched=fetched):
                def native(raw):
                    body = json.loads(raw)
                    body['stats'] = {'seriesFetched': fetched, 'executionTimeMsec': elapsed}
                    return json.dumps(body).encode()
                report = source_status.evaluate(native(envelope(current)), native(envelope(times(current))),
                                                evaluated_at=100, completed_at=101,
                                                previous={**prior, 'values': native(prior['values']),
                                                          'timestamps': native(prior['timestamps'])})
                self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
                self.assertEqual(report['sources']['trace_store']['sample_age_seconds'], 2)
                self.assertEqual(report['sources']['collector']['metrics'][1]['comparison'],
                                 {'state': 'progress', 'delta': 7, 'incomplete': True})
                self.assertEqual(report, bare)
                self.assertNotIn('stats', json.dumps(report))

    def test_invalid_native_stats_fail_closed_in_every_current_and_prior_vector(self):
        valid = {'seriesFetched': '0', 'executionTimeMsec': 0}
        invalid = [None, [], True, 0, 'private-sentinel', {}, {'seriesFetched': '0'},
                   {'executionTimeMsec': 0}, {**valid, 'private': {'late': 'private-sentinel'}}]
        for value in (True, False, 0, 0.0, '-1', '01', '+1', ' 1', '1 ', '1.0', '1e0', '',
                      'NaN', 'Infinity', '9223372036854775808', '9' * 20, '١', '１',
                      'private-sentinel', '\ud800', {}, ['0']):
            invalid.append({**valid, 'seriesFetched': value})
        for value in (True, False, '0', '٠', 0.0, 1.5, -1, 9223372036855,
                      9223372036854775807, None, [], {}, float('nan'), float('inf')):
            invalid.append({**valid, 'executionTimeMsec': value})
        rows = [row(), row(job='platform-trace-store')]
        for slot in ('values', 'timestamps', 'previous_values', 'previous_timestamps'):
            for case, stats in enumerate(invalid):
                with self.subTest(slot=slot, case=case):
                    vectors = {'values': native_envelope(rows, valid),
                               'timestamps': native_envelope(times(rows), valid),
                               'previous_values': native_envelope(rows, valid),
                               'previous_timestamps': native_envelope(times(rows), valid)}
                    vectors[slot] = native_envelope(times(rows) if slot.endswith('timestamps') else rows, stats)
                    result = source_status.evaluate(vectors['values'], vectors['timestamps'],
                        evaluated_at=100, completed_at=101,
                        previous={'values': vectors['previous_values'], 'timestamps': vectors['previous_timestamps'],
                                  'evaluated_at': 100, 'completed_at': 100})
                    self.assertEqual(result['query']['state'], 'malformed')
                    self.assertEqual(result['sources']['collector']['state'], 'malformed')
                    self.assertNotIn('private-sentinel', json.dumps(result))

    def test_native_stats_do_not_admit_duplicates_unknown_envelopes_or_late_row_poison(self):
        valid = {'seriesFetched': '9223372036854775807', 'executionTimeMsec': 9223372036854}
        rows = [row(), row(job='platform-trace-store')]
        good = native_envelope(rows, valid)
        self.assertEqual(source_status.evaluate(good, native_envelope(times(rows), valid),
                         evaluated_at=100, completed_at=101)['query']['state'], 'observed')
        raw = good.decode()
        bad = [raw.replace('"seriesFetched":', '"seriesFetched":"0","seriesFetched":'),
               raw.replace('"executionTimeMsec":', '"executionTimeMsec":0,"executionTimeMsec":'),
               raw.replace('"stats":', '"stats":{},"stats":'),
               raw.replace('"seriesFetched":', '"\\u0073eriesFetched":"0","seriesFetched":')]
        for field, value in (('isPartial', False), ('trace', {}), ('warnings', []),
                             ('private', {'late': 'private-sentinel'})):
            body = json.loads(good)
            body[field] = value
            bad.append(json.dumps(body))
        for poison in ('private_label', 'duplicate_row', 'unknown_family', 'nested_value'):
            body = json.loads(good)
            last = body['data']['result'][-1]
            if poison == 'private_label':
                last['metric']['private'] = 'private-sentinel'
            elif poison == 'duplicate_row':
                body['data']['result'].append(last)
            elif poison == 'unknown_family':
                last['metric']['__name__'] = 'private-sentinel'
            else:
                last['value'] = [100, {'late': 'private-sentinel'}]
            bad.append(json.dumps(body))
        for case, value in enumerate(bad):
            with self.subTest(case=case):
                result = source_status.evaluate(value.encode(), native_envelope(times(rows), valid),
                                                evaluated_at=100, completed_at=101)
                self.assertEqual(result['sources']['trace_store']['state'], 'malformed')
                self.assertNotIn('private-sentinel', json.dumps(result))

    def test_native_stats_do_not_supply_sample_age_completion_or_missing_sources(self):
        stats = {'seriesFetched': '9223372036854775807', 'executionTimeMsec': 9223372036854}
        rows = [row()]
        values, stamps = native_envelope(rows, stats), native_envelope(times(rows), stats)
        report = source_status.evaluate(values, stamps, evaluated_at=100, completed_at=100,
                                        completion_clock=lambda: 110)
        self.assertEqual(report['sources']['collector']['sample_age_seconds'], 11)
        self.assertEqual(report['sources']['collector']['state'], 'stale')
        self.assertEqual(report['sources']['trace_store']['state'], 'missing')
        self.assertIsNone(report['sources']['trace_store']['measured_at'])
        self.assertNotIn('stats', json.dumps(report))
        backwards = source_status.evaluate(values, stamps, evaluated_at=100, completed_at=101,
                                           completion_clock=lambda: 100)
        self.assertEqual(backwards['query']['state'], 'malformed')

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


class RejectionDiagnosticTests(unittest.TestCase):
    def test_decode_rejection_is_closed_and_public_report_is_unchanged(self):
        report, detail = source_status._evaluate(b'private-sentinel', envelope([]),
                                                 evaluated_at=100, completed_at=100)
        self.assertEqual(report, source_status.malformed())
        self.assertEqual(detail['code'], 'decode')
        self.assertEqual(detail['slot'], 'values')
        self.assertNotIn('private-sentinel', json.dumps(detail))
        self.assertEqual(source_status.evaluate(b'private-sentinel', envelope([]),
                         evaluated_at=100, completed_at=100), report)


class FiniteRejectionContractTests(unittest.TestCase):
    def evaluate(self, values, timestamps, **kwargs):
        report, detail = source_status._evaluate(values, timestamps,
            evaluated_at=100, completed_at=100, **kwargs)
        self.assertEqual(report, source_status.malformed())
        projection = source_status.rejection(detail, 'a' * 40)
        self.assertLessEqual(len(json.dumps(projection).encode()), 4096)
        self.assertNotIn('private-sentinel', json.dumps(projection))
        return detail

    def test_each_parser_branch_has_its_fixed_code_and_vector_slot(self):
        good = [row()]
        sample = row(); sample['value'] = []
        poison = row(); poison['metric']['private'] = 'private-sentinel'
        aliases = [row('otelcol_receiver_accepted_spans'), row('otelcol_receiver_accepted_spans_total')]
        cases = [('decode', b'private-sentinel'), ('envelope', b'{}'),
                 ('native_stats', native_envelope(good, {'private': 'private-sentinel'})),
                 ('metric_identity', envelope([poison])), ('sample', envelope([sample])),
                 ('duplicate_identity', envelope(good * 2)), ('duplicate_alias', envelope(aliases))]
        for code, raw in cases:
            with self.subTest(code=code):
                detail = self.evaluate(raw, envelope(times(good)))
                self.assertEqual((detail['code'], detail['slot']), (code, 'values'))
        for code, raw in [('decode', b'private-sentinel'), ('envelope', b'{}'),
                          ('native_stats', native_envelope(times(good), {})),
                          ('duplicate_identity', envelope(times(good * 2)))]:
            with self.subTest(code=code, slot='timestamps'):
                detail = self.evaluate(envelope(good), raw)
                self.assertEqual((detail['code'], detail['slot']), (code, 'timestamps'))
        detail = self.evaluate(envelope(good), envelope(times([row(job='platform-trace-store')])))
        self.assertEqual((detail['code'], detail['slot'], detail['difference']),
                         ('vector_identity_mismatch', 'pair', 2))

    def test_current_and_previous_context_and_first_rejection_are_preserved(self):
        good = envelope([row()]); stamps = envelope(times([row()]))
        prior = {'values': b'private-sentinel', 'timestamps': b'{}',
                 'evaluated_at': 100, 'completed_at': 100}
        detail = self.evaluate(good, stamps, previous=prior)
        self.assertEqual((detail['context'], detail['slot'], detail['code']),
                         ('previous', 'values', 'decode'))
        detail = self.evaluate(b'{}', b'private-sentinel', previous=prior)
        self.assertEqual((detail['context'], detail['slot'], detail['code']),
                         ('current', 'values', 'envelope'))

    def test_clock_completion_internal_and_actual_output_cap_slots(self):
        good = envelope([row()]); stamps = envelope(times([row()]))
        report, detail = source_status._evaluate(good, stamps, evaluated_at=100, completed_at=99)
        self.assertEqual(report, source_status.malformed())
        self.assertEqual((detail['code'], detail['slot']), ('clock', 'pair'))
        detail = self.evaluate(good, stamps, completion_clock=lambda: 99)
        self.assertEqual((detail['code'], detail['slot']), ('clock', 'completion'))
        class Poison(TypeError):
            def __str__(self):
                raise AssertionError('exception text accessed')
            def __getattribute__(self, name):
                if name not in ('__class__', '__traceback__'):
                    raise AssertionError('exception getter accessed')
                return super().__getattribute__(name)
        with patch.object(source_status, '_comparison', side_effect=Poison('private-sentinel')):
            detail = self.evaluate(good, stamps)
        self.assertEqual((detail['code'], detail['slot']), ('internal_shape', 'internal'))
        rows = [row(name, receiver=receiver, exporter=exporter, data_type=data_type)
                for name, receiver, exporter, data_type in product(
                    sorted(source_status.COLLECTOR_COUNTERS), sorted(source_status.RECEIVERS),
                    sorted(source_status.EXPORTERS), ('', 'traces', 'metrics', 'logs'))][:600]
        detail = self.evaluate(envelope(rows), envelope(times(rows)))
        self.assertEqual((detail['code'], detail['slot']), ('output_cap', 'output'))

    def test_real_body_and_row_limits_keep_unknown_counts_null(self):
        empty = envelope([])
        # Whitespace is valid JSON: the exact body cap remains admitted.
        at_limit = empty + b' ' * (1048576 - len(empty))
        report, detail = source_status._evaluate(at_limit, empty, evaluated_at=100, completed_at=100)
        self.assertEqual(report['query']['state'], 'observed')
        self.assertIsNone(detail)
        detail = self.evaluate(at_limit + b' ', empty)
        self.assertEqual(detail['code'], 'decode')
        self.assertIsNone(detail['values_bytes'])
        for count in (1000, 1001):
            detail = self.evaluate(envelope([row()] * count), empty)
            self.assertEqual(detail['code'], 'duplicate_identity' if count == 1000 else 'decode')
            self.assertEqual(detail['rows'], 1000 if count == 1000 else None)

    def test_projection_rejects_extras_unknowns_bools_and_getters(self):
        detail = self.evaluate(b'{}', envelope([]))
        good = source_status.rejection(detail, 'a' * 40)
        bad = [{**good, 'private': 'private-sentinel'}, {**good, 'schema': True},
               {**good, 'source': 'b' * 40}, {**good, 'context': 'private-sentinel'},
               {**good, 'code': 'private-sentinel decode'}, {**good, 'slot': 'private-sentinel'},
               {**good, 'availability': 'unknown'}]
        for name, limit in source_status.REJECTION_COUNTS.items():
            for count in (True, -1, limit + 1, 'private-sentinel', 0.0):
                bad.append({**good, 'counts': {**good['counts'], name: count}})
            for count in (None, 0, limit):
                candidate = {**good, 'counts': {**good['counts'], name: count}}
                self.assertEqual(source_status.validate_rejection(candidate, 'a' * 40), candidate)
        class Getter(dict):
            def __getitem__(self, key):
                raise AssertionError('untrusted getter called')
        bad.extend([Getter(good), {**good, 'counts': Getter(good['counts'])}])
        for index, candidate in enumerate(bad):
            with self.subTest(case=index):
                with self.assertRaises(ValueError):
                    source_status.validate_rejection(candidate, 'a' * 40)
        self.assertEqual(json.dumps(source_status.malformed(), sort_keys=True, separators=(',', ':')),
            '{"not_covered":["host","containers","rabbitmq","logto","caddy","backups"],'
            '"query":{"reason":"invalid_response","state":"malformed"},'
            '"sources":{"collector":{"sample_age_seconds":null,"state":"malformed"},'
            '"trace_store":{"sample_age_seconds":null,"state":"malformed"}},"version":1}')


if __name__ == '__main__':
    unittest.main()
