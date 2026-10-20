"""Source contracts for the separate S3 headers/full-read policy, not stored evidence."""
import json
import re
import unittest

import privacy_config


class S3PrivacyContract(unittest.TestCase):
    def test_s3_catalog_is_closed_and_does_not_extend_legacy_operation_pairs(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy['s3'], {'operations':['http.GET','http.PUT','http.DELETE','getObject.read']})
        self.assertIn('s3', policy['dependencies']['names'])
        self.assertTrue(set(policy['s3']['operations']).isdisjoint(policy['dependencies']['operations']))
        actual = privacy_config.render()
        for context, key, name in (('span','dependency.operation','dependency.name'),
                                   ('datapoint','operation','dependency')):
            section = actual.split('context = "'+context+'"',1)[1]
            statements = re.findall(r'`([^`]+)`',section.split('  }',1)[0])
            rules = [rule for rule in statements if rule.startswith('set(attributes["'+key+'"], "_OTHER")')
                     and 'not IsMatch' in rule]
            own = [rule for rule in rules if 'attributes["'+name+'"] == "s3"' in rule
                   and 'not (attributes["'+name+'"] == "s3")' not in rule]
            self.assertEqual(len(own),1)
            expression = json.loads(re.search(r'not IsMatch\(attributes\["'+key+r'"\], ("(?:\\.|[^"\\])*")\)',own[0])[1])
            for value in ('http.GET','http.PUT','http.DELETE','getObject.read'):
                self.assertIsNotNone(re.fullmatch(expression,value))
            for value in ('GET','http.POST','http.HEAD','getObject','httpXGET','query','jwks','private-bucket/key'):
                self.assertIsNone(re.fullmatch(expression,value))
            generic = [rule for rule in rules if 'not (attributes["'+name+'"] == "s3")' in rule]
            self.assertEqual(len(generic),1)

    def test_full_reads_and_unknown_s3_operations_cannot_retain_request_or_provider_fields(self):
        actual = privacy_config.render()
        span = actual.split('context = "span"',1)[1].split('metric_statements',1)[0]
        rule = next(rule for rule in re.findall(r'`([^`]+)`',span)
                    if rule.startswith('keep_keys(attributes, ["dependency.name", "dependency.operation", "dependency.outcome"])')
                    and 'attributes["dependency.name"] == "s3"' in rule)
        self.assertIn('not IsMatch(attributes["dependency.operation"], "^(http\\\\.GET|http\\\\.PUT|http\\\\.DELETE)$")',rule)
        for secret in ('bucket','key','url.full','authorization','provider.request_id','http.request.body'):
            self.assertNotIn('"'+secret+'"',rule)
        points = actual.split('context = "datapoint"',1)[1].split('log_statements',1)[0]
        self.assertIn('keep_keys(attributes, ["dependency", "operation", "outcome"])',points)


if __name__ == '__main__':
    unittest.main()
