export const name = "0107_course_activation_products";

export const statement = `
-- Historical tier references stay passive for audit. Only unambiguous Product rules remain live.
alter table account_rights.activation_rules add column product_id uuid;
alter table account_rights.activation_rules alter column tier_id drop not null;
alter table account_rights.activation_rules alter column tier_revision drop not null;
create table account_rights.course_rule_migration_inventory (
 rule_id uuid primary key, source jsonb not null, disposition text not null
);
insert into account_rights.course_rule_migration_inventory(rule_id,source,disposition)
select rule.id,jsonb_build_object('rule',to_jsonb(rule),'offer',to_jsonb(offer)),'pending'
from account_rights.activation_rules rule left join billing.offers offer on offer.id=rule.tier_id;
with resolved as (
 select rule.id, min(substring(benefit from 9))::uuid product_id
 from account_rights.activation_rules rule
 join billing.offers offer on offer.id=rule.tier_id and offer.revision=rule.tier_revision
   and not offer.archived and offer.available_for_assignment
   and not ('reviews'=any(offer.benefits))
   and (offer.coverage is null or
     (jsonb_typeof(offer.coverage)='object' and coalesce(offer.coverage->'materialIds','[]'::jsonb)='[]'::jsonb))
   and (not ('support'=any(offer.benefits)) or exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(offer.benefit_periods)='array' then offer.benefit_periods else '[]'::jsonb end) period
     where period->>'capability'='support' and (
       period->'months'='null'::jsonb or case when jsonb_typeof(period->'months')='number'
         then (period->>'months')::numeric between 1 and 1200 and trunc((period->>'months')::numeric)=(period->>'months')::numeric
         else false end
     )
   ))
 cross join lateral unnest(offer.benefits) benefit
 where benefit ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 group by rule.id
 having count(*)=1
)
update account_rights.activation_rules rule set product_id=resolved.product_id
from resolved where resolved.id=rule.id
  and exists(select 1 from products.series product where product.id=resolved.product_id);
update account_rights.activation_rules set published=false where product_id is null;
update account_rights.course_rule_migration_inventory inventory set disposition=
 case when rule.product_id is null then 'paused_requires_review' else 'mapped_exact_pinned_revision' end
from account_rights.activation_rules rule where rule.id=inventory.rule_id;
alter table account_rights.source_entitlements add column first_issued_at timestamptz;
-- Source receipts, attempts, enrollment references and financial/legal snapshots are immutable.
`;
