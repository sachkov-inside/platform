export const name = "0064_tribute_sources";
export const statement = `
ALTER TABLE membership_entitlements.activation_rules ADD COLUMN verification_mode text NOT NULL DEFAULT 'course_membership' CHECK(verification_mode IN ('course_membership','tribute_registry'));
ALTER TABLE membership_entitlements.source_entitlements ADD COLUMN tribute_state jsonb, ADD COLUMN reconcile_at timestamptz;
CREATE INDEX tribute_source_reconcile_idx ON membership_entitlements.source_entitlements(reconcile_at,id) WHERE origin = 'tribute';
CREATE TABLE membership_entitlements.tribute_policies (
 id varchar(256) PRIMARY KEY, subscription_id integer UNIQUE NOT NULL CHECK(subscription_id > 0),
 revision integer NOT NULL CHECK(revision > 0), enabled boolean NOT NULL,
 tier_snapshot jsonb NOT NULL, temporary_until timestamptz, reason varchar(1000) NOT NULL
);
CREATE TABLE membership_entitlements.tribute_import_reviews (
 id uuid PRIMARY KEY REFERENCES membership_entitlements.access_batch_previews(id), actor_id uuid NOT NULL,
 batch_ref varchar(256) NOT NULL, pending_rows jsonb NOT NULL, state text NOT NULL CHECK(state IN ('pending','applied','dismissed')),
 revision integer NOT NULL CHECK(revision > 0), expires_at timestamptz NOT NULL, reason varchar(1000) NOT NULL
);
CREATE INDEX tribute_import_review_state_idx ON membership_entitlements.tribute_import_reviews(state,id);
CREATE TABLE membership_entitlements.tribute_inbox (
 id uuid PRIMARY KEY, event_key char(64) NOT NULL, fingerprint char(64) UNIQUE NOT NULL,
 raw_digest char(64) NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('received','applied','pending_reconciliation','rejected')),
 reason text NOT NULL, source_id uuid REFERENCES membership_entitlements.source_entitlements(id),
 received_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, revision integer NOT NULL CHECK(revision > 0)
);
CREATE INDEX tribute_inbox_event_key_idx ON membership_entitlements.tribute_inbox(event_key);
CREATE INDEX tribute_inbox_state_received_at_idx ON membership_entitlements.tribute_inbox(state,received_at);
CREATE UNIQUE INDEX tribute_source_external_identity ON membership_entitlements.source_entitlements
 ((tribute_state->>'subscriptionId'), (tribute_state->>'telegramUserId')) WHERE tribute_state IS NOT NULL;
`;
