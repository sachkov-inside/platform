export const name = "0066_refund_basis";

/**
 * Основание решения о возврате: отказ от договора или компенсация без отказа. Основание решает
 * доступ, поэтому база не принимает расхождения между ними. Решение без основания хранит только
 * доступ, который владелец выбрал сам.
 */
export const statement = `
ALTER TABLE billing.refund_decisions ADD COLUMN basis text;
ALTER TABLE billing.refund_decisions
  ADD CONSTRAINT billing_refund_decisions_basis_check CHECK (
    basis IS NULL
    OR (basis = 'withdrawal' AND access = 'revoke')
    OR (basis = 'compensation' AND access = 'keep')
  );
`;
