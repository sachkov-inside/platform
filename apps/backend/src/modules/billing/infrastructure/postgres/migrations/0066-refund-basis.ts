export const name = "0066_refund_basis";

/**
 * Основание решения о возврате (#648): отказ от договора или компенсация без отказа. Прежние
 * решения основания не имеют — их доступ владелец выбирал явно, и столбец `access` его хранит.
 */
export const statement = `
ALTER TABLE billing.refund_decisions
  ADD COLUMN basis text CHECK (basis IN ('withdrawal','compensation'));
ALTER TABLE billing.refund_decisions
  ADD CONSTRAINT refund_decision_basis_access CHECK (
    basis IS NULL
    OR (basis = 'withdrawal' AND access = 'revoke')
    OR (basis = 'compensation' AND access = 'keep')
  );
`;
