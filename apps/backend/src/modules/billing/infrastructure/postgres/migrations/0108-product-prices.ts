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
-- Every old option is retained as passive provenance, including malformed, missing,
-- archived and recurring scopes. A strict guarded cast must not abort the whole upgrade.
create temporary table product_price_candidates on commit drop as
select offer.id offer_id, option.id payment_option_id, offer.name,
 offer.archived offer_archived, option.archived option_archived, option.mode,
 option.price_kopecks, offer.published old_published,
 to_jsonb(offer) offer_source, to_jsonb(option) option_source,
 (select count(*) from unnest(offer.benefits) benefit where benefit like 'product:%') product_reference_count,
 array(
   select distinct product.id from unnest(offer.benefits) benefit
   join products.series product on product.id=case
     when benefit ~ '^product:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     then substring(benefit from 9)::uuid else null end
   order by product.id
 ) product_ids
from billing.offers offer join billing.payment_options option on option.offer_id=offer.id;

create table billing.product_price_migration_inventory (
 payment_option_id uuid primary key, product_id uuid, source jsonb not null,
 disposition text not null
);
insert into billing.product_price_migration_inventory(payment_option_id,product_id,source,disposition)
select candidate.payment_option_id,
 case when candidate.product_reference_count=1 and cardinality(candidate.product_ids)=1 then candidate.product_ids[1] else null end,
 jsonb_build_object('offer',candidate.offer_source,'option',candidate.option_source),
 case when candidate.product_reference_count<>1 or cardinality(candidate.product_ids)<>1 then 'paused_unsupported_scope'
 when candidate.offer_archived or candidate.option_archived then 'paused_archived'
 when candidate.mode<>'one_time' then 'paused_recurring'
 when exists(select 1 from product_price_candidates other where other.product_ids=candidate.product_ids
   and other.mode='one_time' and not other.offer_archived and not other.option_archived
   and other.product_reference_count=1 and other.price_kopecks<>candidate.price_kopecks) then 'paused_conflicting_prices'
 else 'paused_owner_publication' end
from product_price_candidates candidate;

-- A deterministic draft never publishes a legacy price. Future legal readiness alone
-- must not open an arbitrary old price or a formerly unsellable composition.
insert into billing.product_prices(product_id,revision,name,price_kopecks,published,archived,updated_at)
select distinct on (product_ids[1]) product_ids[1],1,name,price_kopecks,false,false,now()
from product_price_candidates
where mode='one_time' and not offer_archived and not option_archived
 and product_reference_count=1 and cardinality(product_ids)=1
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
 and candidate.product_reference_count=1 and cardinality(candidate.product_ids)=1
 and (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
 and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
 order by candidate.product_ids[1]
) where cardinality(offer_ids)>0 or cardinality(payment_option_ids)>0;

-- Unprovable restrictions remain paused, with the exact prior source stored above.
-- Do not silently drop a missing identity or an unsupported eligible composition.
update billing.promotions promotion set archived=true,product_ids='{}' where
 (cardinality(offer_ids)>0 or cardinality(payment_option_ids)>0) and (
 cardinality(product_ids)=0
 or exists(select 1 from unnest(promotion.offer_ids) requested(id) where not exists(
   select 1 from billing.offers offer where offer.id=requested.id and not offer.archived))
 or exists(select 1 from unnest(promotion.payment_option_ids) requested(id) where not exists(
   select 1 from billing.payment_options option where option.id=requested.id and not option.archived))
 or exists(select 1 from product_price_candidates candidate
   where candidate.mode='one_time' and not candidate.offer_archived and not candidate.option_archived
   and (cardinality(promotion.offer_ids)=0 or candidate.offer_id=any(promotion.offer_ids))
   and (cardinality(promotion.payment_option_ids)=0 or candidate.payment_option_id=any(promotion.payment_option_ids))
   and (candidate.product_reference_count<>1 or cardinality(candidate.product_ids)<>1))
);
update billing.promotion_migration_inventory inventory set mapped_product_ids=promotion.product_ids, disposition=
 case when cardinality(promotion.offer_ids)=0 and cardinality(promotion.payment_option_ids)=0 then 'unrestricted'
 when promotion.archived then 'paused_requires_review' else 'mapped_intersection' end
from billing.promotions promotion where promotion.id=inventory.promotion_id;

`;
