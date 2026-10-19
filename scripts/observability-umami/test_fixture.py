"""Synthetic capture is a closed code catalog, not a pass-through tracker."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('fixture', pathlib.Path(__file__).with_name('fixture.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Capture(unittest.TestCase):
    def test_default_page_fields_do_not_enter_capture(self):
        raw = {'route': 'material', 'url': 'https://private.invalid/alice?email=secret#token', 'title': 'private-title', 'referrer': 'https://private.invalid/secret', 'data': {'email': 'private-email'}, 'id': 'private-account'}
        result = fixture.capture(raw, '00000000-0000-4000-8000-000000000001')
        self.assertEqual(result['payload']['url'], '/materials/fixture')
        self.assertEqual(set(result['payload']), {'website', 'hostname', 'url', 'userAgent'})

    def test_unknown_route_or_custom_event_cannot_send_free_text(self):
        for raw in [{'route': '/private/alice'}, {'route': 'material', 'event': 'private-title'}]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                fixture.capture(raw, '00000000-0000-4000-8000-000000000001')

    def test_private_runtime_state_rejects_paths_and_header_injection(self):
        state = {'site': '../users', 'reader': '00000000-0000-4000-8000-000000000001', 'team': '00000000-0000-4000-8000-000000000001', 'key_id': '00000000-0000-4000-8000-000000000001', 'key': 'umami_x', 'session': 'secret\r\nheader'}
        with self.assertRaises(ValueError):
            fixture.load_state(state)

    def test_used_response_fields_are_validated_before_header_or_path_use(self):
        for record, fields in [({'token': {}}, {'token': 'credential'}), ({'token': 'header\x00control'}, {'token': 'credential'}), ({'id': '../users'}, {'id': 'uuid'}), ({'key': 'umami_x\r\nsecret'}, {'key': 'api-key'}), ({'id': True}, {'id': 'uuid'})]:
            with self.subTest(record=record), self.assertRaises(ValueError):
                fixture.response_fields(record, fields)
