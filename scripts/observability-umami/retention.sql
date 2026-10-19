-- Umami 3.4.0, schema at ec0ff50388c264ed8ce46f00967e92f7e71476ae.
-- Run only against the dedicated analytics database as its maintenance owner.
-- One transaction, <=500 rows per table. This script does not report exhaustion;
-- the runtime drainer and its verified completion/lag query are still pending.
-- Migrations/restore are offline. Never enable reads before draining this cleanup.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT pg_advisory_xact_lock(1566, 365);
WITH expired AS (
  SELECT event_data_id FROM event_data d
  WHERE d.created_at IS NULL OR d.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
     OR NOT EXISTS (SELECT 1 FROM website_event e WHERE e.event_id=d.website_event_id
                    AND e.created_at >= CURRENT_TIMESTAMP - INTERVAL '365 days')
  ORDER BY created_at, event_data_id LIMIT 500
) DELETE FROM event_data WHERE event_data_id IN (SELECT event_data_id FROM expired);
WITH expired AS (
  SELECT revenue_id FROM revenue r
  WHERE r.created_at IS NULL OR r.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
     OR NOT EXISTS (SELECT 1 FROM website_event e WHERE e.event_id=r.event_id
                    AND e.created_at >= CURRENT_TIMESTAMP - INTERVAL '365 days')
  ORDER BY created_at, revenue_id LIMIT 500
) DELETE FROM revenue WHERE revenue_id IN (SELECT revenue_id FROM expired);
WITH expired AS (
  SELECT event_id FROM website_event e
  WHERE (e.created_at IS NULL OR e.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days')
    AND NOT EXISTS (SELECT 1 FROM event_data d WHERE d.website_event_id=e.event_id)
    AND NOT EXISTS (SELECT 1 FROM revenue r WHERE r.event_id=e.event_id)
  ORDER BY created_at, event_id LIMIT 500
) DELETE FROM website_event WHERE event_id IN (SELECT event_id FROM expired);
WITH expired AS (
  SELECT session_data_id FROM session_data d
  WHERE d.created_at IS NULL OR d.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
     OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id=d.session_id)
  ORDER BY created_at, session_data_id LIMIT 500
) DELETE FROM session_data WHERE session_data_id IN (SELECT session_data_id FROM expired);
WITH expired AS (
  SELECT website_id, distinct_id, session_id FROM session_link l
  WHERE l.created_at IS NULL OR l.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
     OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id=l.session_id)
  ORDER BY created_at, website_id, distinct_id, session_id LIMIT 500
) DELETE FROM session_link WHERE (website_id,distinct_id,session_id) IN
  (SELECT website_id,distinct_id,session_id FROM expired);
WITH expired AS (
  SELECT replay_id FROM session_replay
  WHERE ended_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
  ORDER BY ended_at, replay_id LIMIT 500
) DELETE FROM session_replay WHERE replay_id IN (SELECT replay_id FROM expired);
WITH expired AS (
  SELECT saved_replay_id FROM session_replay_saved s
  WHERE NOT EXISTS (SELECT 1 FROM session_replay r WHERE r.website_id=s.website_id AND r.visit_id=s.visit_id)
  ORDER BY created_at, saved_replay_id LIMIT 500
) DELETE FROM session_replay_saved WHERE saved_replay_id IN (SELECT saved_replay_id FROM expired);
WITH expired AS (
  SELECT heatmap_event_id FROM heatmap_event
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '365 days'
  ORDER BY created_at, heatmap_event_id LIMIT 500
) DELETE FROM heatmap_event WHERE heatmap_event_id IN (SELECT heatmap_event_id FROM expired);
WITH expired AS (
  SELECT session_id FROM session s
  WHERE (s.created_at IS NULL OR s.created_at < CURRENT_TIMESTAMP - INTERVAL '365 days')
    AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_data d WHERE d.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_link l WHERE l.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM revenue r WHERE r.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM session_replay r WHERE r.session_id=s.session_id)
    AND NOT EXISTS (SELECT 1 FROM heatmap_event h WHERE h.session_id=s.session_id)
  ORDER BY created_at, session_id LIMIT 500
) DELETE FROM session WHERE session_id IN (SELECT session_id FROM expired);
COMMIT;
