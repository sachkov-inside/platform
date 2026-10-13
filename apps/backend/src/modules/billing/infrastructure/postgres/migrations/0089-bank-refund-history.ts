export const name = "0089_bank_refund_history";

/** Банковское подтверждение не приписывается покупателю или администратору Platform. */
export const statement = `
ALTER TABLE billing.refund_decisions ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE billing.refund_decisions ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE billing.refund_decisions ADD CONSTRAINT billing_refund_origin_check CHECK (
  (actor_id IS NOT NULL AND operation_id IS NOT NULL)
  OR (actor_id IS NULL AND operation_id IS NULL AND state = 'executed' AND basis = 'withdrawal' AND access = 'revoke')
);
`;
