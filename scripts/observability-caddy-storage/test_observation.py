"""Whole owned Caddy vectors are checked before availability or numeric projection."""
import copy
import json
import unittest
import caddy_status


def acquisition(*,point=100,stamp=99):
    rows=[]
    def add(name,value,**labels):
        rows.append({'metric':{'__name__':name,'job':'platform-caddy','instance':'pilot',**labels},'value':[point,str(value)]})
    add('up',1)
    labels={'server':'srv0','handler':'subroute'}
    add('caddy_http_requests_total',3,**labels)
    add('caddy_http_request_errors_total',1,**labels)
    add('caddy_http_requests_in_flight',1,**labels)
    # Worked distributions: GET200 latencies0.1+0.3; GET502 latency0.02.
    for code,count,total,buckets in (('200',2,'0.4',[0,0,0,0,1,1,2,2,2,2,2,2]),('502',1,'0.02',[0,0,1,1,1,1,1,1,1,1,1,1])):
        group={**labels,'method':'GET','code':code}
        for le,value in zip(('0.005','0.01','0.025','0.05','0.1','0.25','0.5','1','2.5','5','10','+Inf'),buckets):
            add('caddy_http_request_duration_seconds_bucket',value,**group,le=le)
        add('caddy_http_request_duration_seconds_sum',total,**group)
        add('caddy_http_request_duration_seconds_count',count,**group)
    values={'status':'success','data':{'resultType':'vector','result':rows}}
    timestamps=copy.deepcopy(values)
    for row in timestamps['data']['result']:
        row['metric']['source_metric']=row['metric']['__name__'];row['value'][1]=str(stamp)
    return values,timestamps


