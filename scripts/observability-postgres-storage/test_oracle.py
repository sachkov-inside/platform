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
    def test_opt_in_failure_reason_preserves_the_original_whole_verdict(self):
        rows,stamps=vectors();rows[-1]['metric']['private']='not-exported'
        old=self.check(rows,stamps)
        self.assertEqual(old['freshness'],'malformed');self.assertEqual(old['reason'],'malformed')
        observed=self.check(rows,stamps,diagnose=True)
        self.assertEqual({**observed,'reason':'malformed'},old)
        self.assertEqual(observed['reason'],'oracle_values_labels')
        self.assertEqual(oracle.diagnostic_reason(observed),'oracle_values_labels')
        self.assertIsNone(oracle.diagnostic_reason(dict(observed)))

        # Diagnostic feature only: the original stale verdict and primary reason stay exact.
        rows,stamps=vectors()
        ordinary=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
            completed_us=NOW+10_000_001,expected=EXPECTED)
        observed=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
            completed_us=NOW+10_000_001,expected=EXPECTED,diagnose=True)
        self.assertEqual((ordinary['freshness'],ordinary['reason']),('stale','stale'))
        self.assertEqual(observed['reason'],'oracle_stale')
        self.assertEqual(len(ordinary),6);self.assertEqual(len(observed),6)
        self.assertEqual(set(observed),{'freshness','reason','points','age_seconds','continuity','count_complete'})
        self.assertEqual({**observed,'reason':'stale'},ordinary)
        self.assertEqual(oracle.diagnostic_reason(observed),'oracle_stale_healthy_sample_match')

        for available,expected,projection in (
                (1,EXPECTED,'oracle_stale_healthy_sample_match'),
                (1,{**EXPECTED,'sample_us':NOW+1},'oracle_stale_healthy_sample_different'),
                (1,{},'oracle_stale_healthy_sample_unknown'),
                (0,EXPECTED,'oracle_stale_availability')):
            rows,stamps=vectors();rows[-1]['value'][1]=str(available)
            options=dict(evaluated_at=1790000000,completed_us=NOW+10_000_001,expected=expected)
            ordinary=oracle.evaluate(raw(rows),raw(stamps),**options)
            diagnosed=oracle.evaluate(raw(rows),raw(stamps),**options,diagnose=True)
            self.assertEqual((ordinary['freshness'],ordinary['reason']),('stale','stale'))
            self.assertEqual(diagnosed['reason'],'oracle_stale');self.assertEqual(len(diagnosed),6)
            self.assertEqual({**diagnosed,'reason':'stale'},ordinary)
            self.assertEqual(oracle.diagnostic_reason(diagnosed),projection)
        for available,freshness in ((1,'fresh'),(0,'unavailable')):
            rows,stamps=vectors();rows[-1]['value'][1]=str(available)
            diagnosed=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
                completed_us=NOW+10_000_000,expected=EXPECTED,diagnose=True)
            self.assertEqual(diagnosed['freshness'],freshness)
            self.assertEqual(oracle.diagnostic_reason(diagnosed),None if available else 'oracle_unavailable')
        for poison,reason in (('last_row','oracle_values_labels'),('cohort','oracle_cohort')):
            rows,stamps=vectors()
            if poison=='last_row':rows[-1]['metric']['private']='not-exported'
            else:stamps[0]['value'][1]='1789999999.999'
            diagnosed=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
                completed_us=NOW+10_000_001,expected=EXPECTED,diagnose=True)
            self.assertEqual(diagnosed['freshness'],'malformed');self.assertEqual(oracle.diagnostic_reason(diagnosed),reason)

    def test_fixed_rejections_follow_the_first_actual_predicate_without_hiding_poison(self):
        cases=[]
        for channel in ('values','timestamps'):
            for group in ('decode','envelope','row','labels','number'):
                rows,stamps=vectors();target=rows if channel=='values' else stamps
                if group=='row':target[-1]['value']='not-an-array'
                elif group=='labels':target[-1]['metric']['private-canary']='not-exported'
                elif group=='number':target[-1]['value'][1]='NaN'
                values,times=raw(rows),raw(stamps)
                if group in ('decode','envelope'):
                    body='{' if group=='decode' else '{"status":"error","private":"not-exported"}'
                    if channel=='values':values=body
                    else:times=body
                cases.append((values,times,{},'oracle_'+channel+'_'+group,'malformed'))
        for change,reason in (('input','input'),('join','join_scope_version'),('identity','identity'),('cohort','cohort'),
                              ('availability','availability_order'),('complete','complete_time'),
                              ('expected','expected'),('disagree','value_mismatch'),('range','values_number')):
            rows,stamps=vectors();kwargs={}
            if change=='input':kwargs['evaluated_at']=True
            elif change=='join':stamps[-1]['metric']['scope.version']='unknown'
            elif change=='identity':rows[3]['value'][1]=str(NOW+1)
            elif change=='cohort':stamps[0]['value'][1]='1789999999.999'
            elif change=='availability':rows[-1]['value'][1]='0';stamps[-1]['value'][1]='1789999999.999'
            elif change=='complete':stamps[-1]['value'][1]='1789999999.999'
            elif change=='expected':kwargs['expected']={}
            elif change=='disagree':rows[0]['value'][1]='4'
            else:rows[0]['value'][1]='1000001'
            cases.append((raw(rows),raw(stamps),kwargs,'oracle_'+reason,'malformed'))
        rows,stamps=vectors();cases.append((raw(rows),raw(stamps),{'completed_us':NOW+10_000_001},'oracle_stale','stale'))
        rows[-1]['value'][1]='0';cases.append((raw(rows),raw(stamps),{},'oracle_unavailable','unavailable'))
        rows,stamps=vectors();stamps.pop()
        cases.append((raw(rows),raw(stamps),{},'oracle_join_family_presence','malformed'))
        rows,stamps=vectors();rows.pop()
        cases.append((raw(rows),raw(stamps),{},'oracle_join_family_presence','malformed'))
        for left in (None,'','unknown'):
            for right in (None,'','unknown'):
                rows,stamps=vectors()
                if left is not None:rows[0]['metric']['scope.version']=left
                if right is not None:stamps[0]['metric']['scope.version']=right
                if left==right:self.assertEqual(self.check(rows,stamps)['freshness'],'fresh')
                else:cases.append((raw(rows),raw(stamps),{},'oracle_join_scope_version','malformed'))
        for first,second,reason in (('0','1790000001','oracle_join_stamp_zero'),
                                    ('1790000001','0','oracle_join_stamp_future')):
            rows,stamps=vectors();stamps[0]['value'][1]=first;stamps[1]['value'][1]=second
            cases.append((raw(rows),raw(stamps),{},reason,'malformed'))
            stamps[-1]['metric']['scope.version']='unknown'
            cases.append((raw(rows),raw(stamps),{},'oracle_join_scope_version','malformed'))
        for channel in ('values','timestamps'):
            for poison in ('label','duplicate','escaped_duplicate','truncated','bom','nonfinite','cap'):
                rows,stamps=vectors();stamps[0]['metric']['scope.version']='unknown'
                target=rows if channel=='values' else stamps
                if poison=='label':target[-1]['metric']['private-canary']='not-exported'
                if poison=='duplicate':target.append(copy.deepcopy(target[-1]))
                values,times=raw(rows),raw(stamps)
                body=values if channel=='values' else times
                group='labels' if poison in ('label','duplicate') else 'decode'
                if poison=='escaped_duplicate':body=body[:-1]+',"sta\\u0074us":"success"}'
                elif poison=='truncated':body=body[:-1]
                elif poison=='bom':body='\ufeff'+body
                elif poison=='nonfinite':body=body.replace('"1790000000"','NaN',1) if channel=='timestamps' else body.replace('"3"','NaN',1)
                elif poison=='cap':body=' '*65537
                if channel=='values':values=body
                else:times=body
                cases.append((values,times,{},'oracle_'+channel+'_'+group,'malformed'))
        for values,times,options,reason,freshness in cases:
            with self.subTest(reason=reason):
                kwargs=dict(evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED);kwargs.update(options)
                ordinary=oracle.evaluate(values,times,**kwargs)
                observed=oracle.evaluate(values,times,**kwargs,diagnose=True)
                self.assertEqual(observed['freshness'],freshness)
                if reason=='oracle_stale':self.assertEqual(observed['reason'],'oracle_stale')
                self.assertEqual(oracle.diagnostic_reason(observed),
                    'oracle_stale_healthy_sample_match' if reason=='oracle_stale' else reason)
                self.assertEqual({**observed,'reason':ordinary['reason']},ordinary)
                self.assertNotIn('not-exported',json.dumps(observed))
                self.assertEqual(oracle.evaluate(values,times,**kwargs,diagnose=False),ordinary)
        rows,stamps=vectors();rows.pop();stamps.pop();rows[0]['metric']['private']='not-exported'
        observed=self.check(rows,stamps,diagnose=True,owner_current=False)
        self.assertEqual(oracle.diagnostic_reason(observed),'oracle_values_labels')
        self.assertEqual(self.check(rows,stamps,owner_current=False)['freshness'],'malformed')

    def test_diagnostic_provenance_refuses_foreign_subclasses_mutation_and_interruptions(self):
        from unittest.mock import patch
        class Hostile:
            def __getattribute__(self,_):raise AssertionError('foreign attribute read')
            def __bool__(self):raise AssertionError('foreign bool read')
            def __eq__(self,_):raise AssertionError('foreign comparison')
        for value in (Hostile(),{},None):self.assertIsNone(oracle.diagnostic_reason(value))
        for value in (Hostile(),None,1):
            with self.assertRaises(ValueError):self.check(*vectors(),diagnose=value)
        rows,stamps=vectors();rows[-1]['metric']['private']='not-exported'
        observed=self.check(rows,stamps,diagnose=True)
        class Foreign(type(observed)):
            def __getattribute__(self,_):raise AssertionError('foreign report getter')
        self.assertIsNone(oracle.diagnostic_reason(Foreign(dict(observed))))
        for raw_value in (Hostile(),{},dict(observed,reason='unknown'),dict(observed,points=Hostile())):
            with self.assertRaises(ValueError):oracle._DiagnosticReport(raw_value)
        for key,value in (('reason',Hostile()),('points',True),('age_seconds',float('nan')),('freshness','fresh')):
            mutated=self.check(rows,stamps,diagnose=True);mutated[key]=value
            self.assertIsNone(oracle.diagnostic_reason(mutated))
        class ForeignError(ValueError):
            def __getattribute__(self,_):raise AssertionError('foreign error getter')
        class ForeignMalformed(oracle._Malformed):
            def __getattribute__(self,_):raise AssertionError('foreign malformed getter')
        with self.assertRaises(ValueError):oracle._Malformed('unknown-private-group')
        for error in (ForeignError(),ForeignMalformed('decode'),ValueError('oracle_values_labels'),oracle._Malformed.__new__(oracle._Malformed)):
            with patch.object(oracle.json,'loads',side_effect=error):
                self.assertEqual(oracle.diagnostic_reason(self.check(*vectors(),diagnose=True)),'oracle_malformed_unknown')
        for primary in (KeyboardInterrupt(),SystemExit()):
            with patch.object(oracle.json,'loads',side_effect=primary):
                try:self.check(*vectors(),diagnose=True)
                except BaseException as error:self.assertIs(error,primary)
                else:self.fail('interruption suppressed')

        class ForeignString(str):
            __hash__=str.__hash__
            def __eq__(self,_):raise AssertionError('foreign comparison')
        class ForeignDict(dict):
            def __iter__(self):raise AssertionError('foreign traversal')
        for reason in oracle.ORACLE_JOIN_REASONS:
            with self.assertRaises(ValueError):oracle._Malformed(reason)
            forged=oracle._Malformed('oracle_join');object.__setattr__(forged,'_group',reason)
            with patch.object(oracle.json,'loads',side_effect=forged),patch.object(oracle,'_refine_join_reason') as helper:
                self.assertEqual(oracle.diagnostic_reason(self.check(*vectors(),diagnose=True)),'oracle_malformed_unknown')
                helper.assert_not_called()
        rows,stamps=vectors();stamps.pop()
        for returned in (Hostile(),ForeignString(oracle.ORACLE_JOIN_REASONS[0]),'unknown'):
            with patch.object(oracle,'_refine_join_reason',return_value=returned):
                self.assertEqual(oracle.diagnostic_reason(self.check(rows,stamps,diagnose=True)),'oracle_join')
        for mode in ('same','different','interrupt','exit'):
            seen=[]
            original=oracle._reject
            def reject(group):
                try:original(group)
                except oracle._Malformed as error:seen.append((error,error.__traceback__));raise
            def refine(*_):
                error=seen[0][0];seen.append(error.__traceback__)
                if mode=='same':raise error
                if mode=='interrupt':raise KeyboardInterrupt()
                if mode=='exit':raise SystemExit()
                raise ValueError('not-exported')
            with patch.object(oracle,'_reject',side_effect=reject),patch.object(oracle,'_refine_join_reason',side_effect=refine):
                self.assertEqual(oracle.diagnostic_reason(self.check(rows,stamps,diagnose=True)),'oracle_join')
            self.assertIs(seen[0][0].__traceback__,seen[1])
            trace=seen[0][0].__traceback__;names=[]
            while trace is not None:names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
            self.assertNotIn('refine',names)
        for value in (Hostile(),ForeignDict(),{ForeignString('private'):{}},{'private':{}}):
            self.assertEqual(oracle._refine_join_reason(value,{}, {},NOW),'oracle_join')
        name=next(iter(oracle._NAMES));labels={name:oracle._FIXED.copy()}
        for stamp in (Hostile(),ForeignString('0')):
            self.assertEqual(oracle._refine_join_reason(labels,labels,{name:stamp},NOW),'oracle_join')

        # Only a bounded finite operand may be compared on an already-stale path.
        class ForeignInt(int):pass
        unsafe=(Hostile(),ForeignDict(EXPECTED),{},None,{**EXPECTED,'private':Hostile()},
                {**{key:value for key,value in EXPECTED.items() if key!='sample_us'},ForeignString('sample_us'):NOW})
        for expected in (*unsafe,*({**EXPECTED,'sample_us':value} for value in (Hostile(),True,ForeignInt(NOW),0,-1,oracle._MAX+1))):
            diagnosed=oracle.evaluate(raw(vectors()[0]),raw(vectors()[1]),evaluated_at=1790000000,
                completed_us=NOW+10_000_001,expected=expected,diagnose=True)
            self.assertEqual(diagnosed['reason'],'oracle_stale')
            self.assertEqual(oracle.diagnostic_reason(diagnosed),'oracle_stale_healthy_sample_unknown')
        other_values={key:NOW if key=='sample_us' else Hostile() for key in EXPECTED}
        diagnosed=oracle.evaluate(raw(vectors()[0]),raw(vectors()[1]),evaluated_at=1790000000,
            completed_us=NOW+10_000_001,expected=other_values,diagnose=True)
        self.assertEqual(oracle.diagnostic_reason(diagnosed),'oracle_stale_healthy_sample_match')
        rows,stamps=vectors();rows[-1]['value'][1]='0'
        with patch.object(oracle,'_sample_operand',side_effect=AssertionError('availability inspected expected')) as operand:
            diagnosed=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
                completed_us=NOW+10_000_001,expected=Hostile(),diagnose=True)
            self.assertEqual(oracle.diagnostic_reason(diagnosed),'oracle_stale_availability');operand.assert_not_called()
        with patch.object(oracle,'_observe_stale',side_effect=AssertionError('off-path observer called')) as observer:
            for available in (0,1):
                rows,stamps=vectors();rows[-1]['value'][1]=str(available)
                ordinary=oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
                    completed_us=NOW+10_000_001,expected=Hostile())
                self.assertIs(type(ordinary),dict);self.assertEqual(ordinary['reason'],'stale')
            self.check(*vectors(),diagnose=True)
            rows,stamps=vectors();self.check(rows[:-1],stamps[:-1],diagnose=True)
            rows[-1]['metric']['private']='not-exported';self.check(rows,stamps,diagnose=True)
            observer.assert_not_called()
        rows,stamps=vectors()
        def stale():
            return oracle.evaluate(raw(rows),raw(stamps),evaluated_at=1790000000,
                completed_us=NOW+10_000_001,expected=EXPECTED,diagnose=True)
        valid=stale();self.assertEqual(oracle.diagnostic_reason(valid),'oracle_stale_healthy_sample_match')
        with self.assertRaises(AttributeError):valid._stale=('availability','unknown')
        with self.assertRaises(AttributeError):valid._snapshot=()
        missing=stale();object.__delattr__(missing,'_stale')
        self.assertEqual(oracle.diagnostic_reason(missing),'oracle_stale')
        for witness in (None,[],(),('healthy',),('healthy','match','private'),(Hostile(),'match'),
                        ('healthy',ForeignString('match')),('private','match'),('healthy','private'),Hostile()):
            mutated=stale();object.__setattr__(mutated,'_stale',witness)
            self.assertEqual(oracle.diagnostic_reason(mutated),'oracle_stale')
            self.assertEqual(mutated['reason'],'oracle_stale')
        self.assertIsNone(oracle.diagnostic_reason(dict(valid)))
        self.assertIsNone(oracle.diagnostic_reason(Foreign(dict(valid))))
        for field,value in (('reason','oracle_stale_healthy_sample_match'),('points',0),('freshness','unavailable')):
            mutated=stale();mutated[field]=value;self.assertIsNone(oracle.diagnostic_reason(mutated))
        for refined in ('oracle_stale_availability','oracle_stale_healthy_sample_match',
                        'oracle_stale_healthy_sample_different','oracle_stale_healthy_sample_unknown'):
            with self.assertRaises(ValueError):oracle._DiagnosticReport({**valid,'reason':refined})
        # Fault injection stays within optional observer/accessor leaves, after the primary report/admission.
        for leaf in ('_stale_observation','_stale_projection'):
            for mode in ('same','different','interrupt','exit'):
                primary=RuntimeError('private-primary')
                secondary=primary if mode=='same' else KeyboardInterrupt() if mode=='interrupt' else SystemExit() if mode=='exit' else ValueError('private-secondary')
                value=stale()
                try:
                    try:raise primary
                    except RuntimeError:
                        traceback=primary.__traceback__
                        with patch.object(oracle,leaf,side_effect=secondary):
                            observer_value=stale();self.assertEqual(observer_value['reason'],'oracle_stale')
                            if leaf=='_stale_observation':value=observer_value
                            self.assertEqual(oracle.diagnostic_reason(value),'oracle_stale')
                        self.assertIs(primary.__traceback__,traceback)
                        raise
                except RuntimeError as caught:
                    self.assertIs(caught,primary);self.assertIs(caught.__traceback__,traceback)
                self.assertEqual(value['reason'],'oracle_stale')
                self.assertNotIn('private',json.dumps(value))
        for witness in (Hostile(),('healthy',ForeignString('match')),['healthy','match']):
            with patch.object(oracle,'_stale_observation',return_value=witness):
                self.assertEqual(oracle.diagnostic_reason(stale()),'oracle_stale')

    def test_success_pending_and_protocol_keep_the_original_plain_results(self):
        rows,stamps=vectors()
        for selected in (rows,rows[:-1]):
            times=stamps if len(selected)==7 else stamps[:-1]
            expected=self.check(selected,times)
            observed=self.check(selected,times,diagnose=True)
            self.assertIs(type(observed),dict);self.assertEqual(observed,expected)
            self.assertIsNone(oracle.diagnostic_reason(observed))
        ordinary=self.check(rows,stamps)
        self.assertEqual(ordinary,{'freshness':'fresh','reason':'none','points':7,'age_seconds':0,
                                   'continuity':'unknown','count_complete':False})
        self.assertEqual(oracle.evaluate_protocol(raw(rows),raw(stamps),raw(rows),evaluated_at=1790000000,
                         completed_us=NOW,expected=EXPECTED),ordinary)

        from unittest.mock import patch
        with patch.object(oracle,'_refine_join_reason',side_effect=AssertionError('unexpected refinement')) as helper:
            rows,stamps=vectors();stamps.pop();self.check(rows,stamps)
            self.check(*vectors(),diagnose=True)
            rows,stamps=vectors();self.check(rows[:-1],stamps[:-1],diagnose=True)
            rows[-1]['metric']['private']='not-exported';self.check(rows,stamps,diagnose=True)
            rows,stamps=vectors()
            oracle.evaluate_protocol(raw(rows),raw(stamps),raw(rows),evaluated_at=1790000000,completed_us=NOW,expected=EXPECTED)
            helper.assert_not_called()

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
