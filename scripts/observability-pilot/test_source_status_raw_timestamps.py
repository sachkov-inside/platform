"""Owned HTTP model of pinned VM raw-rollup vs implicit-subquery timestamps, not native proof."""
import json
from pathlib import Path
import re
import tempfile
import unittest
import urllib.parse
from unittest.mock import patch
import source_status_query as query
from test_source_status_query import server

T=1792494900  # A 300s grid point, also the observed failing CI baseline evaluation.
DIRECT=re.compile(r'label_replace\(\(timestamp_with_name\((\{[^{}]+\})\) or timestamp_with_name\((\{[^{}]+\})\)\),"source_metric","\$1","__name__","\(\.\+\)"\)')


GATED=re.compile(r'label_replace\(\(\(timestamp_with_name\((\{[^{}]+\})\) and on\(([^()]+)\) (\{[^{}]+\})( keep_metric_names)?\) or \(timestamp_with_name\((\{[^{}]+\})\) and on\(([^()]+)\) (\{[^{}]+\})( keep_metric_names)?\)\),"source_metric","\$1","__name__","\(\.\+\)"\)')
IDENTITY={'__name__','job','instance','receiver','exporter','data_type','format','path','type','reason'}


def ungated_plan(instant):
    values=query_plan(instant)[0]
    expression=urllib.parse.parse_qs(urllib.parse.urlsplit(values).query)['query'][0]
    collector,trace=re.findall(r'\{[^{}]+\}',expression)
    stamps='label_replace((timestamp_with_name('+collector+') or timestamp_with_name('+trace+')),"source_metric","$1","__name__","(.+)")'
    return [values,'/metrics/api/v1/query?'+urllib.parse.urlencode({
        'query':stamps,'time':str(instant),'timeout':'2s','nocache':'1'})]


def legacy_plan(instant):
    values=query_plan(instant)[0]
    expression=urllib.parse.parse_qs(urllib.parse.urlsplit(values).query)['query'][0]
    stamp='timestamp(label_replace('+expression+',"source_metric","$1","__name__","(.+)"))'
    return [values,'/metrics/api/v1/query?'+urllib.parse.urlencode({
        'query':stamp,'time':str(instant),'timeout':'2s','nocache':'1'})]


query_plan=query.query_plan


def weakened_plan(*, omit=None, keep_names=True):
    def plan(instant):
        paths=query_plan(instant)
        parameters=urllib.parse.parse_qs(urllib.parse.urlsplit(paths[1]).query)
        expression=parameters['query'][0]
        if omit:
            expression=re.sub(r'on\(([^()]+)\)',lambda match:'on('+','.join(
                key for key in match[1].split(',') if key!=omit)+')',expression)
        if not keep_names:expression=expression.replace(' keep_metric_names','')
        parameters['query']=[expression]
        return [paths[0],'/metrics/api/v1/query?'+urllib.parse.urlencode(parameters,doseq=True)]
    return plan


