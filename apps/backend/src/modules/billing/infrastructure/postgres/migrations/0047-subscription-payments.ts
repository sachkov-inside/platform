export const name = "0047_subscription_payments";
export const statement = `
ALTER TABLE billing.payment_options ADD COLUMN mode text NOT NULL DEFAULT 'subscription' CHECK (mode = 'subscription');
ALTER TABLE billing.offers ADD COLUMN benefit_periods jsonb NOT NULL DEFAULT '[]';
ALTER TABLE billing.offers DROP CONSTRAINT offers_benefits_check;
ALTER TABLE billing.offers ADD CONSTRAINT offers_benefits_check CHECK (cardinality(benefits) BETWEEN 1 AND 100);
CREATE TABLE billing.purchases (
 id uuid PRIMARY KEY, lifecycle_active boolean NOT NULL DEFAULT true, account_id uuid NOT NULL, quote_ref uuid NOT NULL UNIQUE REFERENCES billing.price_quotes(id),
 state text NOT NULL CHECK (state IN ('prepared','sent','unknown','pending','authorized','confirmed','failed')),
 binding_ciphertext text, environment text NOT NULL, terminal_ref text NOT NULL, payment_id text, payment_url text,
 amount_kopecks bigint NOT NULL CHECK (amount_kopecks BETWEEN 1 AND 9007199254740991),
 snapshot jsonb NOT NULL, acceptance jsonb NOT NULL, contact jsonb NOT NULL,
 fiscalization text NOT NULL CHECK (fiscalization IN ('not_configured','pending','confirmed','failed')),
 confirmed_at timestamptz, period_ends_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(environment, terminal_ref, payment_id),
 CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL AND period_ends_at IS NOT NULL))
);
CREATE UNIQUE INDEX billing_one_open_purchase ON billing.purchases(account_id) WHERE lifecycle_active AND state <> 'failed';
CREATE TABLE billing.purchase_commands (
 account_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
 purchase_ref uuid NOT NULL REFERENCES billing.purchases(id), PRIMARY KEY(account_id, operation_id)
);
CREATE TABLE billing.payment_events (
 id uuid PRIMARY KEY, purchase_ref uuid NOT NULL REFERENCES billing.purchases(id), kind text NOT NULL,
 payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(purchase_ref, kind)
);
CREATE TABLE billing.fulfillment_outbox (
 event_ref uuid PRIMARY KEY, purchase_ref uuid NOT NULL REFERENCES billing.purchases(id),
 payload jsonb NOT NULL, next_attempt_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
CREATE FUNCTION billing.immutable_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payment event is immutable'; END; $$;
CREATE TRIGGER immutable_payment_event BEFORE UPDATE OR DELETE ON billing.payment_events
 FOR EACH ROW EXECUTE FUNCTION billing.immutable_payment_event();
CREATE FUNCTION billing.protect_purchase_conditions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.account_id, NEW.quote_ref, NEW.environment, NEW.terminal_ref, NEW.amount_kopecks, NEW.snapshot, NEW.acceptance, NEW.contact)
 IS DISTINCT FROM ROW(OLD.account_id, OLD.quote_ref, OLD.environment, OLD.terminal_ref, OLD.amount_kopecks, OLD.snapshot, OLD.acceptance, OLD.contact)
 THEN RAISE EXCEPTION 'Purchase conditions are immutable'; END IF;
 IF OLD.confirmed_at IS NOT NULL AND ROW(NEW.confirmed_at, NEW.period_ends_at) IS DISTINCT FROM ROW(OLD.confirmed_at, OLD.period_ends_at)
 THEN RAISE EXCEPTION 'Confirmed period is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_purchase_conditions BEFORE UPDATE ON billing.purchases
 FOR EACH ROW EXECUTE FUNCTION billing.protect_purchase_conditions();
CREATE FUNCTION billing.protect_fulfillment_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.event_ref, NEW.purchase_ref, NEW.payload) IS DISTINCT FROM ROW(OLD.event_ref, OLD.purchase_ref, OLD.payload)
 THEN RAISE EXCEPTION 'Fulfillment command is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_fulfillment_command BEFORE UPDATE ON billing.fulfillment_outbox
 FOR EACH ROW EXECUTE FUNCTION billing.protect_fulfillment_command();
`;
