export const name = "0116_billing_open_reservation_per_product";
// Owner decision of 31.10.2026 (#1921, #1924): an Account keeps one open reservation per Product,
// not one across all Products. The saved price snapshot already names the Product, so the key is
// derived from it for existing and new rows alike and cannot drift from the snapshot. A historical
// snapshot without a valid Product ID (offers and subscriptions before 0108) gets no key and takes
// no part in the constraint. A new reservation cannot lack the Product: reserve re-prices the quote
// through selectPrice, or through a payment link that is sellable only while selectPrice finds its
// Product price, and both snapshots name the Product.
// STORED is explicit: PostgreSQL 18 makes a generated column virtual by default, and a virtual
// column cannot be indexed.
export const statement = `
ALTER TABLE billing.promo_reservations ADD COLUMN product_id uuid GENERATED ALWAYS AS (
 CASE WHEN jsonb_typeof(snapshot->'product'->'id') = 'string'
  AND snapshot->'product'->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN (snapshot->'product'->>'id')::uuid END
) STORED;
DROP INDEX billing.billing_one_open_pricing_reservation;
CREATE UNIQUE INDEX billing_one_open_product_reservation ON billing.promo_reservations(account_id, product_id)
 WHERE state IN ('reserved','sent','unknown');
`;
