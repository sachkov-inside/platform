-- Synthetic disposable Umami-only corpus. Never run against production.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '2s';
SET LOCAL lock_timeout = '250ms';
DO $$ BEGIN
  IF current_database() <> 'umami' OR current_user <> 'umami' THEN
    RAISE EXCEPTION 'dedicated synthetic Umami database required';
  END IF;
  PERFORM set_config('umami.fixture_cutoff', (transaction_timestamp() - INTERVAL '365 days')::text, true);
END $$;
INSERT INTO session(session_id, website_id, created_at, distinct_id)
SELECT md5('ttl-session-' || label)::uuid, '__SITE__'::uuid,
  CASE label WHEN 'recent' THEN current_timestamp WHEN 'fresh-orphan' THEN current_timestamp
    WHEN 'boundary' THEN current_setting('umami.fixture_cutoff')::timestamptz
    WHEN 'null' THEN NULL ELSE current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day' END,
  CASE WHEN label='retained' THEN 'ttl-retained-identity' ELSE NULL END
FROM unnest(ARRAY['old', 'recent', 'boundary', 'retained', 'old-orphan', 'fresh-orphan', 'null']) AS label;
INSERT INTO website_event(event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
SELECT md5('ttl-expired-' || n)::uuid, '__SITE__'::uuid, md5('ttl-session-old')::uuid,
  md5('ttl-visit-old')::uuid, current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day',
  '/ttl/expired', 2, 'ttl_expired' FROM generate_series(1, 501) AS n;
INSERT INTO website_event(event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
SELECT md5('ttl-event-' || label)::uuid, '__SITE__'::uuid,
  md5('ttl-session-' || CASE WHEN label='null' THEN 'old' ELSE label END)::uuid,
  md5('ttl-visit-' || label)::uuid,
  CASE WHEN label='null' THEN NULL WHEN label='boundary' THEN current_setting('umami.fixture_cutoff')::timestamptz ELSE current_timestamp END,
  '/ttl/' || label, 2, 'ttl_' || label FROM unnest(ARRAY['null', 'recent', 'boundary', 'retained']) AS label;
-- Child insert time is recent; expired parent EVENT time must still win.
INSERT INTO event_data(event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
SELECT md5('ttl-property-' || n)::uuid, '__SITE__'::uuid, md5('ttl-expired-' || n)::uuid,
  'fixture', 'synthetic', 1, current_timestamp FROM generate_series(1, 501) AS n;
INSERT INTO revenue(revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at)
SELECT md5('ttl-revenue-' || n)::uuid, '__SITE__'::uuid, md5('ttl-session-old')::uuid,
  md5('ttl-expired-' || n)::uuid, 'ttl_expired', 'USD', 0, current_timestamp FROM generate_series(1, 501) AS n;
INSERT INTO event_data(event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
VALUES(md5('ttl-orphan-property')::uuid, '__SITE__'::uuid, md5('ttl-missing-event')::uuid,
       'fixture', 'synthetic', 1, current_timestamp);
INSERT INTO session_data(session_data_id, website_id, session_id, data_key, string_value, data_type, created_at)
SELECT md5('ttl-session-property-' || label)::uuid, '__SITE__'::uuid,
  md5('ttl-session-' || CASE WHEN label='old' THEN 'recent' ELSE 'missing' END)::uuid,
  'ttl_' || label, 'synthetic', 1,
  CASE WHEN label='old' THEN current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day' ELSE current_timestamp END
FROM unnest(ARRAY['old', 'orphan']) AS label;
INSERT INTO session_link(website_id, session_id, distinct_id, created_at)
SELECT '__SITE__'::uuid, md5('ttl-session-' || CASE WHEN label='orphan' THEN 'missing' ELSE 'recent' END)::uuid,
  'ttl_' || label, CASE WHEN label='old' THEN current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day' ELSE current_timestamp END
FROM unnest(ARRAY['old', 'orphan', 'recent']) AS label;
-- Replay/heatmap remain OFF; these rows simulate stray historical/restore remnants.
INSERT INTO session_replay(replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
VALUES(md5('ttl-replay')::uuid, '__SITE__'::uuid, md5('ttl-session-old')::uuid, md5('ttl-visit-old')::uuid,
       0, decode('00', 'hex'), 1, current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day', current_timestamp, current_timestamp);
INSERT INTO session_replay_saved(saved_replay_id, website_id, visit_id, name, created_at)
VALUES(md5('ttl-saved-replay')::uuid, '__SITE__'::uuid, md5('ttl-visit-old')::uuid, 'synthetic', current_timestamp);
INSERT INTO heatmap_event(heatmap_event_id, website_id, session_id, visit_id, url_path, event_type, created_at)
VALUES(md5('ttl-heatmap')::uuid, '__SITE__'::uuid, md5('ttl-session-old')::uuid, md5('ttl-visit-old')::uuid,
       '/ttl/expired', 1, current_setting('umami.fixture_cutoff')::timestamptz - INTERVAL '1 day');
SELECT json_build_object('cutoff', to_char(current_setting('umami.fixture_cutoff')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expired_event_rows', (SELECT count(*) FROM website_event WHERE event_name IN ('ttl_expired','ttl_null')));
COMMIT;
