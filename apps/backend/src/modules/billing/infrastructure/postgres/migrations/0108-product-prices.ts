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
-- Legacy rows remain passive financial/receipt provenance. Exactly one Product price is selected
-- deterministically without rewriting any quote, acceptance, purchase or Payment Link snapshot.
insert into billing.product_prices(product_id,revision,name,price_kopecks,published,archived,updated_at)
select distinct on (substring(benefit from 9)::uuid)
 substring(benefit from 9)::uuid,1,offer.name,option.price_kopecks,offer.published,false,now()
from billing.offers offer join billing.payment_options option on option.offer_id=offer.id
cross join lateral unnest(offer.benefits) benefit
where option.mode='one_time' and not option.archived and not offer.archived
 and benefit ~ '^product:[0-9a-fA-F-]{36}$'
 and (select count(*) from unnest(offer.benefits) b where b like 'product:%')=1
order by substring(benefit from 9)::uuid,offer.published desc,option.id;

-- Promotion scope now names Products directly. Prior price/quote/payment snapshots stay immutable.
alter table billing.promotions add column product_ids uuid[] not null default '{}';
-- New Product-only Promotions have no legacy tariff scope. Retained rows keep their provenance.
alter table billing.promotions alter column offer_ids set default '{}';
alter table billing.promotions alter column payment_option_ids set default '{}';
update billing.promotions promotion set product_ids=array(
 select distinct substring(benefit from 9)::uuid
 from billing.offers offer cross join lateral unnest(offer.benefits) benefit
 where benefit ~ '^product:[0-9a-fA-F-]{36}$' and (
 offer.id=any(promotion.offer_ids)
 or exists(select 1 from billing.payment_options option where option.offer_id=offer.id and option.id=any(promotion.payment_option_ids))
 )
);
-- An unmappable restricted historical scope must never become an all-Product discount.
update billing.promotions set archived=true where cardinality(product_ids)=0
 and (cardinality(offer_ids)>0 or cardinality(payment_option_ids)>0);

`;
