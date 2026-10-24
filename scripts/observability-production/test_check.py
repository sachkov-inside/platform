"""The HTTP observation must prove the expected value in its captured response."""
import json
import unittest

import check


class QueryReadiness(unittest.TestCase):
    def test_requires_successful_expected_query_body_in_the_same_capture(self):
        scalar = {'status': 'success', 'data': {'resultType': 'scalar', 'result': [1_000, '1']}}
        vector = {'status': 'success', 'data': {'resultType': 'vector', 'result': [{'metric': {}, 'value': [1_000, '1']}]}}
        self.assertTrue(check.query_one((200, json.dumps(scalar))))
        self.assertTrue(check.query_one((200, json.dumps(vector))))
        for response in ((503, json.dumps(scalar)), (200, 'not-json'),
                         (200, '{"status":"error"}'),
                         (200, '{"status":"success","data":{"resultType":"scalar","result":[1000,"2"]}}'),
                         (200, '{"status":"success","data":{"resultType":"vector","result":[]}}')):
            with self.subTest(response=response):
                self.assertFalse(check.query_one(response))


if __name__ == '__main__':
    unittest.main()
