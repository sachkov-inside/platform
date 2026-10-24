"""Closed diagnostic evidence distinguishes query differences from progress, never SDK absence."""
import copy
import math
import unittest
import sdk_diagnostics


def probe(**values):
    return {'schema':1,'queries':{name:{'state':'known','value':values.get(name)} for name in
        ('current','normalized','dotted','dotted_service','receiver','exporter')}}


class Diagnostics(unittest.TestCase):
    def test_probe_parser_confines_unknown_malformed_nonfinite_and_private_values(self):
        value=probe(receiver=0,exporter=2,dotted=123)
        result=sdk_diagnostics.parse_probe(value,now=200)
        self.assertEqual(result['state'],'valid')
        self.assertEqual(result['queries']['receiver'],{'state':'known','value':0})
        self.assertEqual(result['queries']['normalized'],{'state':'known','value':None})
        invalid=[None,{}, {**value,'private':'must-not-escape'}]
        for row in ({'state':'known','value':math.nan},{'state':'known','value':math.inf},
                    {'state':'known','value':True},{'state':'known','value':10**400},{'state':'unknown','value':1},
                    {'state':'known','value':201+2},{'state':'known','value':1,'token':'must-not-escape'}):
            item=copy.deepcopy(value);item['queries']['dotted']=row;invalid.append(item)
        for counter in (-1,.5,2**53):
            item=copy.deepcopy(value);item['queries']['receiver']['value']=counter;invalid.append(item)
        for item in invalid:
            checked=sdk_diagnostics.parse_probe(item,now=200)
            self.assertEqual(checked['state'],'invalid_response')
            self.assertTrue(all(row=={'state':'unknown','value':None} for row in checked['queries'].values()))
            self.assertNotIn('must-not-escape',str(checked))

    def test_facts_expose_selector_forms_late_visibility_and_counter_progress_without_verdict(self):
        before=sdk_diagnostics.parse_probe(probe(receiver=10,exporter=5),now=200)
        after=sdk_diagnostics.parse_probe(probe(dotted=123,dotted_service=123,receiver=15,exporter=8),now=200)
        facts=sdk_diagnostics.facts(before,after,{'state':'known','latest_seconds':None},started=100)
        self.assertEqual(facts['fresh'],{'current':False,'normalized':False,'dotted':True,'dotted_service':True})
        self.assertEqual(facts['counters']['receiver'],{'state':'nondecreasing','delta':5,'progress_observed':True})
        self.assertEqual(facts['counters']['exporter'],{'state':'nondecreasing','delta':3,'progress_observed':True})
        self.assertFalse(facts['current_fresh_after_original_missing_or_stale'])
        late=sdk_diagnostics.parse_probe(probe(current=125,normalized=125,receiver=10,exporter=5),now=200)
        changed=sdk_diagnostics.facts(before,late,{'state':'known','latest_seconds':None},started=100)
        self.assertTrue(changed['current_fresh_after_original_missing_or_stale'])
        self.assertFalse(changed['counters']['receiver']['progress_observed'])
        self.assertEqual(changed['counters']['receiver']['delta'],0)
        self.assertEqual(changed['interpretation'],'observations_only')
        self.assertNotIn('sdk_absent',str(changed))

    def test_counter_reset_missing_or_invalid_observation_never_becomes_zero_or_lag_proof(self):
        before=sdk_diagnostics.parse_probe(probe(receiver=10,exporter=None),now=200)
        after=sdk_diagnostics.parse_probe(probe(current=123,receiver=9,exporter=3),now=200)
        facts=sdk_diagnostics.facts(before,after,{'state':'unknown','latest_seconds':None},started=100)
        self.assertEqual(facts['counters']['receiver'],{'state':'reset','delta':None,'progress_observed':None})
        self.assertEqual(facts['counters']['exporter'],{'state':'unknown','delta':None,'progress_observed':None})
        self.assertIsNone(facts['current_fresh_after_original_missing_or_stale'])
        unknown=sdk_diagnostics.parse_probe(None,now=200)
        facts=sdk_diagnostics.facts(before,unknown,{'state':'known','latest_seconds':math.nan},started=100)
        self.assertTrue(all(value is None for value in facts['fresh'].values()))
        self.assertIsNone(facts['counters']['receiver']['delta'])
        self.assertIsNone(facts['current_fresh_after_original_missing_or_stale'])

    def test_latency_pair_attributes_only_fresh_finite_points_to_the_current_phase(self):
        def value(default, immediate):
            return {'schema':1,'attempts':[{'evaluated_seconds':120,'default':{'state':'known','value':default},'immediate':{'state':'known','value':immediate}}]}
        hidden=sdk_diagnostics.parse_latency(value(None,115),now=121,started=100)
        self.assertEqual(hidden['state'],'valid')
        self.assertEqual(hidden['attempts'][0]['fresh'],{'default':False,'immediate':True})
        self.assertTrue(hidden['attempts'][0]['immediate_fresh_default_missing_or_stale'])
        stale=sdk_diagnostics.parse_latency(value(90,90),now=121,started=100)
        self.assertEqual(stale['attempts'][0]['fresh'],{'default':False,'immediate':False})
        self.assertFalse(stale['attempts'][0]['immediate_fresh_default_missing_or_stale'])
        absent=sdk_diagnostics.parse_latency(value(None,None),now=121,started=100)
        self.assertEqual(absent['attempts'][0]['fresh'],{'default':False,'immediate':False})
        unknown=value(None,None);unknown['attempts'][0]['immediate']['state']='unknown'
        parsed=sdk_diagnostics.parse_latency(unknown,now=121,started=100)
        self.assertIsNone(parsed['attempts'][0]['immediate_fresh_default_missing_or_stale'])
        for bad in (None,{},value(None,math.nan),value(None,True),value(None,123),{**value(None,115),'private':'secret'}):
            result=sdk_diagnostics.parse_latency(bad,now=121,started=100)
            self.assertEqual(result,{'state':'invalid_response','attempts':[]})
        self.assertEqual(sdk_diagnostics.parse_latency(value(None,115),now=121,started=130),{'state':'invalid_response','attempts':[]})
