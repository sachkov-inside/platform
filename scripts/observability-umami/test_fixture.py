"""Synthetic capture is a closed code catalog, not a pass-through tracker."""
import importlib.util
import pathlib
import unittest
import io
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fixture', pathlib.Path(__file__).with_name('fixture.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Capture(unittest.TestCase):
    def test_seed_accepts_pinned_team_creation_transaction_tuple(self):
        # ec0ff503: POST /api/teams returns createTeam's [Team, TeamUser] transaction.
        team = '00000000-0000-4000-8000-000000000001'
        user = '00000000-0000-4000-8000-000000000002'
        member = '00000000-0000-4000-8000-000000000003'
        responses = [
            {'ok': True}, {'privateMode': True, 'telemetryDisabled': True, 'updatesDisabled': True},
            {'token': 'admin-token'}, {}, {'token': 'renewed-token'}, {'id': user},
            [{'id': team, 'name': 'fixture-team'},
             {'id': member, 'teamId': team, 'userId': user, 'role': 'team-owner'}],
            {}, {'id': team}, {'token': 'reader-token'},
            {'id': member, 'key': 'umami_' + 'a' * 32}, {},
        ]
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(self, request, **kwargs):
                return Response(json.dumps(responses.pop(0)).encode())
        with patch.object(fixture.urllib.request, 'build_opener', return_value=Opener()):
            result = fixture.seed()
        self.assertEqual(result['team'], team)
        self.assertEqual(responses, [])

    def test_invalid_http_response_retains_status_without_response_body(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(self, request, **kwargs):
                raw = {'ok': True} if request.full_url.endswith('/heartbeat') else ['sentinel-private-body']
                return Response(json.dumps(raw).encode())
        with patch.object(fixture.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaises(fixture.FixtureStepFailed) as failed:
                fixture.seed()
        self.assertEqual(failed.exception.report, {'phase': 'seed', 'step': 'privacy_config',
                                                 'error': 'invalid_response', 'http_status': 200})
        self.assertNotIn('sentinel', json.dumps(failed.exception.report))

    def test_created_team_rejects_malformed_or_mismatched_owner_membership(self):
        team = {'id': '00000000-0000-4000-8000-000000000001'}
        owner = {'id': '00000000-0000-4000-8000-000000000002', 'teamId': team['id'],
                 'userId': '00000000-0000-4000-8000-000000000003', 'role': 'team-owner'}
        invalid = [team, [], [team], [team, owner, {}], [team, {}],
                   [team, {**owner, 'teamId': owner['id']}], [team, {**owner, 'userId': '../users'}],
                   [team, {**owner, 'role': 'team-view-only'}]]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                fixture.created_team(raw)

    def test_seed_still_requires_every_privacy_flag_to_be_true(self):
        config = {'privateMode': True, 'telemetryDisabled': True, 'updatesDisabled': True}
        for key in config:
            for value in (False, 'true', None):
                with self.subTest(key=key, value=value), \
                        patch.object(fixture, 'call', side_effect=[{'ok': True}, {**config, key: value}]):
                    with self.assertRaises(fixture.FixtureStepFailed) as failed:
                        fixture.seed()
                    self.assertEqual(failed.exception.report, {'phase': 'seed', 'step': 'privacy_config',
                                                             'error': 'invariant', 'http_status': None})

    def test_http_rejection_retains_only_fixed_step_and_numeric_status(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(self, request, **kwargs):
                if request.full_url.endswith('/heartbeat'):
                    return Response(b'{"ok":true}')
                raise fixture.urllib.error.HTTPError(request.full_url, 403, 'sentinel-private-message',
                                                     {}, io.BytesIO(b'sentinel-private-body'))
        with patch.object(fixture.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaises(fixture.FixtureStepFailed) as failed:
                fixture.seed()
        self.assertEqual(failed.exception.report, {'phase': 'seed', 'step': 'privacy_config',
                                                 'error': 'http_status', 'http_status': 403})
        self.assertNotIn('sentinel', str(failed.exception))

    def test_retention_query_requires_recent_data_and_denies_old_or_windowless_reads(self):
        state = {'site': '00000000-0000-4000-8000-000000000001', 'key': 'umami_' + 'a' * 32}
        calls = []
        def response(base, path, **kwargs):
            calls.append((path, kwargs.get('expected', 200)))
            if kwargs.get('expected') == 403:
                return {}
            return {'data': [{'eventName': 'ttl_recent', 'createdAt': '2026-10-19T11:59:00.000Z'}]}
        with patch.object(fixture.time, 'time', return_value=1792411200), patch.object(fixture, 'call', side_effect=response):
            result = fixture.retention_query(state)
        self.assertEqual(result, {'history_window_denied': True, 'windowless_detail_denied': True,
                                  'recent_events_visible_before_cleanup': True})
        self.assertGreaterEqual(sum(status == 403 for _, status in calls), 6)

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
