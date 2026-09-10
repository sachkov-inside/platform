export const name = "0053_billing_operations";
export const statement = `
CREATE TABLE billing.owner_commands (
 sequence bigserial NOT NULL,
 actor_id uuid NOT NULL, operation_id uuid NOT NULL, operation text NOT NULL,
 fingerprint text NOT NULL, target_ref text NOT NULL, reason varchar(1000) NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(actor_id, operation_id)
);
CREATE INDEX billing_owner_commands_target ON billing.owner_commands(target_ref, sequence);
CREATE TRIGGER immutable_owner_command BEFORE UPDATE OR DELETE ON billing.owner_commands
 FOR EACH ROW EXECUTE FUNCTION billing.immutable_payment_event();
CREATE TABLE billing.refund_decisions (
 id uuid PRIMARY KEY, purchase_ref uuid NOT NULL REFERENCES billing.purchases(id),
 account_id uuid NOT NULL, actor_id uuid NOT NULL, operation_id uuid NOT NULL,
 amount_kopecks bigint NOT NULL CHECK (amount_kopecks BETWEEN 1 AND 9007199254740991),
 access text NOT NULL CHECK (access IN ('keep','revoke')),
 recurring text NOT NULL CHECK (recurring IN ('keep','cancel')),
 reason varchar(1000) NOT NULL,
 state text NOT NULL CHECK (state IN ('decided','executing','executed','failed')),
 revision int NOT NULL CHECK (revision >= 1),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX billing_one_decision_per_command ON billing.refund_decisions(actor_id, operation_id);
CREATE INDEX billing_refund_decisions_purchase ON billing.refund_decisions(purchase_ref, created_at);
CREATE TABLE billing.refunds (
 id uuid PRIMARY KEY, decision_ref uuid NOT NULL UNIQUE REFERENCES billing.refund_decisions(id),
 purchase_ref uuid NOT NULL REFERENCES billing.purchases(id),
 environment text NOT NULL, terminal_ref text NOT NULL, payment_id text NOT NULL,
 amount_kopecks bigint NOT NULL CHECK (amount_kopecks BETWEEN 1 AND 9007199254740991),
 state text NOT NULL CHECK (state IN ('sent','unknown','confirmed','failed')),
 observed_status text, error_code text,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX billing_refunds_purchase ON billing.refunds(purchase_ref, created_at);
CREATE UNIQUE INDEX billing_one_inflight_refund ON billing.refunds(purchase_ref) WHERE state IN ('sent','unknown');
CREATE FUNCTION billing.protect_refund_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id, NEW.decision_ref, NEW.purchase_ref, NEW.payment_id, NEW.amount_kopecks, NEW.environment, NEW.terminal_ref)
  IS DISTINCT FROM ROW(OLD.id, OLD.decision_ref, OLD.purchase_ref, OLD.payment_id, OLD.amount_kopecks, OLD.environment, OLD.terminal_ref)
 THEN RAISE EXCEPTION 'Refund attempt identity and amount are immutable'; END IF;
 IF OLD.state IN ('confirmed','failed') AND NEW.state <> OLD.state
 THEN RAISE EXCEPTION 'Terminal refund result is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_refund_amount BEFORE UPDATE ON billing.refunds
 FOR EACH ROW EXECUTE FUNCTION billing.protect_refund_amount();
`;
