"""The SDK caller keeps constant RuntimeError messages with closed reasons."""
import unittest
import oracle


class SdkDiagnosticReasons(unittest.TestCase):
    def test_malformed_and_valid_refused_raw_responses_are_distinct(self):
        for raw,reason in (('{','response_decode'),('[]','oracle_refusal')):
            with self.subTest(reason=reason), self.assertRaisesRegex(RuntimeError,'^SDK storage metric contract failed$') as error:
                oracle.metrics(raw,release='a'*40)
            self.assertEqual(error.exception.reason,reason)


if __name__ == '__main__': unittest.main()
