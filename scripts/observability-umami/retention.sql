-- Pinned Umami 3.4.0 ec0ff50388c264ed8ce46f00967e92f7e71476ae ONLY.
-- Render __CUTOFF__ through retention.py; never run against a product database.
-- No cursors: committed batches resume through the same eligibility predicates.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '1s';
SET LOCAL lock_timeout = '250ms';
SET LOCAL idle_in_transaction_session_timeout = '2s';
DO $$ BEGIN
  IF current_database() <> 'umami' OR current_user <> 'umami' THEN
    RAISE EXCEPTION 'dedicated Umami maintenance role/database required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1566, 365) THEN
    RAISE EXCEPTION 'another retention transaction holds ownership';
  END IF;
  PERFORM set_config('umami.retention_cutoff',
    COALESCE(NULLIF('__CUTOFF__', ''), (transaction_timestamp() - INTERVAL '365 days')::text), true);
  IF current_setting('umami.retention_cutoff')::timestamptz > transaction_timestamp() - INTERVAL '365 days' THEN
    RAISE EXCEPTION 'retention cutoff is newer than the DB horizon';
  END IF;
END $$;
SELECT json_build_object('kind', 'snapshot',
  'at', to_char(transaction_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cutoff', to_char(current_setting('umami.retention_cutoff')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cutoff_age_seconds', greatest(0, ceil(extract(epoch FROM
    transaction_timestamp() - (current_setting('umami.retention_cutoff')::timestamptz + INTERVAL '365 days')))));
WITH expired AS (
  SELECT event_data_id FROM event_data d
  WHERE d.created_at IS NULL OR d.created_at < current_setting('umami.retention_cutoff')::timestamptz
     OR NOT EXISTS (SELECT 1 FROM website_event e WHERE e.event_id=d.website_event_id AND e.website_id=d.website_id
                    AND e.created_at >= current_setting('umami.retention_cutoff')::timestamptz)
  ORDER BY created_at, event_data_id LIMIT 500
), removed AS (
  DELETE FROM event_data WHERE event_data_id IN (SELECT event_data_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'event_data', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT revenue_id FROM revenue r
  WHERE r.created_at IS NULL OR r.created_at < current_setting('umami.retention_cutoff')::timestamptz
     OR NOT EXISTS (SELECT 1 FROM website_event e WHERE e.event_id=r.event_id AND e.website_id=r.website_id
                    AND e.created_at >= current_setting('umami.retention_cutoff')::timestamptz)
  ORDER BY created_at, revenue_id LIMIT 500
), removed AS (
  DELETE FROM revenue WHERE revenue_id IN (SELECT revenue_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'revenue', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT event_id FROM website_event e
  WHERE (e.created_at IS NULL OR e.created_at < current_setting('umami.retention_cutoff')::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM event_data d WHERE d.website_event_id=e.event_id)
    AND NOT EXISTS (SELECT 1 FROM revenue r WHERE r.event_id=e.event_id)
  ORDER BY created_at, event_id LIMIT 500
), removed AS (
  DELETE FROM website_event WHERE event_id IN (SELECT event_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'website_event', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT session_data_id FROM session_data d
  WHERE d.created_at IS NULL OR d.created_at < current_setting('umami.retention_cutoff')::timestamptz
     OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id=d.session_id AND s.website_id=d.website_id)
  ORDER BY created_at, session_data_id LIMIT 500
), removed AS (
  DELETE FROM session_data WHERE session_data_id IN (SELECT session_data_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'session_data', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT website_id, distinct_id, session_id FROM session_link l
  WHERE l.created_at IS NULL OR l.created_at < current_setting('umami.retention_cutoff')::timestamptz
     OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id=l.session_id AND s.website_id=l.website_id)
  ORDER BY created_at, website_id, distinct_id, session_id LIMIT 500
), removed AS (
  DELETE FROM session_link WHERE (website_id,distinct_id,session_id) IN
  (SELECT website_id,distinct_id,session_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'session_link', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT replay_id FROM session_replay
  WHERE started_at < current_setting('umami.retention_cutoff')::timestamptz
     OR ended_at < current_setting('umami.retention_cutoff')::timestamptz
  ORDER BY ended_at, replay_id LIMIT 500
), removed AS (
  DELETE FROM session_replay WHERE replay_id IN (SELECT replay_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'session_replay', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT saved_replay_id FROM session_replay_saved s
  WHERE s.created_at IS NULL OR s.created_at < current_setting('umami.retention_cutoff')::timestamptz
     OR NOT EXISTS (SELECT 1 FROM session_replay r WHERE r.website_id=s.website_id AND r.visit_id=s.visit_id)
  ORDER BY created_at, saved_replay_id LIMIT 500
), removed AS (
  DELETE FROM session_replay_saved WHERE saved_replay_id IN (SELECT saved_replay_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'session_replay_saved', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT heatmap_event_id FROM heatmap_event
  WHERE created_at < current_setting('umami.retention_cutoff')::timestamptz
  ORDER BY created_at, heatmap_event_id LIMIT 500
), removed AS (
  DELETE FROM heatmap_event WHERE heatmap_event_id IN (SELECT heatmap_event_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'heatmap_event', 'deleted', count(*)) FROM removed;
WITH expired AS (
  SELECT session_id FROM session s
  WHERE (s.created_at IS NULL OR s.created_at < current_setting('umami.retention_cutoff')::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_data d WHERE d.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_link l WHERE l.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM revenue r WHERE r.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_replay r WHERE r.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM heatmap_event h WHERE h.session_id=s.session_id)
  ORDER BY created_at, session_id LIMIT 500
), removed AS (
  DELETE FROM session WHERE session_id IN (SELECT session_id FROM expired) RETURNING 1
) SELECT json_build_object('table', 'session', 'deleted', count(*)) FROM removed;
SELECT json_build_object('kind', 'lag', 'remaining_expired_events', count(*),
  'unknown_event_times', count(*) FILTER (WHERE created_at IS NULL),
  'event_cleanup_lag_seconds', COALESCE(greatest(0, ceil(extract(epoch FROM
    current_setting('umami.retention_cutoff')::timestamptz - min(created_at)))), 0))
FROM website_event
WHERE created_at IS NULL OR created_at < current_setting('umami.retention_cutoff')::timestamptz;
COMMIT;
