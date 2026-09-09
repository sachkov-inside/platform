export const name = "0048_subscription_lifecycle";
export const statement = `
CREATE TABLE billing.subscriptions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL,
 state text NOT NULL CHECK (state IN ('active','canceled','ended')),
 snapshot jsonb NOT NULL, consent jsonb NOT NULL,
 anchor_at timestamptz NOT NULL, anchor_months int NOT NULL CHECK (anchor_months BETWEEN 1 AND 1200),
 period_index int NOT NULL CHECK (period_index >= 1),
 period_starts_at timestamptz NOT NULL, paid_until timestamptz NOT NULL,
 period_amount_kopecks bigint NOT NULL CHECK (period_amount_kopecks BETWEEN 1 AND 9007199254740991),
 binding_ref uuid, binding_ciphertext text, binding_revoked_at timestamptz,
 pending_change jsonb NOT NULL DEFAULT '{}'::jsonb, revision int NOT NULL CHECK (revision >= 1),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 CHECK ((binding_ref IS NULL) = (binding_ciphertext IS NULL)),
 CHECK (period_starts_at < paid_until)
);
CREATE UNIQUE INDEX billing_one_open_subscription ON billing.subscriptions(account_id) WHERE state <> 'ended';
CREATE INDEX billing_due_subscriptions ON billing.subscriptions(paid_until) WHERE state = 'active';
ALTER TABLE billing.purchases ALTER COLUMN quote_ref DROP NOT NULL;
ALTER TABLE billing.purchases ADD COLUMN subscription_ref uuid REFERENCES billing.subscriptions(id);
ALTER TABLE billing.purchases ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','renewal','upgrade'));
ALTER TABLE billing.purchases ADD COLUMN period_index int;
ALTER TABLE billing.purchases ADD COLUMN charge_called boolean NOT NULL DEFAULT false;
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_initial_quote CHECK ((kind = 'initial') = (quote_ref IS NOT NULL));
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_scheduled_attempt CHECK (kind = 'initial' OR (subscription_ref IS NOT NULL AND period_index IS NOT NULL));
DROP INDEX billing.billing_one_open_purchase;
CREATE UNIQUE INDEX billing_one_open_purchase ON billing.purchases(account_id) WHERE kind = 'initial' AND lifecycle_active AND state <> 'failed';
CREATE UNIQUE INDEX billing_one_renewal_per_period ON billing.purchases(subscription_ref, period_index) WHERE kind = 'renewal' AND state <> 'failed';
CREATE UNIQUE INDEX billing_one_inflight_attempt ON billing.purchases(subscription_ref)
 WHERE subscription_ref IS NOT NULL AND state IN ('prepared','sent','unknown','pending','authorized');
CREATE TABLE billing.subscription_events (
 id uuid PRIMARY KEY, subscription_ref uuid NOT NULL REFERENCES billing.subscriptions(id),
 kind text NOT NULL, payload jsonb NOT NULL, revision int NOT NULL,
 occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(subscription_ref, revision)
);
CREATE TABLE billing.subscription_commands (
 account_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id, operation_id)
);
CREATE TABLE billing.change_quotes (
 id uuid PRIMARY KEY, subscription_ref uuid NOT NULL REFERENCES billing.subscriptions(id),
 account_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
 base_revision int NOT NULL, plan jsonb NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 UNIQUE(account_id, operation_id)
);
CREATE TABLE billing.payment_method_flows (
 id uuid PRIMARY KEY, subscription_ref uuid NOT NULL REFERENCES billing.subscriptions(id),
 account_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
 environment text NOT NULL, terminal_ref text NOT NULL, request_key text NOT NULL,
 state text NOT NULL CHECK (state IN ('started','completed','rejected')),
 form_url text, observed text, applied_binding_ref uuid,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(account_id, operation_id), UNIQUE(environment, terminal_ref, request_key)
);
CREATE UNIQUE INDEX billing_one_open_method_flow ON billing.payment_method_flows(subscription_ref) WHERE state = 'started';
CREATE TRIGGER immutable_subscription_event BEFORE UPDATE OR DELETE ON billing.subscription_events
 FOR EACH ROW EXECUTE FUNCTION billing.immutable_payment_event();
CREATE FUNCTION billing.protect_subscription_conditions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.account_id, NEW.anchor_at) IS DISTINCT FROM ROW(OLD.account_id, OLD.anchor_at)
 THEN RAISE EXCEPTION 'Subscription anchor is immutable'; END IF;
 IF NEW.revision <= OLD.revision THEN RAISE EXCEPTION 'Subscription revision must advance'; END IF;
 IF OLD.state = 'ended' THEN RAISE EXCEPTION 'Completed subscription is immutable'; END IF;
 IF NEW.anchor_months < OLD.anchor_months OR NEW.period_index < OLD.period_index OR NEW.paid_until < OLD.paid_until
 THEN RAISE EXCEPTION 'Paid subscription term cannot shrink'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_subscription_conditions BEFORE UPDATE ON billing.subscriptions
 FOR EACH ROW EXECUTE FUNCTION billing.protect_subscription_conditions();
`;
