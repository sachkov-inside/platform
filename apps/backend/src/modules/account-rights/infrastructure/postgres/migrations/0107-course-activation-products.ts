export const name = "0107_course_activation_products";

export const statement = `
-- Historical tier references stay passive for audit. Only unambiguous Product rules remain live.
alter table account_rights.activation_rules add column product_id uuid;
alter table account_rights.activation_rules alter column tier_id drop not null;
alter table account_rights.activation_rules alter column tier_revision drop not null;
with resolved as (
 select rule.id, min(substring(benefit from 9))::uuid product_id
 from account_rights.activation_rules rule
 join billing.offers offer on offer.id=rule.tier_id
 cross join lateral unnest(offer.benefits) benefit
 where benefit ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 group by rule.id
 having count(*)=1
)
update account_rights.activation_rules rule set product_id=resolved.product_id
from resolved where resolved.id=rule.id;
update account_rights.activation_rules set published=false where product_id is null;
alter table account_rights.source_entitlements add column first_issued_at timestamptz;
-- Source receipts, attempts, enrollment references and financial/legal snapshots are immutable.
`;
