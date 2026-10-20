"""Closed refusal wire contract, with no raw collector input or PostgreSQL."""
import unittest
import json
import io
from contextlib import redirect_stdout, redirect_stderr
from types import SimpleNamespace
from unittest.mock import patch
import s3_api_privacy_diagnostic as diagnostic


class PrivacyDiagnosticTests(unittest.TestCase):
    def event(self, **overrides):
        return {'event': 's3_api_privacy_guard', 'reason': 'private_match', 'phase': 'raw',
                'documents': 1, 'totalBytes': 40, 'nodes': 0, 'depth': 0,
                'corpusEntries': 1, **overrides}

    def wire(self, **overrides):
        return json.dumps(self.event(**overrides), separators=(',', ':')).encode()

    def test_accepts_only_closed_refusal_and_saturated_counters(self):
        self.assertEqual(diagnostic.parse(self.wire()), self.event())
        self.assertEqual(diagnostic.parse(self.wire() + b'\n'), self.event())
        maximal = self.event(documents=33, totalBytes=4_194_305, nodes=100_001, depth=33, corpusEntries=65)
        self.assertEqual(diagnostic.parse(json.dumps(maximal).encode()), maximal)
        for reason in diagnostic.REASONS:
            for phase in diagnostic.PHASES:
                self.assertEqual(diagnostic.parse(self.wire(reason=reason, phase=phase)), self.event(reason=reason, phase=phase))

    def test_accepts_closed_corpus_issue_classes_without_extra_issue_details(self):
        for reason in ('corpus_type', 'corpus_empty_string', 'corpus_string_limit', 'corpus_entry_count'):
            self.assertEqual(diagnostic.parse(self.wire(reason=reason, phase='input')),
                             self.event(reason=reason, phase='input'))
            for key in ('issue', 'path', 'index', 'input', 'message'):
                with self.assertRaises(diagnostic.InvalidDiagnostic):
                    diagnostic.parse(self.wire(reason=reason, **{key: 'private-sentinel'}))

    def test_rejects_private_unknown_duplicate_escaped_and_multiple_values(self):
        raw = self.wire()
        poison = [b'null', b'[]', b'"private-sentinel"', b'{private-sentinel',
                  raw.replace(b'40', b'1e' + b'9' * 100, 1),
                  raw + raw, raw + b'\n' + raw, raw + b'\n\n', b'\n' + raw,
                  raw + b'\r\n', b'\xff', b' ' * 513, raw + b' ' * 513,
                  raw.replace(b'"reason":', b'"reason":"private_match","reason":', 1),
                  raw.replace(b'"reason":', b'"reason":"private_match","\\u0072eason":', 1),
                  self.wire(unknown='private-sentinel'), self.wire(reason='private-sentinel'),
                  self.wire(phase='private-sentinel'), self.wire(event='private-sentinel')]
        for candidate in poison:
            with self.subTest(kind='invalid wire'):
                with self.assertRaisesRegex(diagnostic.InvalidDiagnostic, '^S3 API privacy diagnostic unavailable$') as raised:
                    diagnostic.parse(candidate)
                self.assertIsNone(raised.exception.__cause__)
                self.assertNotIn('private-sentinel', str(raised.exception))

    def test_rejects_missing_fields_and_wrong_or_unsafe_numeric_types(self):
        limits = {'documents': 33, 'totalBytes': 4_194_305, 'nodes': 100_001, 'depth': 33, 'corpusEntries': 65}
        for key, maximum in limits.items():
            for value in [True, False, -1, maximum + 1, 0.5, '0', None, {}, [], float('nan'), float('inf')]:
                with self.subTest(field=key, kind='bad count'):
                    with self.assertRaises(diagnostic.InvalidDiagnostic):
                        diagnostic.parse(self.wire(**{key: value}))
        for key in self.event():
            incomplete = self.event()
            del incomplete[key]
            with self.assertRaises(diagnostic.InvalidDiagnostic):
                diagnostic.parse(json.dumps(incomplete).encode())

    def test_rejects_duplicate_fields_even_when_aliases_are_escaped(self):
        raw = self.wire()
        for key in self.event():
            literal = ('"' + key + '":').encode()
            escaped = ('"\\u%04x%s":' % (ord(key[0]), key[1:])).encode()
            for alias in (literal, escaped):
                candidate = raw.replace(literal, literal + b'null,' + alias, 1)
                with self.assertRaises(diagnostic.InvalidDiagnostic):
                    diagnostic.parse(candidate)

    def test_cli_bounds_input_and_never_echoes_untrusted_text_or_arguments(self):
        for raw, arguments, status in [(self.wire(), ['parser'], 0),
                                       (b'private-sentinel' * 1000, ['parser'], 1),
                                       (self.wire(), ['parser', 'private-sentinel'], 1)]:
            output, error, stream = io.StringIO(), io.StringIO(), io.BytesIO(raw)
            with patch.object(diagnostic.sys, 'stdin', SimpleNamespace(buffer=stream)), \
                    patch.object(diagnostic.sys, 'argv', arguments), \
                    redirect_stdout(output), redirect_stderr(error):
                self.assertEqual(diagnostic.main(), status)
            self.assertLessEqual(stream.tell(), 513)
            self.assertNotIn('private-sentinel', output.getvalue() + error.getvalue())
            if status:
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(error.getvalue(), diagnostic.FAILURE + '\n')
            else:
                self.assertEqual(diagnostic.parse(output.getvalue().encode()), self.event())
                self.assertEqual(error.getvalue(), '')


    def test_cli_read_failure_uses_only_the_constant_message(self):
        def failed_read(_limit):
            raise OSError('private-sentinel')
        stream = SimpleNamespace(read=failed_read)
        output, error = io.StringIO(), io.StringIO()
        with patch.object(diagnostic.sys, 'stdin', SimpleNamespace(buffer=stream)), \
                patch.object(diagnostic.sys, 'argv', ['parser']), \
                redirect_stdout(output), redirect_stderr(error):
            self.assertEqual(diagnostic.main(), 1)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(error.getvalue(), diagnostic.FAILURE + '\n')


if __name__ == '__main__':
    unittest.main()
