"""Closed exporter failures are observations, never replacements for SDK acceptance."""
import json
from pathlib import Path
import tempfile
import unittest
import emitter_phase as phase

SOURCE = 'a'*40


def record():
    return dict(schema=1,scope='sdk',source=SOURCE,state='failed',phase='provider_acquisition',reason='operation_failed',
                diagnostics=dict(available=True,saturated=False,droppedSpans=1000000,failedTraceExports=1000000,failedMetricExports=1000000),
                exportFailures=dict(available=True,traces=dict(kind='network',code='EHOSTUNREACH',elapsedMs=600000),
                                    metrics=dict(kind='network',code='ECONNREFUSED',elapsedMs=600000)))


class ExportFailureTest(unittest.TestCase):
    def test_complete_maximum_record_roundtrips_under_original_byte_cap(self):
        value=record()
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME
            phase.write(path,value,source=SOURCE)
            self.assertEqual(len(path.read_bytes()),463)
            self.assertLessEqual(len(path.read_bytes()),512)
            self.assertEqual(phase.load_for_collection(output,source=SOURCE),{**value,'transport':{'available':False}})

    def test_missing_or_invalid_observation_is_unavailable_never_success(self):
        value=record();value.pop('exportFailures')
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME
            phase.write(path,value,source=SOURCE)
            self.assertEqual(phase.load_for_collection(output,source=SOURCE)['exportFailures'],{'available':False})
        rows=[{'kind':'http','code':400,'elapsedMs':None},{'kind':'network','code':'ECONNRESET','elapsedMs':0},
              {'kind':'timeout','elapsedMs':1000},{'kind':'queue','elapsedMs':0},{'kind':'unknown','elapsedMs':None}]
        for row in rows:
            value=record();value['exportFailures']['traces']=row
            self.assertEqual(phase.validate(value,source=SOURCE)['exportFailures']['traces'],row)
        invalid=[{'kind':'http','code':'400','elapsedMs':0},{'kind':'http','code':True,'elapsedMs':0},
                 {'kind':'network','code':'private','elapsedMs':0},{'kind':'timeout','elapsedMs':-1},
                 {'kind':'unknown','elapsedMs':600001},{'kind':'unknown','elapsedMs':1.5},
                 {'kind':'unknown','elapsedMs':None,'private':'sentinel'}, {'kind':'success','elapsedMs':0}]
        for row in invalid:
            value=record();value['exportFailures']['traces']=row
            projected=phase.validate(value,source=SOURCE)
            self.assertEqual(projected['exportFailures'],{'available':False})
            self.assertEqual(projected['state'],'failed')
            self.assertNotIn('sentinel',json.dumps(projected))
        value=record();value['exportFailures']={'available':True,'traces':None,'metrics':None}
        self.assertEqual(phase.validate(value,source=SOURCE)['exportFailures'],value['exportFailures'])


class TransportMilestonesTest(unittest.TestCase):
    def test_bounded_milestones_survive_collection_with_missing_legacy_unknown(self):
        value=record()
        value['transport']={'available':True,'sdkFlushMs':600000,
            **{signal:dict(createdMs=600000,submittedMs=600000,bodyFinishedMs=600000,
                          headersMs=600000,endMs=600000,failureMs=600000)
               for signal in ('traces','metrics')}}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/phase.NAME
            phase.write(path,value,source=SOURCE)
            self.assertLessEqual(len(path.read_bytes()),1024)
            self.assertEqual(phase.load_for_collection(output,source=SOURCE),value)
        value.pop('transport')
        self.assertEqual(phase.validate(value,source=SOURCE).get('transport'),None)
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();phase.write(output/phase.NAME,value,source=SOURCE)
            self.assertEqual(phase.load_for_collection(output,source=SOURCE)['transport'],{'available':False})

    def test_transport_private_malformed_or_nonmonotonic_metadata_stays_unavailable(self):
        valid={'available':True,'sdkFlushMs':None,**{signal:dict.fromkeys(phase._TRANSPORT_TIMES)
                                                for signal in ('metrics','traces')}}
        for invalid in [None,{},True,{'available':False}, {**valid,'private':'sentinel'},
                        {**valid,'sdkFlushMs':True},{**valid,'sdkFlushMs':600001},
                        {**valid,'metrics':{**valid['metrics'],'private':'sentinel'}},
                        {**valid,'metrics':{**valid['metrics'],'createdMs':2,'submittedMs':1}},
                        {**valid,'metrics':{**valid['metrics'],'failureMs':float('nan')}}]:
            value=record();value['transport']=invalid
            projected=phase.validate(value,source=SOURCE)
            self.assertEqual(projected['transport'],{'available':False})
            self.assertEqual(projected['state'],'failed')
            self.assertNotIn('sentinel',json.dumps(projected))
