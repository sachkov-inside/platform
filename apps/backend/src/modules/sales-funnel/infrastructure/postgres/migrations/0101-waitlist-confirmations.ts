export const name = "0101_waitlist_confirmations";
export const statement = `
ALTER TABLE sales_funnel.product_waitlist_memberships ADD COLUMN confirmation_event_id uuid;
CREATE TABLE sales_funnel.product_waitlist_confirmations (
 event_id uuid PRIMARY KEY REFERENCES sales_funnel.product_waitlist_events(id),
 intake_id uuid NOT NULL REFERENCES sales_funnel.product_waitlist_intakes(id),
 account_id uuid NOT NULL,
 account_ref text NOT NULL,
 telegram_identity_ref text NOT NULL,
 link_revision integer NOT NULL CHECK(link_revision > 0),
 completed_at timestamptz,
 created_at timestamptz NOT NULL
);
CREATE INDEX product_waitlist_confirmations_pending ON sales_funnel.product_waitlist_confirmations(created_at) WHERE completed_at IS NULL;
`;
