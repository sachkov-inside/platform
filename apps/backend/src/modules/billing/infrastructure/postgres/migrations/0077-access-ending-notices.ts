export const name = "0077_access_ending_notices";
export const statement = `
ALTER TABLE billing.notices DROP CONSTRAINT notices_kind_check;
ALTER TABLE billing.notices ADD CONSTRAINT notices_kind_check CHECK (kind IN ('renewal_reminder','access_ending','payment_succeeded','payment_failed','renewal_cancelled','access_expired','refund_resolved'));
`;
