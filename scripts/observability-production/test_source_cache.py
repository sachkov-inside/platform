"""Finite source projection refuses malformed/insufficient reads, emits no raw diagnostics."""
import json
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch
import unittest
import source_cache
sys.path.insert(0, str(source_cache.ROOT / 'scripts/observability-caddy-storage'))
from test_native_source import wire


def pg():
    return (json.dumps({'schema': 1, 'fields': [{'name': n, 'oid': oid} for n, oid in source_cache.frame.FIELDS],
        'rows': [['180004', 'on', 'on', 'on', True, True, True, '100000000', '10000000', '20000000', '3', '0', '0']]}) + '\n').encode()


class Sources(unittest.TestCase):
    def test_observer_describes_actual_read_and_atomic_publication_without_changing_cache_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();events=[];replaced=[];ticks=[]
            def clock():
                value=100+len(ticks);ticks.append(value);return value
            callbacks={'postgres_read':lambda sql:pg(),'caddy_read':lambda:wire()+b'process_start_time_seconds 10\n','caddy_server':'srv0','clock':clock}
            expected=source_cache.sample(output,**callbacks)
            baseline={path.name:path.read_bytes() for path in output.iterdir()}
            ticks.clear();replace=source_cache.os.replace
            def actual_replace(source,target):
                replace(source,target);replaced.append(time.monotonic()*1000)
            def observe(row):
                self.assertTrue((output/(row['source']+'-source.prom')).is_file())
                events.append(row)
            with patch.object(source_cache.os,'replace',side_effect=actual_replace):
                result=source_cache.sample(output,**callbacks,observer=observe)
            self.assertEqual(result,expected);self.assertEqual(ticks,[100,101])
            self.assertEqual({path.name:path.read_bytes() for path in output.iterdir()},baseline)
            self.assertEqual([row['source'] for row in events],['postgresql','caddy'])
            for row,at,epoch in zip(events,replaced,(100,101)):
                self.assertEqual(set(row),{'source','read_outcome','projection_state','publication_outcome','read_start_monotonic_ms','read_end_monotonic_ms','observed_at_seconds','publish_start_monotonic_ms','publish_end_monotonic_ms'})
                self.assertEqual((row['read_outcome'],row['projection_state'],row['publication_outcome']),('completed','observed','completed'))
                self.assertEqual(row['observed_at_seconds'],epoch)
                self.assertLessEqual(row['read_start_monotonic_ms'],row['read_end_monotonic_ms'])
                self.assertLessEqual(row['read_end_monotonic_ms'],row['publish_start_monotonic_ms'])
                self.assertLessEqual(row['publish_start_monotonic_ms'],at)
                self.assertLessEqual(at,row['publish_end_monotonic_ms'])

    def test_default_observer_adds_no_diagnostic_clock_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            ticks=[]
            def clock(): ticks.append(100);return 100
            with patch.object(source_cache.time,'monotonic',side_effect=AssertionError('diagnostic clock must stay disabled')):
                value=source_cache.sample(Path(directory).resolve(),postgres_read=lambda sql:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=clock)
            self.assertEqual(value,{'postgresql':'observed','caddy':'observed'});self.assertEqual(ticks,[100,100])

    def test_unavailable_rows_retain_the_original_gauge_clock_and_read_outcome(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();events=[];ticks=[];bad=json.loads(pg());bad['rows'][0][4]=False
            def clock(): value=100+len(ticks);ticks.append(value);return value
            def failed(): raise RuntimeError('private-sentinel')
            value=source_cache.sample(output,postgres_read=lambda sql:(json.dumps(bad)+'\n').encode(),caddy_read=failed,caddy_server='srv0',clock=clock,observer=events.append)
            self.assertEqual(value,{'postgresql':'unavailable','caddy':'unavailable'});self.assertEqual(ticks,[100,101,102])
            self.assertEqual([row['observed_at_seconds'] for row in events],[101,102])
            self.assertEqual([row['read_outcome'] for row in events],['completed','failed'])
            for row in events:
                self.assertEqual((row['projection_state'],row['publication_outcome']),('unavailable','completed'))
                text=(output/(row['source']+'-source.prom')).read_text()
                self.assertIn('} '+str(row['observed_at_seconds'])+'\n',text)
            self.assertNotIn('private-sentinel',json.dumps(events))

    def test_primary_read_cancellation_and_real_publish_failure_survive_diagnostic_failure(self):
        for primary_kind in ('read','replace'):
            with self.subTest(primary_kind=primary_kind),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();failure=KeyboardInterrupt('private original') if primary_kind=='read' else OSError('private original')
                def read(sql):
                    if primary_kind=='read':raise failure
                    return pg()
                def diagnostic(row):raise SystemExit('private diagnostic')
                replacement={'side_effect':failure} if primary_kind=='replace' else {'wraps':source_cache.os.replace}
                # Keep the actual tempfile/write/fsync flow; fail only its OS replace boundary.
                original_clock=time.monotonic
                def diagnostic_clock():
                    if source_cache.sys.exception() is failure:raise SystemExit('diagnostic cancellation')
                    return original_clock()
                with patch.object(source_cache.os,'replace',**replacement),patch.object(source_cache.time,'monotonic',side_effect=diagnostic_clock):
                    with self.assertRaises(type(failure)) as caught:
                        source_cache.sample(output,postgres_read=read,caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=lambda:100,observer=diagnostic)
                self.assertIs(caught.exception,failure);self.assertEqual(list(output.iterdir()),[])

    def test_original_clock_exception_identity_and_fallback_call_count_survive_observer_error(self):
        with tempfile.TemporaryDirectory() as directory:
            failure=RuntimeError('original clock failure');calls=[];events=[]
            def clock():calls.append(1);raise failure
            def diagnostic(row):events.append(row);raise RuntimeError('diagnostic failure')
            with self.assertRaises(RuntimeError) as caught:
                source_cache.sample(Path(directory).resolve(),postgres_read=lambda sql:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=clock,observer=diagnostic)
            self.assertIs(caught.exception,failure);self.assertEqual(calls,[1,1])
            self.assertEqual(events[0]['projection_state'],'unknown');self.assertIsNone(events[0]['observed_at_seconds'])
            self.assertEqual(events[0]['publication_outcome'],'not_attempted')

    def test_uncaught_projection_exception_retains_identity_with_optional_observer(self):
        with tempfile.TemporaryDirectory() as directory:
            failure=LookupError('original projection error');clocks=[]
            def clock():clocks.append(100);return 100
            def diagnostic(row):raise RuntimeError('diagnostic error')
            with patch.object(source_cache.frame,'decode',side_effect=failure):
                with self.assertRaises(LookupError) as caught:
                    source_cache.sample(Path(directory).resolve(),postgres_read=lambda sql:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=clock,observer=diagnostic)
            self.assertIs(caught.exception,failure);self.assertEqual(clocks,[100]);self.assertEqual(list(Path(directory).iterdir()),[])

    def test_diagnostic_unknown_clocks_and_ordinary_observer_failure_do_not_change_sources(self):
        for invalid in (float('nan'),float('inf'),-1,True,'private-sentinel',RuntimeError('private-sentinel')):
            with self.subTest(kind=type(invalid).__name__),tempfile.TemporaryDirectory() as directory:
                events=[]
                def clock():
                    if isinstance(invalid,Exception):raise invalid
                    return invalid
                def diagnostic(row):events.append(row);raise RuntimeError('private-sentinel')
                with patch.object(source_cache.time,'monotonic',side_effect=clock):
                    value=source_cache.sample(Path(directory).resolve(),postgres_read=lambda sql:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=lambda:100,observer=diagnostic)
                self.assertEqual(value,{'postgresql':'observed','caddy':'observed'})
                self.assertEqual(len(events),2)
                for row in events:
                    for key in ('read_start_monotonic_ms','read_end_monotonic_ms','publish_start_monotonic_ms','publish_end_monotonic_ms'):self.assertIsNone(row[key])
                self.assertNotIn('private-sentinel',json.dumps(events))

    def test_genuine_diagnostic_cancellation_without_primary_error_still_propagates(self):
        for cancellation in (KeyboardInterrupt,SystemExit):
            for where in ('clock','observer'):
                with self.subTest(where=where,cancellation=cancellation.__name__),tempfile.TemporaryDirectory() as directory:
                    failure=cancellation('owned cancellation')
                    def interrupted(*args):raise failure
                    with patch.object(source_cache.time,'monotonic',**({'side_effect':interrupted} if where=='clock' else {'wraps':time.monotonic})):
                        with self.assertRaises(cancellation) as caught:
                            source_cache.sample(Path(directory).resolve(),postgres_read=lambda sql:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=lambda:100,observer=interrupted if where=='observer' else lambda row:None)
                    self.assertIs(caught.exception,failure)

    def test_fixed_ordinary_role_contract_and_native_cache_contain_only_closed_observations(self):
        sql = source_cache.postgres_sql()
        self.assertIn("(current_database() = 'inside')", sql)
        self.assertIn('BEGIN READ ONLY', sql)
        self.assertIn("SET LOCAL statement_timeout = '2000ms'", sql)
        self.assertNotIn("(current_database() = 'tracking')", sql)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            result = source_cache.sample(output, postgres_read=lambda actual: pg(),
                caddy_read=lambda: wire() + b'process_start_time_seconds 10\n', caddy_server='srv0', clock=lambda: 100)
            self.assertEqual(result, {'postgresql': 'observed', 'caddy': 'observed'})
            text = (output / 'postgresql-source.prom').read_text()
            self.assertIn('inside_postgresql_server_waiting_locks 0\n', text)
            self.assertIn('inside_postgresql_server_statistics_reset_time_microseconds 20000000\n', text)
            caddy = (output / 'caddy-source.prom').read_text()
            self.assertIn('caddy_http_requests_total{server="public",handler="subroute"} 3\n', caddy)
            self.assertIn('caddy_process_start_time_seconds 10\n', caddy)
            self.assertNotIn('srv0', caddy)

    def test_read_failures_and_insufficient_role_never_publish_old_counts_or_raw_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            source_cache.sample(output, postgres_read=lambda sql: pg(), caddy_read=lambda: wire() + b'process_start_time_seconds 10\n', caddy_server='srv0', clock=lambda: 100)
            bad = json.loads(pg()); bad['rows'][0][4] = False
            def unavailable(): raise RuntimeError('private-sentinel email/person?token=secret')
            result = source_cache.sample(output, postgres_read=lambda sql: (json.dumps(bad) + '\n').encode(),
                caddy_read=unavailable, caddy_server='srv0', clock=lambda: 101)
            self.assertEqual(set(result.values()), {'unavailable'})
            for path in output.iterdir():
                text = path.read_text()
                self.assertNotIn('private-sentinel', text)
                self.assertNotIn('waiting_locks', text)
                self.assertNotIn('caddy_http', text)
                self.assertIn('} 0\n', text)

    def test_public_caddy_partition_requires_adaptation_instead_of_guessed_server(self):
        value = {'admin': {'disabled': True}, 'apps': {'http': {'metrics': {}, 'servers': {
            'srv0': {'listen': [':9091']}, 'srv1': {'listen': [':443']}}}}}
        self.assertEqual(source_cache.select_caddy_server(json.dumps(value).encode()), 'srv1')
        for mutation in ('no_metrics', 'public_admin', 'duplicate_public', 'unknown_role'):
            bad = json.loads(json.dumps(value))
            if mutation == 'no_metrics': bad['apps']['http'].pop('metrics')
            if mutation == 'public_admin': bad['admin'] = {'listen': '0.0.0.0:2019'}
            if mutation == 'duplicate_public': bad['apps']['http']['servers']['srv2'] = {'listen': [':443']}
            if mutation == 'unknown_role': bad['apps']['http']['servers']['private-person'] = {'listen': [':443']}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                source_cache.select_caddy_server(json.dumps(bad).encode())

    def test_reader_bootstrap_refuses_preexisting_foreign_authority_before_role_settings(self):
        sql = source_cache.postgres_setup_sql()
        # The actual PG dependency catalogue includes ownership and ACL dependencies across DBs.
        # No application schema/table query or grants are introduced by the reader.
        guard = sql.index('FROM pg_shdepend')
        self.assertLess(guard, sql.index('ALTER ROLE'))
        self.assertIn("NOT(deptype='a' AND classid='pg_database'::regclass", sql)
        self.assertIn("shobj_description", sql)
        self.assertIn("ERRCODE='P1567'", sql)
        self.assertIn("aclexplode", sql)
        self.assertIn("a.privilege_type<>'CONNECT' OR a.is_grantable", sql)
        self.assertNotIn('GRANT pg_monitor', sql)
        self.assertNotIn('GRANT pg_read_all_stats', sql)
        self.assertNotIn('GRANT SELECT', sql)

    def test_native_automatic_redirects_are_validated_but_never_counted_as_public_requests(self):
        raw = wire() + b'process_start_time_seconds 10\n'
        redirect = b'caddy_http_requests_total{server="remaining_auto_https_redirects",handler="static_response"} 8\n'
        projected = source_cache.caddy_projection(raw + redirect, 'srv0', 100)
        self.assertIn('handler="subroute"} 3\n', projected)
        self.assertNotIn('remaining_auto_https_redirects', projected)
        poisoned = redirect.replace(b'handler="static_response"', b'handler="static_response",host="private-person"')
        with self.assertRaises(ValueError): source_cache.caddy_projection(raw + poisoned, 'srv0', 100)

    def test_selected_partition_unknown_epoch_and_private_excluded_labels_refuse(self):
        raw = wire() + b'process_start_time_seconds 10\n'
        self.assertIn('requests_total', source_cache.caddy_projection(raw, 'srv0', 100))
        for body, server in ((wire(), 'srv0'), (raw, 'srv64'), (raw, 'private-person'),
                (raw.replace(b'process_start_time_seconds 10', b'process_start_time_seconds 101'), 'srv0'),
                (raw + b'caddy_http_requests_total{server="srv2",handler="subroute",host="private"} 1\n', 'srv0')):
            with self.subTest(server=server), self.assertRaises(ValueError): source_cache.caddy_projection(body, server, 100)


if __name__ == '__main__': unittest.main()