class WholeObservation(unittest.TestCase):
    def test_wrong_final_row_is_malformed_for_complete_and_partial_visible_vectors(self):
        values,stamps=acquisition()
        for partial in (False,True):
            prefix=[values['data']['result'][0]] if partial else values['data']['result'][:-1]
            prefix_stamps=[stamps['data']['result'][0]] if partial else stamps['data']['result'][:-1]
            valid=copy.deepcopy(values);valid['data']['result']=copy.deepcopy(prefix)+[copy.deepcopy(values['data']['result'][-1])]
            valid_stamps=copy.deepcopy(stamps);valid_stamps['data']['result']=copy.deepcopy(prefix_stamps)+[copy.deepcopy(stamps['data']['result'][-1])]
            self.assertEqual(caddy_status.evaluate(json.dumps(valid).encode(),json.dumps(valid_stamps).encode(),evaluated_at=100,completed_at=101)['state'],
                             'incomplete' if partial else 'observed')
            for mutation in ('method','code','unknown_label','count_type','fractional_count','negative','timestamp_type','unknown_family'):
                bad=copy.deepcopy(valid);row=bad['data']['result'][-1]
                if mutation=='method':row['metric']['method']='UNDECLARED'
                elif mutation=='code':row['metric']['code']='099'
                elif mutation=='unknown_label':row['metric']['private']='private-caddy-sentinel'
                elif mutation=='count_type':row['value'][1]=1
                elif mutation=='fractional_count':row['value'][1]='1.5'
                elif mutation=='negative':row['value'][1]='-1'
                elif mutation=='timestamp_type':row['value'][0]=True
                else:row['metric']['__name__']='caddy_http_unrecognized'
                bad_stamps=copy.deepcopy(valid_stamps)
                bad_stamps['data']['result'][-1]['metric']={**row['metric'],'source_metric':row['metric']['__name__']}
                result=caddy_status.evaluate(json.dumps(bad).encode(),json.dumps(bad_stamps).encode(),evaluated_at=100,completed_at=101)
                with self.subTest(partial=partial,mutation=mutation):
                    self.assertEqual(result['state'],'malformed');self.assertIsNone(result['observation'])
                    self.assertNotIn('private',json.dumps(result))

    def test_known_partial_duration_count_cannot_exceed_known_total_before_missing_up(self):
        values,stamps=acquisition()
        values['data']['result']=[values['data']['result'][1],values['data']['result'][-1]]
        values['data']['result'][0]['value'][1]='0'
        stamps['data']['result']=[stamps['data']['result'][1],stamps['data']['result'][-1]]
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed');self.assertIsNone(result['observation'])

    def test_visible_error_counter_contradiction_precedes_missing_up(self):
        values,stamps=acquisition()
        keep=('caddy_http_requests_total','caddy_http_request_errors_total')
        values['data']['result']=[row for row in values['data']['result'] if row['metric']['__name__'] in keep]
        values['data']['result'][0]['value'][1]='0'
        stamps['data']['result']=[row for row in stamps['data']['result'] if row['metric']['__name__'] in keep]
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed')
        self.assertIsNone(result['observation'])

    def test_literal_distributions_and_private_final_row_do_not_become_partial_success(self):
        values,stamps=acquisition()
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'observed')
        self.assertEqual(result['observation']['requests_total'],3)
        self.assertEqual(result['observation']['duration'][0],{'method':'GET','code':200,'count':2,'sum_seconds':0.4,'buckets':[0,0,0,0,1,1,2,2,2,2,2,2]})
        for partial in (False,True):
            bad=copy.deepcopy(values)
            if partial:bad['data']['result']=bad['data']['result'][:1]
            bad['data']['result'].append({'metric':{'__name__':'up','job':'platform-caddy','instance':'pilot','private':'private-caddy-sentinel'},'value':[100,'1']})
            refused=caddy_status.evaluate(json.dumps(bad).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
            self.assertEqual(refused['state'],'malformed')
            self.assertIsNone(refused['observation'])
            self.assertNotIn('private',json.dumps(refused))

        # Native-only detail never changes the ordinary failed observation.
        partial_values,partial_stamps=acquisition()
        for vector in (partial_values,partial_stamps):
            vector['data']['result']=[row for row in vector['data']['result'] if row['metric']['__name__']!='caddy_http_requests_total']
        raw=(json.dumps(partial_values).encode(),json.dumps(partial_stamps).encode())
        legacy=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101)
        detailed=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=True)
        self.assertEqual(legacy['reason'],'partial')
        self.assertEqual(detailed,{**legacy,'reason':'partial_missing_total'})

        import artifact
        import caddy_query
        import collection
        import evidence
        from pathlib import Path
        import sys
        import tempfile
        from test_query import Response
        from unittest.mock import patch

        class Hostile:
            def __getattribute__(self,_):raise AssertionError('private-getter')
            def __bool__(self):raise AssertionError('private-flag-coercion')
            def __str__(self):raise AssertionError('private-detail-coercion')
            def __eq__(self,_):raise AssertionError('private-detail-comparison')
        class ForeignText(str):pass

        cases=[]
        for expected,missing in (
                ('partial_missing_total','caddy_http_requests_total'),
                ('partial_missing_errors','caddy_http_request_errors_total'),
                ('partial_missing_flight','caddy_http_requests_in_flight'),
                ('partial_no_duration_groups','duration'),
                ('partial_missing_bucket','bucket'),
                ('partial_missing_sum','sum'),
                ('partial_missing_count','count'),
                ('partial_count_sum',None),('partial_timestamps',None)):
            left,right=acquisition()
            for vector in (left,right):
                if missing is not None:
                    def keep(row):
                        metric=row['metric'];name=metric['__name__']
                        if missing=='duration':return not name.startswith('caddy_http_request_duration_seconds_')
                        if missing in ('bucket','sum','count'):
                            return not (name=='caddy_http_request_duration_seconds_'+missing and metric.get('code')=='200'
                                and (missing!='bucket' or metric.get('le')=='0.005'))
                        return name!=missing
                    vector['data']['result']=[row for row in vector['data']['result'] if keep(row)]
            if expected=='partial_count_sum':left['data']['result'][1]['value'][1]='4'
            if expected=='partial_timestamps':right['data']['result'][-1]['value'][1]='98'
            cases.append((expected,left,right))

        legacy={'schema':1,'scope':'isolated-pilot-caddy','partition':'srv0/subroute','state':'incomplete',
            'reason':'partial','sample_age_seconds':2.0,'observation':None,'comparison':None,
            'transport':{'canonical':'unrun','mcp':'unrun'},
            'not_covered':['production-caddy','host','tcp','tls','http3','pre-route-parse','raw-errors']}
        for expected,left,right in cases:
            with self.subTest(diagnostic=expected):
                raw=(json.dumps(left).encode(),json.dumps(right).encode())
                self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101),legacy)
                for flag in (False,None,1,'true',Hostile()):
                    self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=flag),legacy)
                self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=True),{**legacy,'reason':expected})
                for flag in (False,None,1,Hostile(),True):
                    responses=[Response(body) for body in raw]
                    with patch('urllib.request.OpenerDirector.open',side_effect=responses) as opened,patch.object(
                            caddy_status,'evaluate',wraps=caddy_status.evaluate) as evaluated:
                        report,packet=caddy_query.read_snapshot('owned_token',evaluated_at=100,wall_clock=lambda:101,diagnose=flag)
                    self.assertEqual(opened.call_count,2)
                    expected_report={**legacy,'reason':expected if flag is True else 'partial',
                        'transport':{'canonical':'passed','mcp':'unrun'}}
                    self.assertEqual(report,expected_report)
                    self.assertEqual(packet,{'values':raw[0],'timestamps':raw[1],'evaluated_at':100,'completed_at':101})
                    self.assertEqual('diagnose' in evaluated.call_args.kwargs,flag is True)
                    if flag is True:self.assertIs(evaluated.call_args.kwargs['diagnose'],True)
                with tempfile.TemporaryDirectory() as directory:
                    root=Path(directory).resolve();private=root/'private';private.mkdir(mode=0o700)
                    metadata=root/'metadata';metadata.mkdir(mode=0o700)
                    artifact.write(private,report)
                    self.assertEqual(artifact.read(private),report)
                    failed=evidence.Run();failed.start('partition_initial_state');failed.fail('budget')
                    artifact.write_run(private,failed.snapshot())
                    destination=root/'public';collection.collect(private,metadata,destination)
                    self.assertEqual(artifact.read(destination),report)
                    self.assertEqual(artifact.read_run(destination),failed.snapshot())
                    poisons=[{**report,'reason':'private-caddy-sentinel'},
                        {**report,'private':'private-caddy-sentinel'},
                        {**report,'state':'observed'},{**report,'state':'stale'},
                        {**report,'sample_age_seconds':None},{**report,'sample_age_seconds':11},
                        {**report,'transport':{'canonical':'passed','mcp':'passed'}},
                        {**report,'transport':{'canonical':'failed','mcp':'unrun'}}]
                    poisoned=[json.dumps(poison) for poison in poisons]
                    poisoned.extend((json.dumps(report)[:-1],json.dumps(report)[:-1]+',"reason":"partial"}',
                        ' '*(131072+1),'{"private":"private-caddy-sentinel"}'))
                    for raw_poison in poisoned:
                        (private/artifact.NAME).write_text(raw_poison)
                        refused=root/'refused'
                        with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                            collection.collect(private,metadata,refused)
                        self.assertFalse(refused.exists())
                    for reason in (ForeignText(expected),Hostile()):
                        with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                            artifact.validate({**report,'reason':reason})
                # Entire raw validation retains precedence, including a poison in the last visible row.
                for poison in ('private','duplicate','nonfinite','count','bucket'):
                    bad=copy.deepcopy(left)
                    if poison=='private':bad['data']['result'][-1]['metric']['private']='private-caddy-sentinel'
                    elif poison=='duplicate':bad['data']['result'].append(copy.deepcopy(bad['data']['result'][-1]))
                    elif poison=='nonfinite':bad['data']['result'][-1]['value'][1]='NaN'
                    elif poison=='count':
                        for row in bad['data']['result']:
                            if row['metric']['__name__']=='caddy_http_request_duration_seconds_count':row['value'][1]='99'
                    else:
                        for row in bad['data']['result']:
                            if row['metric'].get('le')=='0.005':row['value'][1]='99'
                    # The no-duration case has no count/bucket to poison.
                    if poison in ('count','bucket') and expected=='partial_no_duration_groups':continue
                    refused=caddy_status.evaluate(json.dumps(bad).encode(),raw[1],evaluated_at=100,completed_at=101,diagnose=True)
                    self.assertEqual((refused['state'],refused['reason']),('malformed','raw_contract'))
                    self.assertNotIn('private',json.dumps(refused))

        # Default-mode complete/availability/previous/reset semantics remain byte-result identical.
        for state in ('observed','missing','down','stale','unseeded'):
            left,right=acquisition()
            if state=='missing':
                for vector in (left,right):vector['data']['result']=vector['data']['result'][1:]
            elif state=='down':left['data']['result'][0]['value'][1]='0'
            elif state=='unseeded':
                for vector in (left,right):vector['data']['result']=vector['data']['result'][:1]
            raw=(json.dumps(left).encode(),json.dumps(right).encode())
            options={'evaluated_at':100,'completed_at':111 if state=='stale' else 101}
            normal=caddy_status.evaluate(*raw,**options)
            self.assertEqual(normal['state'],'incomplete' if state=='unseeded' else state)
            detailed=caddy_status.evaluate(*raw,**options,diagnose=True)
            detailed.pop('up_age_window',None)
            self.assertEqual(detailed,normal)
        for baseline in ('down','reset','invalid'):
            old,old_stamps=acquisition(point=80,stamp=79)
            if baseline=='down':old['data']['result'][0]['value'][1]='0'
            elif baseline=='reset':
                for row in old['data']['result']:
                    if row['metric']['__name__'] not in ('up','caddy_http_requests_in_flight'):
                        row['value'][1]=str(float(row['value'][1])*2)
            previous={'values':json.dumps(old).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':80,'completed_at':81}
            if baseline=='invalid':previous['private']='private-caddy-sentinel'
            left,right=acquisition();raw=(json.dumps(left).encode(),json.dumps(right).encode())
            normal=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,previous=previous)
            self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,previous=previous,diagnose=True),normal)
        left,right=acquisition();raw=(json.dumps(left).encode(),json.dumps(right).encode())
        for metadata in (None,'unknown',ForeignText('partial_missing_total'),Hostile()):
            with patch.object(caddy_status,'_observation_result',return_value=(None,metadata)):
                self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=True),legacy)
        for kind in (KeyboardInterrupt,SystemExit):
            primary=kind('private-original');traces=[]
            def interrupted():
                try:raise primary
                except BaseException:traces.append(sys.exc_info()[2]);raise
            try:caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,completion_clock=interrupted,diagnose=True)
            except BaseException as caught:
                self.assertIs(caught,primary);trace=sys.exc_info()[2];chain=[]
                while trace:chain.append(trace);trace=trace.tb_next
                self.assertIn(traces[0],chain)
            else:self.fail('original interrupt hidden')

        # The same final age does not identify the fixed-evaluation window.
        from decimal import Decimal
        for evaluated in (100,100.0,1e2,Decimal('100')):
            for completed in (101,101.0,Decimal('101')):
                for stamp,expected in ((89,'over_at_evaluation'),(90,'crossed_by_completion')):
                    left,right=acquisition(stamp=stamp)
                    raw=(json.dumps(left).encode(),json.dumps(right).encode())
                    normal=caddy_status.evaluate(*raw,evaluated_at=evaluated,completed_at=completed)
                    actual=caddy_status.evaluate(*raw,evaluated_at=evaluated,completed_at=completed,diagnose=True)
                    self.assertEqual(actual.pop('up_age_window'),expected)
                    self.assertEqual(actual,normal)
        for stamp,completed,expected in ((89,100.5,'over_at_evaluation'),(90,101.5,'crossed_by_completion')):
            left,right=acquisition(stamp=stamp);raw=(json.dumps(left).encode(),json.dumps(right).encode())
            actual=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=completed,diagnose=True)
            self.assertEqual(actual['sample_age_seconds'],11.5)
            self.assertEqual(actual['up_age_window'],expected)
        for point,stamp,completed,expected in ((0,0,11,'crossed_by_completion'),
                (100,90,100,None),(100,90,100.5,'crossed_by_completion'),
                (1000000000000.0,999999999989,1000000000000.0,'over_at_evaluation')):
            left,right=acquisition(point=point,stamp=stamp);raw=(json.dumps(left).encode(),json.dumps(right).encode())
            normal=caddy_status.evaluate(*raw,evaluated_at=point,completed_at=completed)
            actual=caddy_status.evaluate(*raw,evaluated_at=point,completed_at=completed,diagnose=True)
            self.assertEqual(actual.pop('up_age_window',None),expected)
            self.assertEqual(actual,normal)
        left,right=acquisition(stamp=89);raw=(json.dumps(left).encode(),json.dumps(right).encode())
        for flag in (False,None,1,'true',Hostile()):
            self.assertEqual(caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=flag),
                             caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101))
        class ForeignInt(int):pass
        class ForeignFloat(float):pass
        class ForeignDecimal(Decimal):pass
        for invalid in (True,100.5,ForeignInt(100),ForeignFloat(100),ForeignDecimal('100'),
                        float('nan'),float('inf'),-1,2**53,Hostile()):
            actual=caddy_status.evaluate(*raw,evaluated_at=invalid,completed_at=101,diagnose=True)
            self.assertEqual((actual['state'],actual['reason']),('malformed','raw_contract'))
            self.assertNotIn('up_age_window',actual)
        for state in ('up_zero','other_old','future','missing','poison'):
            left,right=acquisition(stamp=99)
            if state=='up_zero':
                left['data']['result'][0]['value'][1]='0'
                for row in right['data']['result']:row['value'][1]='89'
            elif state=='other_old':right['data']['result'][-1]['value'][1]='89'
            elif state=='future':right['data']['result'][0]['value'][1]='101'
            elif state=='missing':
                for vector in (left,right):vector['data']['result']=vector['data']['result'][1:]
            else:left['data']['result'][-1]['metric']['private']='private-caddy-sentinel'
            raw=(json.dumps(left).encode(),json.dumps(right).encode())
            normal=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101)
            actual=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,diagnose=True)
            self.assertEqual(actual.pop('up_age_window',None),'over_at_evaluation' if state=='up_zero' else None)
            self.assertEqual(actual,normal)
        # Later previous validation replaces the candidate, even after first-stale detail.
        left,right=acquisition(stamp=89);raw=(json.dumps(left).encode(),json.dumps(right).encode())
        previous={'values':raw[0],'timestamps':raw[1],'evaluated_at':100,'completed_at':100,'private':'private-caddy-sentinel'}
        actual=caddy_status.evaluate(*raw,evaluated_at=100,completed_at=101,previous=previous,diagnose=True)
        self.assertEqual((actual['state'],actual['reason']),('malformed','raw_contract'))
        self.assertNotIn('up_age_window',actual)
        native_clock=caddy_status.clock
        for prior in (None,previous):
            sequences=[]
            for flag in (False,True):
                with patch.object(caddy_status,'clock',wraps=native_clock) as clocks:
                    caddy_status.evaluate(*raw,evaluated_at=100.0,completed_at=100,
                        completion_clock=lambda:101,previous=prior,diagnose=flag)
                sequences.append(clocks.call_args_list)
            self.assertEqual(sequences[0],sequences[1])
        # Actual query callsite uses its existing final completion read, not a new clock.
        left,right=acquisition(stamp=90);raw=(json.dumps(left).encode(),json.dumps(right).encode())
        for flag in (False,True):
            with patch('urllib.request.OpenerDirector.open',side_effect=[Response(body) for body in raw]) as opened, \
                    patch.object(caddy_status,'clock',wraps=native_clock) as clocks:
                readings=[]
                def wall():
                    value=(100,100.5)[len(readings)];readings.append(value);return value
                actual,packet=caddy_query.read_snapshot('owned_token',evaluated_at=100,wall_clock=wall,diagnose=flag)
            self.assertEqual(opened.call_count,2)
            self.assertEqual(readings,[100,100.5])
            self.assertEqual(packet,{'values':raw[0],'timestamps':raw[1],'evaluated_at':100,'completed_at':100.5})
            self.assertEqual(actual.pop('up_age_window',None),'crossed_by_completion' if flag else None)
            self.assertEqual((actual['state'],actual['sample_age_seconds']),('stale',10.5))
            if flag:self.assertEqual(clocks.call_args_list,query_clocks)
            else:query_clocks=clocks.call_args_list
        with patch('urllib.request.OpenerDirector.open',side_effect=TimeoutError('private-caddy-sentinel')):
            refused,_=caddy_query.read_snapshot('owned_token',diagnose=True)
        self.assertEqual(refused['state'],'query_unavailable')
        self.assertNotIn('up_age_window',refused)
        self.assertNotIn('private',json.dumps(refused))

        # Exact stale Decimal ages may project to the persisted binary64 value10.0.
        for source_stamp,final,token in (
                ('89.9999999999999999',100,'over_at_evaluation'),
                ('90',Decimal('100.0000000000000001'),'crossed_by_completion')):
            left,right=acquisition(stamp=source_stamp)
            raw=(json.dumps(left).encode(),json.dumps(right).encode())
            reports=[];calls=[]
            for flag in (False,True):
                readings=[]
                def wall():
                    value=(100,final)[len(readings)];readings.append(value);return value
                with patch('urllib.request.OpenerDirector.open',side_effect=[Response(body) for body in raw]) as opened, \
                        patch.object(caddy_status,'clock',wraps=native_clock) as clocks:
                    report,packet=caddy_query.read_snapshot('owned_token',evaluated_at=100,wall_clock=wall,diagnose=flag)
                self.assertEqual(opened.call_count,2)
                self.assertEqual(readings,[100,final])
                self.assertEqual(packet,{'values':raw[0],'timestamps':raw[1],'evaluated_at':100,'completed_at':final})
                self.assertEqual((report['state'],report['reason'],report['sample_age_seconds']),('stale','none',10.0))
                self.assertIsNone(report['observation']);self.assertIsNone(report['comparison'])
                calls.append(clocks.call_args_list);reports.append(report)
            self.assertEqual(calls[0],calls[1])
            diagnostic=reports[1].copy()
            self.assertEqual(diagnostic.pop('up_age_window'),token)
            self.assertEqual(diagnostic,reports[0])
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();private=root/'private';private.mkdir(mode=0o700)
                metadata=root/'metadata';metadata.mkdir(mode=0o700)
                artifact.write(private,reports[1])
                self.assertEqual(artifact.read(private),reports[1])
                failed=evidence.Run();failed.start('partition_initial_state');failed.fail('budget')
                artifact.write_run(private,failed.snapshot())
                target=root/'public';collection.collect(private,metadata,target)
                self.assertEqual(artifact.read(target),reports[1])
                self.assertEqual(artifact.read_run(target),failed.snapshot())


    def test_comparison_cannot_use_a_fresh_down_baseline_as_observed_traffic(self):
        values,stamps=acquisition()
        old,old_stamps=acquisition(point=95,stamp=94)
        old['data']['result'][0]['value'][1]='0'
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101,
            previous={'values':json.dumps(old).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':95,'completed_at':96})
        self.assertEqual(result['state'],'observed')
        self.assertEqual(result['comparison'],{'state':'incomplete','requests_delta':None,'errors_delta':None,'duration':[]})

    def test_visible_reset_survives_a_long_gap_but_never_produces_a_negative_delta(self):
        old,old_stamps=acquisition(point=80,stamp=79)
        values,stamps=acquisition()
        for row in old['data']['result']:
            if row['metric']['__name__'] not in ('up','caddy_http_requests_in_flight'):
                row['value'][1]=str(float(row['value'][1])*2)
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101,
            previous={'values':json.dumps(old).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':80,'completed_at':81})
        self.assertEqual(result['comparison'],{'state':'reset_observed','requests_delta':None,'errors_delta':None,'duration':[]})

    def test_visible_partial_histogram_contradiction_is_malformed_before_missing_availability(self):
        values,stamps=acquisition()
        rows=values['data']['result']
        values['data']['result']=[row for row in rows if row['metric'].get('le') in ('0.005','0.01') and row['metric'].get('code')=='200']
        values['data']['result'][0]['value'][1]='1'
        stamps['data']['result']=[row for row in stamps['data']['result'] if row['metric'].get('le') in ('0.005','0.01') and row['metric'].get('code')=='200']
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed')
        self.assertIsNone(result['observation'])
