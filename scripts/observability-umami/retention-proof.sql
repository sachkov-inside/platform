BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '1s';
SET LOCAL lock_timeout = '250ms';
SET LOCAL idle_in_transaction_session_timeout = '2s';
-- Closed numeric/boolean proof over this pilot's synthetic fixture identifiers only.
SELECT json_build_object(
  'expired_event_rows', (SELECT count(*) FROM website_event WHERE event_name IN ('ttl_expired', 'ttl_null')),
  'boundary_event_rows', (SELECT count(*) FROM website_event WHERE event_name='ttl_boundary'),
  'recent_event_rows', (SELECT count(*) FROM website_event WHERE event_name='ttl_recent'),
  'retained_old_session_rows', (SELECT count(*) FROM session WHERE session_id=md5('ttl-session-retained')::uuid),
  'old_or_null_session_rows', (SELECT count(*) FROM session WHERE session_id IN
    (md5('ttl-session-old')::uuid, md5('ttl-session-old-orphan')::uuid, md5('ttl-session-null')::uuid)),
  'fresh_orphan_session_rows', (SELECT count(*) FROM session WHERE session_id=md5('ttl-session-fresh-orphan')::uuid),
  'expired_property_rows', (SELECT count(*) FROM event_data WHERE data_key='fixture'),
  'expired_revenue_rows', (SELECT count(*) FROM revenue WHERE event_name='ttl_expired'),
  'expired_session_property_rows', (SELECT count(*) FROM session_data WHERE data_key IN ('ttl_old', 'ttl_orphan')),
  'expired_identifier_rows', (SELECT count(*) FROM session_link WHERE distinct_id IN ('ttl_old', 'ttl_orphan')),
  'recent_identifier_rows', (SELECT count(*) FROM session_link WHERE distinct_id='ttl_recent'),
  'expired_replay_rows', (SELECT count(*) FROM session_replay WHERE replay_id=md5('ttl-replay')::uuid),
  'orphan_saved_replay_rows', (SELECT count(*) FROM session_replay_saved WHERE saved_replay_id=md5('ttl-saved-replay')::uuid),
  'expired_heatmap_rows', (SELECT count(*) FROM heatmap_event WHERE heatmap_event_id=md5('ttl-heatmap')::uuid));
COMMIT;
