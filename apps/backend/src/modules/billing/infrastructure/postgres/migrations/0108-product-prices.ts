export const name = "0108_product_prices";
export const statement = `
-- Financial refund and Product withdrawal are independent. Preserve every existing stored fact.
alter table billing.refund_decisions drop constraint billing_refund_decisions_basis_check;
alter table billing.refund_decisions add constraint billing_refund_decisions_basis_check
 check (basis in ('withdrawal','compensation') and access in ('keep','revoke'));

alter table billing.refund_decisions drop constraint billing_refund_origin_check;
alter table billing.refund_decisions add constraint billing_refund_origin_check check (
 (actor_id is not null and operation_id is not null)
 or (actor_id is null and operation_id is null and state='executed' and basis='withdrawal' and access in ('keep','revoke'))
);

create table billing.product_prices (
 product_id uuid primary key,
 revision integer not null check(revision > 0),
 name text not null,
 price_kopecks bigint not null check(price_kopecks > 0),
 published boolean not null default false,
 archived boolean not null default false,
 updated_at timestamptz not null
);
-- Classify the complete old content composition once. Syntax is not authority:
-- explicit coverage contributes Product content only with the materials capability.
-- Guard every JSON extraction and UUID cast before using historical residual values.
create temporary table product_price_candidates on commit drop as
with raw as (
 select offer.id offer_id, option.id payment_option_id, offer.name, offer.benefits,
 offer.archived offer_archived, option.archived option_archived, option.mode,
 option.price_kopecks, offer.published old_published, offer.benefit_periods,
 to_jsonb(offer) offer_source, to_jsonb(option) option_source,
 offer.coverage,
 coalesce(offer.coverage,'null'::jsonb)='null'::jsonb coverage_absent,
 case when jsonb_typeof(offer.coverage->'productIds')='array' then offer.coverage->'productIds' else '[]'::jsonb end coverage_products,
 case when jsonb_typeof(offer.coverage->'materialIds')='array' then offer.coverage->'materialIds' else '[]'::jsonb end coverage_materials
 from billing.offers offer join billing.payment_options option on option.offer_id=offer.id
), validated as (
 select raw.*,
 array_ndims(benefits)=1 and not exists(select 1 from unnest(benefits) benefit where benefit is null or not (
   benefit in ('materials','community','support','reviews')
   or benefit ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
 and cardinality(benefits)=(select count(distinct lower(benefit)) from unnest(benefits) benefit) benefits_valid,
 jsonb_typeof(benefit_periods)='array'
 and jsonb_array_length(case when jsonb_typeof(benefit_periods)='array' then benefit_periods else '[]'::jsonb end)<=100
 and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(benefit_periods)='array' then benefit_periods else '[]'::jsonb end) period
   where not coalesce(jsonb_typeof(period)='object'
     and not exists(select 1 from jsonb_object_keys(case when jsonb_typeof(period)='object' then period else '{}'::jsonb end) key where key not in ('capability','months'))
     and jsonb_typeof(period->'capability')='string'
     and (period->>'capability' in ('materials','community','support','reviews')
       or period->>'capability' ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
     and (period->'months'='null'::jsonb or case when jsonb_typeof(period->'months')='number'
       then (period->>'months')::numeric between 1 and 1200 and trunc((period->>'months')::numeric)=(period->>'months')::numeric else false end),false)
 ) benefit_periods_valid,
 coverage_absent or (
   jsonb_typeof(coverage)='object'
   and jsonb_typeof(coverage->'productIds')='array' and jsonb_typeof(coverage->'materialIds')='array'
   and not exists(select 1 from jsonb_object_keys(case when jsonb_typeof(coverage)='object' then coverage else '{}'::jsonb end) key
     where key not in ('productIds','materialIds','wholePlatform'))
   and (not (coverage ? 'wholePlatform') or coverage->'wholePlatform'='true'::jsonb)
   and jsonb_array_length(coverage_products)<=1000 and jsonb_array_length(coverage_materials)<=1000
   and not exists(select 1 from jsonb_array_elements(coverage_products || coverage_materials) id
     where jsonb_typeof(id)<>'string' or (id#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
   and jsonb_array_length(coverage_products)=(select count(distinct lower(id#>>'{}')) from jsonb_array_elements(coverage_products) id)
   and jsonb_array_length(coverage_materials)=(select count(distinct lower(id#>>'{}')) from jsonb_array_elements(coverage_materials) id)
   and (coverage->'wholePlatform' is distinct from 'true'::jsonb or (coverage_products='[]'::jsonb and coverage_materials='[]'::jsonb))
 ) coverage_valid,
 array(select distinct case when benefit ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then substring(benefit from 9)::uuid end from unnest(benefits) benefit where benefit like 'product:%') direct_ids,
 array(select distinct case when jsonb_typeof(id)='string' and (id#>>'{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then (id#>>'{}')::uuid end from jsonb_array_elements(coverage_products) id) coverage_ids
 from raw
), semantic as (
 select validated.*,
 array(select distinct id from unnest(direct_ids || case when 'materials'=any(benefits) then coverage_ids else '{}'::uuid[] end) id
   where id is not null order by id) product_ids
 from validated
), classified as (
 select semantic.*,
 case when not benefits_valid then 'invalid_benefits'
 when not coalesce(coverage_valid,false) then 'invalid_coverage'
 when 'reviews'=any(benefits) then 'withheld_content'
 when coverage->'wholePlatform'='true'::jsonb then 'whole_platform'
 when coverage_materials<>'[]'::jsonb then 'material_scope'
 when 'materials'=any(benefits) and (coverage_absent or cardinality(coverage_ids)=0) then 'unresolved_materials'
 when exists(select 1 from unnest(product_ids) requested(id) where not exists(select 1 from products.series product where product.id=requested.id)) then 'missing_product'
 when cardinality(product_ids)=0 then 'no_product_content'
 when cardinality(product_ids)<>1 then 'multiple_products'
 else 'exact_product' end composition
 from semantic
)
select classified.*,
 composition='exact_product' exact_product,
 -- Invalid content can overlap a projected Product without proving an exact fiber.
 -- Known support/community-only coverage has no content authority at all.
 (cardinality(direct_ids)>0 or 'materials'=any(benefits) or not benefits_valid)
 and composition in ('invalid_benefits','invalid_coverage','whole_platform','material_scope','unresolved_materials') uncertain_content,
 -- Exact-Product source sale readiness is provenance, never publication authority.
 not offer_archived and not option_archived and old_published and composition='exact_product'
 and (cardinality(direct_ids)=0 or ('support'=any(benefits) and coalesce(benefit_periods_valid,false) and exists (
   select 1 from jsonb_array_elements(case when jsonb_typeof(benefit_periods)='array' then benefit_periods else '[]'::jsonb end) period
   where period->>'capability'='support' and (period->'months'='null'::jsonb or case when jsonb_typeof(period->'months')='number'
     then (period->>'months')::numeric between 1 and 1200 and trunc((period->>'months')::numeric)=(period->>'months')::numeric else false end)
 ))) source_sale_ready
from classified;

create table billing.product_price_migration_inventory (
 payment_option_id uuid primary key, product_id uuid, source jsonb not null,
 composition text not null, source_sale_ready boolean not null, disposition text not null
);
insert into billing.product_price_migration_inventory(payment_option_id,product_id,source,composition,source_sale_ready,disposition)
select candidate.payment_option_id,
 case when candidate.exact_product then candidate.product_ids[1] else null end,
 jsonb_build_object('offer',candidate.offer_source,'option',candidate.option_source),candidate.composition,candidate.source_sale_ready,
 case when not candidate.exact_product then 'paused_unsupported_scope'
 when candidate.offer_archived or candidate.option_archived then 'paused_archived'
 when candidate.mode<>'one_time' then 'paused_recurring'
 when exists(select 1 from product_price_candidates other where other.product_ids=candidate.product_ids
   and other.mode='one_time' and not other.offer_archived and not other.option_archived
   and other.exact_product and other.price_kopecks<>candidate.price_kopecks) then 'paused_conflicting_prices'
 else 'paused_owner_publication' end
from product_price_candidates candidate;

-- A deterministic draft never publishes a legacy price. Future legal readiness alone
-- must not open an arbitrary old price or a formerly unsellable composition.
insert into billing.product_prices(product_id,revision,name,price_kopecks,published,archived,updated_at)
select distinct on (product_ids[1]) product_ids[1],1,name,price_kopecks,false,false,now()
from product_price_candidates
where mode='one_time' and not offer_archived and not option_archived
 and exact_product
order by product_ids[1],old_published desc,payment_option_id;

-- Empty old arrays mean unrestricted. Nonempty restrictions intersect, never unite.
alter table billing.promotions add column product_ids uuid[] not null default '{}';
alter table billing.promotions alter column offer_ids set default '{}';
alter table billing.promotions alter column payment_option_ids set default '{}';
create table billing.promotion_migration_inventory (
 promotion_id uuid primary key, source jsonb not null,
 mapped_product_ids uuid[] not null default '{}', disposition text not null
);
insert into billing.promotion_migration_inventory(promotion_id,source,disposition)
select id,to_jsonb(promotion)-'product_ids','pending' from billing.promotions promotion;

update billing.promotions promotion set product_ids=array(
 select distinct candidate.product_ids[1] from product_price_candidates candidate
 where candidate.mode='one_time' and not candidate.offer_archived and not candidate.option_archived
 and candidate.exact_product
 and (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
 and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
 order by candidate.product_ids[1]
) where cardinality(offer_ids)>0 or cardinality(payment_option_ids)>0;

-- Product scope cannot encode a strict subset of that Product's live old prices.
-- Price publication is a separate decision and cannot authorize widening a Promotion.
-- Detect excluded same-Product candidates independently of which draft UUID won.
update billing.promotion_migration_inventory inventory set disposition='paused_partial_product_scope'
from billing.promotions promotion
where promotion.id=inventory.promotion_id
 and (cardinality(promotion.offer_ids)>0 or cardinality(promotion.payment_option_ids)>0)
 and exists(select 1 from product_price_candidates candidate
   where candidate.mode='one_time' and not candidate.offer_archived and not candidate.option_archived
   and candidate.exact_product
   and candidate.product_ids && promotion.product_ids
   and not (
     (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
     and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
   ));

-- An excluded live content scope whose overlap cannot be ruled out also prevents
-- a faithful projection. Keep it distinct from a known strict exact-Product subset.
update billing.promotion_migration_inventory inventory set disposition='paused_unprovable_content_scope'
from billing.promotions promotion
where promotion.id=inventory.promotion_id
 and (cardinality(promotion.offer_ids)>0 or cardinality(promotion.payment_option_ids)>0)
 and cardinality(promotion.product_ids)>0
 and exists(select 1 from product_price_candidates candidate
   where candidate.mode='one_time' and not candidate.offer_archived and not candidate.option_archived
   and not candidate.exact_product
   and (candidate.uncertain_content or candidate.product_ids && promotion.product_ids)
   and not (
     (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
     and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
   ));

-- An explicitly selected recurring identity is not merely unrelated passive history.
update billing.promotion_migration_inventory inventory set disposition='paused_requested_recurring_option'
from billing.promotions promotion
where promotion.id=inventory.promotion_id
 and exists(select 1 from billing.payment_options option
   where option.id=any(promotion.payment_option_ids) and option.mode<>'one_time');

-- Unprovable restrictions remain paused, with the exact prior source stored above.
-- Do not silently drop a missing identity or an unsupported eligible composition.
update billing.promotions promotion set archived=true,product_ids='{}' where
 (cardinality(offer_ids)>0 or cardinality(payment_option_ids)>0) and (
 cardinality(product_ids)=0
 or exists(select 1 from billing.promotion_migration_inventory inventory
   where inventory.promotion_id=promotion.id and inventory.disposition in ('paused_partial_product_scope','paused_unprovable_content_scope'))
 or exists(select 1 from unnest(promotion.offer_ids) requested(id) where not exists(
   select 1 from billing.offers offer where offer.id=requested.id and not offer.archived))
 or exists(select 1 from unnest(promotion.payment_option_ids) requested(id) where not exists(
   select 1 from billing.payment_options option where option.id=requested.id and not option.archived and option.mode='one_time'))
 or exists(select 1 from product_price_candidates candidate
   where candidate.mode='one_time' and not candidate.offer_archived and not candidate.option_archived
   and (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
   and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
   and not candidate.exact_product)
);
update billing.promotion_migration_inventory inventory set mapped_product_ids=promotion.product_ids, disposition=
 case when cardinality(promotion.offer_ids)=0 and cardinality(promotion.payment_option_ids)=0 then 'unrestricted'
 when inventory.disposition in ('paused_partial_product_scope','paused_unprovable_content_scope','paused_requested_recurring_option') then inventory.disposition
 when promotion.archived then 'paused_requires_review' else 'mapped_intersection' end
from billing.promotions promotion where promotion.id=inventory.promotion_id;

`;
