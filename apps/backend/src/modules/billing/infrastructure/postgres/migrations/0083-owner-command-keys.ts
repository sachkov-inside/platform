export const name = "0083_owner_command_keys";
export const statement = `
CREATE TABLE billing.owner_command_keys (
 actor_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
 result jsonb, refund_ref uuid REFERENCES billing.refunds(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(actor_id, operation_id)
);
INSERT INTO billing.owner_command_keys(actor_id, operation_id, fingerprint, result, created_at)
 SELECT actor_id, operation_id, fingerprint, result, created_at FROM billing.owner_commands;
CREATE FUNCTION billing.protect_owner_command_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Owner command key is immutable'; END IF;
 IF ROW(NEW.actor_id, NEW.operation_id, NEW.fingerprint, NEW.created_at)
  IS DISTINCT FROM ROW(OLD.actor_id, OLD.operation_id, OLD.fingerprint, OLD.created_at)
  OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result)
  OR (OLD.refund_ref IS NOT NULL AND NEW.refund_ref IS DISTINCT FROM OLD.refund_ref)
 THEN RAISE EXCEPTION 'Owner command identity and completed result are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_owner_command_key BEFORE UPDATE OR DELETE ON billing.owner_command_keys
 FOR EACH ROW EXECUTE FUNCTION billing.protect_owner_command_key();
`;
