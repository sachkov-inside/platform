"""Independent whole-service vectors; fixtures never use the telemetry encoder."""
import copy
from decimal import Decimal
import json
import unittest
import oracle

NOW=1790000000000000
EXPECTED={'sample_us':NOW,'postmaster_us':NOW-10_000_000,'stats_reset_us':NOW-20_000_000,
          'connected_backends':3,'waiting_locks':0,'deadlocks':2}
VALUES={'backends':3,'waiting_locks':0,'deadlocks_since_reset':2,'postmaster_start_time_microseconds':NOW-10_000_000,
        'statistics_reset_time_microseconds':NOW-20_000_000,'sample_time_microseconds':NOW,'available':1}


def vectors():
    labels=lambda name:{'__name__':'inside.postgresql.server.'+name,'service.name':'inside-postgresql-source',
       'deployment.environment.name':'isolated-pilot','service.version':'0.1566.3','scope.name':'inside-collector'}
    rows=[{'metric':labels(name),'value':[1790000000,str(value)]} for name,value in VALUES.items()]
    stamps=[{'metric':{**labels(name),'source_metric':'inside.postgresql.server.'+name},'value':[1790000000,'1790000000']} for name in VALUES]
    return rows,stamps


def raw(rows):return json.dumps({'status':'success','data':{'resultType':'vector','result':rows}})


class WholeVectors(unittest.TestCase):
    def check(self,rows,stamps,**kwargs):
        return oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED,**kwargs)

    def test_current_exact_whole_vector_needs_both_raw_values_and_timestamps(self):
        rows,stamps=vectors();self.assertEqual(self.check(rows,stamps)['freshness'],'fresh')
        self.assertEqual(self.check(rows[:-1],stamps[:-1])['freshness'],'missing')
        for index in range(7):
            bad=copy.deepcopy(rows);bad[index]['metric']['authorization']='controlled-private'
            self.assertEqual(self.check(bad,stamps)['freshness'],'malformed')
            bad=copy.deepcopy(stamps);bad[index]['metric']['unknown']='controlled-private'
            self.assertEqual(self.check(rows,bad)['freshness'],'malformed')
        for mutate in ('extra','duplicate','release','mixed','bad-last'):
            bad=copy.deepcopy(rows);times=copy.deepcopy(stamps)
            if mutate=='extra':bad.append({'metric':{**bad[0]['metric'],'__name__':'inside.postgresql.server.extra'},'value':[1790000000,'1']})
            elif mutate=='duplicate':bad.append(copy.deepcopy(bad[-1]))
            elif mutate=='release':bad[-1]['metric']['service.version']='other'
            elif mutate=='mixed':times[-1]['value'][1]='1789999999.999'
            else:bad[-1]['value'][1]='NaN'
            self.assertEqual(self.check(bad,times)['freshness'],'malformed')

    def test_fresh_zero_query_time_and_old_retained_zero_do_not_create_source_freshness(self):
        rows,stamps=vectors();rows[-1]['value'][1]='0'
        self.assertEqual(self.check(rows,stamps)['freshness'],'unavailable')
        rows,stamps=vectors()
        value=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,completed_us=NOW+10_000_001,expected=EXPECTED)
        self.assertEqual(value['freshness'],'stale')
        self.assertEqual(self.check(rows,stamps,owner_current=False)['continuity'],'ownership_changed')
        self.assertEqual(oracle.evaluate('{',raw(stamps),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)['freshness'],'malformed')