def observe(scenario, instant, *, plan=None, poison=None, current_extra=(), stale_extra=()):
    requests=[]
    def reply(handler):
        parameters=urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
        expression=parameters['query'][0]
        gated=GATED.fullmatch(expression)
        direct=gated is not None or DIRECT.fullmatch(expression) is not None
        stamps=direct or expression.startswith('timestamp(label_replace(')
        requests.append(parameters)
        now=int(parameters['time'][0])
        metrics=[{'__name__':'up','job':'platform-collector','instance':'pilot'},
                 {'__name__':'up','job':'platform-trace-store','instance':'pilot'},
                 {'__name__':'vt_rows_ingested_total','job':'platform-trace-store','instance':'pilot',
                  'type':'opentelemetry_traces_otlphttp_protobuf'}]
        # default_rollup keeps a last stale NaN and instant Exec drops its row.
        # timestamp_with_name drops the stale marker first and retains the old stamp.
        current=(metrics[:2] if scenario=='vt_down' else metrics)+list(current_extra)
        metrics=metrics+list(current_extra)+list(stale_extra)
        if not stamps:
            metrics=current
        elif gated:
            matched=[]
            for metric in metrics:
                collector=metric['job']=='platform-collector'
                labels=set(gated[2 if collector else 6].split(','))
                # VM resets MetricGroup before on() unless the binary op keeps names.
                if not gated[4 if collector else 8]:labels.discard('__name__')
                if any(row['job']==metric['job'] and all(metric.get(key,'')==row.get(key,'') for key in labels) for row in current):
                    matched.append(metric)
            metrics=matched
        sample=T+200 if scenario=='stopped' else T if now==T else T+15
        rows=[]
        for metric in metrics:
            value=0 if scenario=='vt_down' and metric['job']=='platform-trace-store' and metric['__name__']=='up' else 1
            labels=dict(metric)
            if stamps:
                labels['source_metric']=metric['__name__']
                value=sample if direct else (now//300)*300
                if not direct:labels.pop('__name__')
            rows.append({'metric':labels,'value':[now,str(value)]})
        if poison is not None:poison(rows,stamps)
        raw=json.dumps({'status':'success','data':{'resultType':'vector','result':rows},
                        'stats':{'seriesFetched':str(len(rows)),'executionTimeMsec':0}}).encode()
        handler.send_response(200);handler.send_header('Content-Length',str(len(raw)));handler.end_headers();handler.wfile.write(raw)
    with tempfile.TemporaryDirectory() as temporary:
        output=Path(temporary).resolve()
        (output/'auth.json').write_text('{"users":[{"bearer_token":"PRIVATE_FIXTURE_TOKEN"}]}')
        (output/'auth.json').chmod(0o600)
        with server(reply,poll_interval=.01) as port,patch.object(query,'query_plan',plan or query_plan):
            report=query.read_report(output,port=port,wall_clock=lambda:instant+.2)
    return report,requests


class RawTimestampQueries(unittest.TestCase):
    def test_private_reader_observes_down_after_counter_disappears_from_a_current_scrape(self):
        baseline,_=observe('baseline',T)
        self.assertTrue(all(source['state']=='fresh_up' for source in baseline['sources'].values()))
        down,_=observe('vt_down',T+17)
        self.assertEqual(down['query']['state'],'observed')
        self.assertEqual(down['sources']['collector']['state'],'fresh_up')
        self.assertEqual(down['sources']['trace_store']['state'],'fresh_down')
        self.assertAlmostEqual(down['sources']['trace_store']['sample_age_seconds'],2.2,places=5)


    def test_raw_age_cannot_be_replaced_by_a_newer_subquery_grid_point(self):
        report,_=observe('stopped',T+305)
        for source in report['sources'].values():
            self.assertEqual(source['state'],'stale')
            self.assertAlmostEqual(source['sample_age_seconds'],105.2,places=5)
        old,_=observe('stopped',T+305,plan=legacy_plan)
        for source in old['sources'].values():
            self.assertEqual(source['state'],'fresh_up')
            self.assertAlmostEqual(source['sample_age_seconds'],5.2,places=5)
        ungated,_=observe('vt_down',T+17,plan=ungated_plan)
        self.assertEqual(ungated['query']['state'],'malformed')
        old_down,_=observe('vt_down',T+17,plan=legacy_plan)
        self.assertEqual(old_down['query']['state'],'malformed')

    def test_stamp_functions_receive_separate_raw_metric_selectors_before_transform_and_union(self):
        parameters=[urllib.parse.parse_qs(urllib.parse.urlsplit(path).query) for path in query_plan(T)]
        values=parameters[0]['query'][0];stamps=parameters[1]['query'][0]
        match=GATED.fullmatch(stamps)
        self.assertIsNotNone(match)
        selectors=re.findall(r'\{[^{}]+\}',values)
        self.assertEqual([match[1],match[5]],selectors)
        self.assertEqual(match[1],match[3])
        self.assertEqual(match[5],match[7])
        self.assertEqual(set(match[2].split(',')),IDENTITY)
        self.assertEqual(set(match[6].split(',')),IDENTITY)
        self.assertEqual(match[4],' keep_metric_names')
        self.assertEqual(match[8],' keep_metric_names')
        self.assertIn('job="platform-collector"',match[1])
        self.assertIn('job="platform-trace-store"',match[5])
        old=urllib.parse.parse_qs(urllib.parse.urlsplit(legacy_plan(T)[1]).query)['query'][0]
        self.assertIsNone(DIRECT.fullmatch(old))
        for parameter in parameters:
            self.assertEqual(set(parameter),{'query','time','timeout','nocache'})
            self.assertEqual(parameter['time'],[str(T)])
            self.assertEqual(parameter['timeout'],['2s'])
            self.assertEqual(parameter['nocache'],['1'])

    def test_name_matching_requires_explicit_name_and_keep_metric_names(self):
        current={'__name__':'vt_http_requests_total','job':'platform-trace-store','instance':'pilot',
                 'format':'protobuf','path':'/insert/opentelemetry/v1/traces'}
        stale={**current,'__name__':'vt_http_errors_total'}
        for plan,expected in ((None,'observed'),(ungated_plan,'malformed'),
                              (weakened_plan(omit='__name__'),'malformed'),
                              (weakened_plan(keep_names=False),'malformed')):
            with self.subTest(expected=expected,plan=plan):
                report,_=observe('baseline',T,current_extra=[current],stale_extra=[stale],plan=plan)
                self.assertEqual(report['query']['state'],expected)

    def test_complete_dimension_matching_prevents_stale_neighbor_cross_matches(self):
        base={'__name__':'otelcol_receiver_accepted_spans','job':'platform-collector','instance':'pilot',
              'receiver':'otlp','exporter':'otlphttp','data_type':'traces'}
        for dimension,other in (('receiver','otlp/pilot'),('exporter','otlphttp/traces'),('data_type','logs')):
            for plan,expected in ((None,'observed'),(weakened_plan(omit=dimension),'malformed')):
                report,_=observe('baseline',T,current_extra=[base],stale_extra=[{**base,dimension:other}],plan=plan)
                self.assertEqual(report['query']['state'],expected)
        current={'__name__':'vt_rows_dropped_total','job':'platform-trace-store','instance':'pilot','reason':'debug'}
        for plan,expected in ((None,'observed'),(weakened_plan(omit='reason'),'malformed')):
            report,_=observe('baseline',T,current_extra=[current],
                             stale_extra=[{**current,'reason':'too_many_fields'}],plan=plan)
            self.assertEqual(report['query']['state'],expected)

    def test_all_current_rows_and_matching_identities_remain_strict_before_any_pending(self):
        def private(rows,stamps):rows[-1]['metric']['private']='PRIVATE_VALUE'
        def unknown(rows,stamps):
            rows[-1]['metric']['source_metric' if stamps else '__name__']='unknown_metric'
        def mismatch(rows,stamps):
            if stamps:rows.pop()
        def contradictory_name(rows,stamps):
            if stamps:rows[-1]['metric']['__name__']='up'
        for poison in (private,unknown,mismatch,contradictory_name):
            with self.subTest(case=poison.__name__):
                report,_=observe('baseline',T,poison=poison)
                self.assertEqual(report['query']['state'],'malformed')
                self.assertTrue(all(source['state']=='malformed' for source in report['sources'].values()))
                self.assertNotIn('PRIVATE',json.dumps(report))


    def test_zero_scrape_time_and_existing_ten_second_age_boundary_are_preserved(self):
        def zero(rows,stamps):
            if stamps:
                for row in rows:row['value'][1]='0'
        report,_=observe('baseline',0,poison=zero)
        for source in report['sources'].values():
            self.assertEqual(source['state'],'fresh_up')
            self.assertEqual(source['measured_at'],0)
        def boundary(rows,stamps):
            if stamps:
                for row in rows:row['value'][1]=str(T)+'.2'
        for instant,expected in ((T+10,'fresh_up'),(T+11,'stale')):
            report,_=observe('baseline',instant,poison=boundary)
            self.assertTrue(all(source['state']==expected for source in report['sources'].values()))
        def future(rows,stamps):
            if stamps:rows[-1]['value'][1]='1'
        invalid,_=observe('baseline',0,poison=future)
        self.assertEqual(invalid['query']['state'],'malformed')


if __name__=='__main__':unittest.main()
