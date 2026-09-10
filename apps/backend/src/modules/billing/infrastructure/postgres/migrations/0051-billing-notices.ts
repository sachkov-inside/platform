export const name = "0051_billing_notices";
export const statement = `
CREATE TABLE billing.notices (
 id uuid PRIMARY KEY, account_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('renewal_reminder','payment_succeeded','payment_failed','renewal_cancelled','access_expired','refund_resolved')),
 source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 128),
 subscription_ref uuid REFERENCES billing.subscriptions(id), attempt_ref uuid REFERENCES billing.purchases(id),
 revision int NOT NULL CHECK (revision >= 1), state text NOT NULL CHECK (state IN ('current','superseded')),
 occurred_at timestamptz NOT NULL, not_after timestamptz NOT NULL,
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 1500),
 amount_kopecks bigint CHECK (amount_kopecks BETWEEN 1 AND 9007199254740991), due_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE (kind, source_ref), CHECK (occurred_at < not_after)
);
CREATE INDEX billing_notices_by_account ON billing.notices(account_id, occurred_at DESC, id);
CREATE INDEX billing_notices_by_subscription ON billing.notices(subscription_ref, kind, state);
CREATE TABLE billing.notice_revisions (
 notice_ref uuid NOT NULL REFERENCES billing.notices(id), revision int NOT NULL CHECK (revision >= 1),
 message_id uuid NOT NULL UNIQUE, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY (notice_ref, revision)
);
CREATE FUNCTION billing.immutable_notice_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Notice revision is immutable'; END; $$;
CREATE TRIGGER immutable_notice_revision BEFORE UPDATE OR DELETE ON billing.notice_revisions
 FOR EACH ROW EXECUTE FUNCTION billing.immutable_notice_revision();
CREATE FUNCTION billing.protect_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.account_id, NEW.kind, NEW.source_ref, NEW.subscription_ref, NEW.attempt_ref, NEW.occurred_at)
 IS DISTINCT FROM ROW(OLD.account_id, OLD.kind, OLD.source_ref, OLD.subscription_ref, OLD.attempt_ref, OLD.occurred_at)
 THEN RAISE EXCEPTION 'Notice occurrence is immutable'; END IF;
 IF NEW.revision < OLD.revision THEN RAISE EXCEPTION 'Notice revision cannot go backwards'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_notice BEFORE UPDATE ON billing.notices
 FOR EACH ROW EXECUTE FUNCTION billing.protect_notice();
`;
