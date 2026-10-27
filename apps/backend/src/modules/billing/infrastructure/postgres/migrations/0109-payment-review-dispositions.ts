export const name = "0109_payment_review_dispositions";
export const statement = `
-- Unknown partial-refund amounts and unmappable historical fulfillment are explicit review states.
-- Existing immutable price, legal, bank and receipt facts remain unchanged.
alter table billing.purchases add column refund_review_required boolean not null default false;
alter table billing.fulfillment_outbox add column review_required_at timestamptz;
alter table billing.fulfillment_outbox add column review_reason text;
alter table billing.fulfillment_outbox add constraint fulfillment_review_consistent
 check ((review_required_at is null)=(review_reason is null));
`;
