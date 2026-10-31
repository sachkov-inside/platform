export const name = "0117_billing_purchase_bank_recheck";

// #1929: a form that may still take payment after a decline, or a retired attempt whose form still
// needs a Cancel, is asked about less and less often. The column keeps the earliest moment of the
// next bank request. NULL means the decaying schedule has not started for the purchase yet, so the
// next recovery pass asks the bank at once.
export const statement = `
ALTER TABLE billing.purchases ADD COLUMN bank_recheck_at timestamptz;
`;
