export const name = "0094_individual_payment_links";
export const statement = `
CREATE TABLE billing.payment_links (
 id uuid PRIMARY KEY,
 revision integer NOT NULL CHECK(revision > 0),
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz,
 revoked_at timestamptz,
 CHECK(expires_at IS NULL OR expires_at > created_at)
);
ALTER TABLE billing.price_quotes ADD COLUMN payment_link_id uuid REFERENCES billing.payment_links(id);
ALTER TABLE billing.promo_reservations ADD COLUMN payment_link_id uuid REFERENCES billing.payment_links(id);
CREATE UNIQUE INDEX billing_payment_link_single_use ON billing.promo_reservations(payment_link_id)
 WHERE payment_link_id IS NOT NULL AND state <> 'failed';
`;