class ProtocolVectors(unittest.TestCase):
    def check(self,rows,*,ordinary=None,stamps=None):
        source,timestamps=vectors()
        return oracle.evaluate_protocol(raw(source if ordinary is None else ordinary),raw(timestamps if stamps is None else stamps),raw(rows),
            evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)

    def test_global_fixed_family_vector_rejects_every_cross_service_row_before_projection(self):
        rows,_=vectors()
        for index in range(7):
            for service in ('platform-api','inside-telegram','foreign-service',None):
                for first in (True,False):
                    bad=copy.deepcopy(rows[index])
                    if service is None:del bad['metric']['service.name']
                    else:bad['metric']['service.name']=service
                    vector=[bad]+rows if first else rows+[bad]
                    with self.subTest(index=index,service=service,first=first):
                        self.assertEqual(self.check(vector)['freshness'],'malformed')
        self.assertEqual(self.check(rows)['freshness'],'fresh')
        self.assertEqual(self.check(rows[:-1])['freshness'],'missing')
        self.assertEqual(self.check([])['freshness'],'missing')

    def test_global_vector_validates_all_raw_shapes_and_exact_frame_agreement(self):
        rows,stamps=vectors()
        for change in ('env','version','scope','label','duplicate','overflow','noncanonical','disagree','partial_disagree'):
            bad=copy.deepcopy(rows)
            if change in ('env','version','scope','label'):
                key={'env':'deployment.environment.name','version':'service.version','scope':'scope.name','label':'private'}[change]
                bad[-1]['metric'][key]='controlled-private'
            elif change=='duplicate':bad.append(copy.deepcopy(bad[-1]))
            elif change=='overflow':bad=bad*3
            elif change=='noncanonical':bad[-1]['value'][1]='1e0'
            elif change=='partial_disagree':bad=bad[:1];bad[0]['value'][1]='4'
            else:bad[0]['value'][1]='4'
            with self.subTest(change=change):self.assertEqual(self.check(bad)['freshness'],'malformed')
        for malformed in ('{}','\ufeff{}','x'*65537,'{"status":"success","status":"success"}',
                          '{"status":"success","data":{"resultType":"vector","result":[NaN]}}'):
            self.assertEqual(oracle.evaluate_protocol(raw(rows),raw(stamps),malformed,evaluated_at=1790000000,
                completed_us=NOW,expected=EXPECTED)['freshness'],'malformed')
        future=copy.deepcopy(rows[5:6]);future[0]['value'][1]=str(NOW+1)
        self.assertEqual(self.check(future,ordinary=rows[:-1],stamps=stamps[:-1])['freshness'],'malformed')
        poisoned=copy.deepcopy(rows);poisoned[-1]['metric']['private']='controlled'
        self.assertEqual(self.check(poisoned,ordinary=rows[:-1],stamps=stamps[:-1])['freshness'],'malformed')

class UnavailableVectors(unittest.TestCase):
    def test_available_zero_does_not_hide_invalid_future_or_zero_stored_timestamps(self):
        rows,stamps=vectors();rows[-1]['value'][1]='0'
        for value in ('0','1790000000.001'):
            bad=copy.deepcopy(stamps);bad[0]['value'][1]=value
            result=oracle.evaluate(raw(rows),raw(bad),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)
            self.assertEqual(result['freshness'],'malformed')
        self.assertEqual(oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)['freshness'],'unavailable')

    def test_zero_missing_and_ownership_verdicts_validate_all_present_retained_identities(self):
        rows,stamps=vectors();rows[-1]['value'][1]='0'
        for available in ('0','1',None):
            for owner in (True,False):
                for fault in ('future_sample','future_postmaster','future_reset','after_sample','mixed_stamp','identity_stamp','partial_future','bad_last'):
                    bad=copy.deepcopy(rows);times=copy.deepcopy(stamps)
                    if fault=='future_sample':bad[5]['value'][1]=str(NOW+1)
                    elif fault=='future_postmaster':bad[3]['value'][1]=str(NOW+1)
                    elif fault=='future_reset':bad[4]['value'][1]=str(NOW+1)
                    elif fault=='after_sample':
                        bad[5]['value'][1]=str(NOW-20_000_000)
                        for stamp in times[:-1]:stamp['value'][1]='1789999980'
                    elif fault=='mixed_stamp':times[1]['value'][1]='1789999999.999'
                    elif fault=='identity_stamp':
                        for stamp in times[:-1]:stamp['value'][1]='1789999999'
                    elif fault=='partial_future':bad=[bad[3],bad[-1]];times=[times[3],times[-1]];bad[0]['value'][1]=str(NOW+1)
                    else:bad[0]['metric']['private']='controlled'
                    if available is None:
                        bad=[row for row in bad if row['metric']['__name__']!='inside.postgresql.server.available']
                        times=[row for row in times if row['metric']['__name__']!='inside.postgresql.server.available']
                    else:bad[-1]['value'][1]=available
                    with self.subTest(available=available,owner=owner,fault=fault):
                        self.assertEqual(oracle.evaluate(raw(bad),raw(times),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED,owner_current=owner)['freshness'],'malformed')


    def test_current_singleton_zero_and_old_valid_six_keep_distinct_timestamps(self):
        rows,stamps=vectors();rows[-1]['value'][1]='0'
        result=oracle.evaluate(raw(rows[-1:]),raw(stamps[-1:]),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)
        self.assertEqual(result['freshness'],'unavailable');self.assertFalse(result['count_complete'])
        for index in (3,4,5):rows[index]['value'][1]=str(int(rows[index]['value'][1])-30_000_000)
        for stamp in stamps[:-1]:stamp['value'][1]='1789999970'
        result=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)
        self.assertEqual(result['freshness'],'unavailable');self.assertFalse(result['count_complete'])
        self.assertIsNone(result['age_seconds'])
        for stamp in stamps:stamp['value'][1]='1789999970'
        result=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)
        self.assertEqual(result['freshness'],'stale')
