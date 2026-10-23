export const name = "0108_product_prices";
export const statement = `
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
`;
