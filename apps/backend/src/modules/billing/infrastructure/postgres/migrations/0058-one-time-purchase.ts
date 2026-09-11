export const name = "0058_one_time_purchase";
export const statement = `
ALTER TABLE billing.payment_options DROP CONSTRAINT payment_options_mode_check;
ALTER TABLE billing.payment_options ADD CONSTRAINT payment_options_mode CHECK (mode IN ('subscription','one_time'));
ALTER TABLE billing.purchases DROP CONSTRAINT purchases_kind_check;
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_kind CHECK (kind IN ('initial','one_time','renewal','upgrade'));
ALTER TABLE billing.purchases DROP CONSTRAINT purchases_initial_quote;
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_quoted_purchase CHECK ((kind IN ('initial','one_time')) = (quote_ref IS NOT NULL));
ALTER TABLE billing.purchases DROP CONSTRAINT purchases_scheduled_attempt;
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_scheduled_attempt
 CHECK (kind IN ('initial','one_time') OR (subscription_ref IS NOT NULL AND period_index IS NOT NULL));
ALTER TABLE billing.purchases DROP CONSTRAINT purchases_check;
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_confirmed_payment
 CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL));
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_paid_period
 CHECK ((period_ends_at IS NOT NULL) = (state = 'confirmed' AND kind <> 'one_time'));
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_one_time_standalone
 CHECK (kind <> 'one_time' OR (subscription_ref IS NULL AND period_index IS NULL AND NOT lifecycle_active));
`;
