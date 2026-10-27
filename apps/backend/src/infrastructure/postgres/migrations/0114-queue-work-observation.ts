export const name = "0114_queue_work_observation";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
CREATE SCHEMA queue_observation;
CREATE TABLE queue_observation.last_successful_handler (
  queue_name text PRIMARY KEY CONSTRAINT queue_work_name CHECK (queue_name IN (
    'membership-activity.retention','web-telemetry.retention','billing.payment-recovery',
    'billing.subscription-renewal','billing.subscription-notices','tribute.source-reconciliation',
    'community.entitlement-delivery','material-assets.cleanup','profile-avatars.cleanup','videos.deletions'
  )),
  worker_name text NOT NULL,
  recorded_at timestamptz NOT NULL CHECK (recorded_at > '1970-01-01T00:00:00Z'),
  release varchar(18) NOT NULL CHECK (release IN ('development','test') OR CASE
    WHEN release ~ '^v[1-9][0-9]{0,15}$' THEN substring(release FROM 2)::numeric <= 9007199254740991 ELSE false END),
  source_sha varchar(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  attempt_key varchar(64) NOT NULL CHECK (attempt_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT queue_work_owner CHECK ((queue_name IN ('membership-activity.retention','web-telemetry.retention','billing.payment-recovery',
      'billing.subscription-renewal','billing.subscription-notices','tribute.source-reconciliation',
      'community.entitlement-delivery') AND worker_name='billing-worker')
    OR (queue_name='material-assets.cleanup' AND worker_name='material-assets-worker')
    OR (queue_name='profile-avatars.cleanup' AND worker_name='profile-avatars-worker')
    OR (queue_name='videos.deletions' AND worker_name='video-deletions-worker')),
  CHECK (release NOT IN ('development','test') OR source_sha=repeat('0',40))
);
`;
