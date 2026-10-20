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


def legacy_plan(instant):
    values=query_plan(instant)[0]
    expression=urllib.parse.parse_qs(urllib.parse.urlsplit(values).query)['query'][0]
    stamp='timestamp(label_replace('+expression+',"source_metric","$1","__name__","(.+)"))'
    return [values,'/metrics/api/v1/query?'+urllib.parse.urlencode({
        'query':stamp,'time':str(instant),'timeout':'2s','nocache':'1'})]


query_plan=query.query_plan


def observe(scenario, instant, *, plan=None, poison=None):
    requests=[]
    def reply(handler):
        parameters=urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
        expression=parameters['query'][0]
        direct=DIRECT.fullmatch(expression) is not None
        stamps=direct or expression.startswith('timestamp(label_replace(')
        requests.append(parameters)
        now=int(parameters['time'][0])
        metrics=[{'__name__':'up','job':'platform-collector','instance':'pilot'},
                 {'__name__':'up','job':'platform-trace-store','instance':'pilot'},
                 {'__name__':'vt_rows_ingested_total','job':'platform-trace-store','instance':'pilot',
                  'type':'opentelemetry_traces_otlphttp_protobuf'}]
        # Real current values omit a disappeared target counter. An old implicit
        # subquery still has that identity at its earlier aligned grid point.
        if scenario=='vt_down' and (not stamps or direct):metrics=metrics[:2]
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
        old_down,_=observe('vt_down',T+17,plan=legacy_plan)
        self.assertEqual(old_down['query']['state'],'malformed')

    def test_stamp_functions_receive_separate_raw_metric_selectors_before_transform_and_union(self):
        parameters=[urllib.parse.parse_qs(urllib.parse.urlsplit(path).query) for path in query_plan(T)]
        values=parameters[0]['query'][0];stamps=parameters[1]['query'][0]
        match=DIRECT.fullmatch(stamps)
        self.assertIsNotNone(match)
        self.assertEqual(list(match.groups()),re.findall(r'\{[^{}]+\}',values))
        self.assertIn('job="platform-collector"',match[1])
        self.assertIn('job="platform-trace-store"',match[2])
        old=urllib.parse.parse_qs(urllib.parse.urlsplit(legacy_plan(T)[1]).query)['query'][0]
        self.assertIsNone(DIRECT.fullmatch(old))
        for parameter in parameters:
            self.assertEqual(set(parameter),{'query','time','timeout','nocache'})
            self.assertEqual(parameter['time'],[str(T)])
            self.assertEqual(parameter['timeout'],['2s'])
            self.assertEqual(parameter['nocache'],['1'])

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
