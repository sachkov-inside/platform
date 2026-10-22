"""Invalid present Caddy evidence is refused before public destination acquisition."""
import json
from pathlib import Path
import tempfile
import unittest
import artifact
import caddy_status
import evidence
import collection
from test_observation import acquisition


class CuratedCollection(unittest.TestCase):
    def test_failed_admission_without_an_acquired_project_keeps_only_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();metadata=root/'metadata';metadata.mkdir(mode=0o700)
            (metadata/'admission.json').write_text('{"ready":false}')
            collection.collect(root/'never-acquired',metadata,root/'public')
            self.assertEqual(sorted(path.name for path in (root/'public').iterdir()),['admission.json'])

    def test_complete_evidence_is_reserialized_and_invalid_present_never_acquires_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700)
            metadata=root/'metadata';metadata.mkdir(mode=0o700)
            values,stamps=acquisition()
            good=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
            good['transport']={'canonical':'passed','mcp':'passed'}
            artifact.write(output,good)
            destination=root/'public'
            with self.assertRaises(ValueError):collection.collect(output,metadata,destination)
            self.assertFalse(destination.exists())
            run=evidence.Run()
            for case in evidence.CASES:run.pass_case(case)
            run.finish();artifact.write_run(output,run.snapshot())
            (output/'private-secret').write_text('private-caddy-sentinel')
            collection.collect(output,metadata,destination)
            self.assertEqual(sorted(path.name for path in destination.iterdir()),['caddy-observation.json','caddy-run.json'])
            self.assertEqual(artifact.read(destination),good)
            (output/'caddy-run.json').write_text(json.dumps({**run.snapshot(),'private':'private-caddy-sentinel'}))
            with self.assertRaises(ValueError):collection.collect(output,metadata,root/'refused')
            self.assertFalse((root/'refused').exists())

            # A failed initial partition may retain only its already acquired closed nonobserved status.
            values['data']['result'][0]['value'][1]='0'
            down=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
            down['transport']['canonical']='passed'
            artifact.write(output,down);artifact.write_run(output,run.snapshot())
            with self.assertRaises(ValueError):collection.collect(output,metadata,root/'false-positive')
            self.assertFalse((root/'false-positive').exists())
            failed=evidence.Run();failed.start('partition_initial_state');failed.fail('budget')
            artifact.write_run(output,failed.snapshot())
            collection.collect(output,metadata,root/'failed-public')
            self.assertEqual(artifact.read(root/'failed-public'),down)
            self.assertEqual(artifact.read_run(root/'failed-public'),failed.snapshot())
            self.assertEqual(down['transport'],{'canonical':'passed','mcp':'unrun'})
            self.assertIsNone(down['observation']);self.assertIsNone(down['comparison'])
            for name,poison in (('private-field',{**down,'private':'private-caddy-sentinel'}),
                    ('unproven-observed',{**good,'transport':{'canonical':'passed','mcp':'unrun'}})):
                (output/artifact.NAME).write_text(json.dumps(poison))
                with self.assertRaises(ValueError):collection.collect(output,metadata,root/name)
                self.assertFalse((root/name).exists())

            # Closed native detail survives the same source-bound reader and collector.
            stale=caddy_status.record('stale',age=11.5)
            stale['transport']['canonical']='passed'
            for token in ('over_at_evaluation','crossed_by_completion'):
                detailed={**stale,'up_age_window':token}
                artifact.write(output,detailed)
                artifact.write_run(output,failed.snapshot())
                target=root/token
                collection.collect(output,metadata,target)
                self.assertEqual(artifact.read(target),detailed)
                self.assertEqual(artifact.read_run(target),failed.snapshot())
            artifact.write(output,stale)
            self.assertEqual(artifact.read(output),stale)
            class ForeignText(str):pass
            class Hostile:
                def __getattribute__(self,_):raise AssertionError('private-getter')
                def __str__(self):raise AssertionError('private-detail-coercion')
                def __eq__(self,_):raise AssertionError('private-detail-comparison')
            for token in ('private-caddy-sentinel',True,None,{},[],ForeignText('over_at_evaluation'),Hostile()):
                with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                    artifact.validate({**stale,'up_age_window':token})
            detailed={**stale,'up_age_window':'over_at_evaluation'}
            poisons=[{**detailed,'state':'down'},{**detailed,'reason':'partial'},
                {**detailed,'sample_age_seconds':9.999999999999998},{**detailed,'sample_age_seconds':None},
                {**detailed,'transport':{'canonical':'failed','mcp':'unrun'}},
                {**detailed,'transport':{'canonical':'passed','mcp':'passed'}},
                {**detailed,'observation':{}},{**detailed,'private':'private-caddy-sentinel'},
                {**detailed,'up_age_window':'private-caddy-sentinel'}]
            raw_poisons=[json.dumps(value) for value in poisons]
            raw_poisons.extend((json.dumps(detailed)[:-1]+',"up_age_window":"crossed_by_completion"}',
                                json.dumps(detailed).replace('11.5','NaN')))
            for index,poison in enumerate(raw_poisons):
                (output/artifact.NAME).write_text(poison)
                target=root/('age-window-refused-'+str(index))
                with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                    collection.collect(output,metadata,target)
                self.assertFalse(target.exists())

            # The persisted boundary is tested using actual source/query reports.
            from decimal import Decimal
            from unittest.mock import patch
            import caddy_query
            from test_query import Response
            for source_stamp,final,token in (
                    ('89.9999999999999999',100,'over_at_evaluation'),
                    ('90',Decimal('100.0000000000000001'),'crossed_by_completion')):
                values,stamps=acquisition(stamp=source_stamp)
                bodies=[json.dumps(value).encode() for value in (values,stamps)]
                readings=[]
                def wall():
                    value=(100,final)[len(readings)];readings.append(value);return value
                with patch('urllib.request.OpenerDirector.open',side_effect=[Response(body) for body in bodies]) as opened:
                    rounded,packet=caddy_query.read_snapshot('owned_token',evaluated_at=100,wall_clock=wall,diagnose=True)
                self.assertEqual(opened.call_count,2)
                self.assertEqual(readings,[100,final])
                self.assertEqual(packet,{'values':bodies[0],'timestamps':bodies[1],'evaluated_at':100,'completed_at':final})
                self.assertEqual((rounded['state'],rounded['reason'],rounded['sample_age_seconds']),('stale','none',10.0))
                self.assertEqual(rounded['up_age_window'],token)
                artifact.write(output,rounded)
                self.assertEqual(artifact.read(output),rounded)
                artifact.write_run(output,failed.snapshot())
                target=root/('rounded-'+token)
                collection.collect(output,metadata,target)
                self.assertEqual(artifact.read(target),rounded)
                self.assertEqual(artifact.read_run(target),failed.snapshot())
                for age in (10,10.0,Decimal('10.0')):
                    self.assertEqual(artifact.validate({**rounded,'sample_age_seconds':age}),rounded)
                for age in (9.999999999999998,Decimal('9.9999999999999999')):
                    with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                        artifact.validate({**rounded,'sample_age_seconds':age})
                for index,literal in enumerate(('9.999999999999998','9.9999999999999999')):
                    poisoned=json.dumps(rounded).replace('"sample_age_seconds": 10.0','"sample_age_seconds": '+literal)
                    (output/artifact.NAME).write_text(poisoned)
                    target=root/('rounded-refused-'+token+str(index))
                    with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):
                        collection.collect(output,metadata,target)
                    self.assertFalse(target.exists())
