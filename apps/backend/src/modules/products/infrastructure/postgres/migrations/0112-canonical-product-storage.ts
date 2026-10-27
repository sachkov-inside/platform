export const name = "0112_canonical_product_storage";

/** Incompatible contract. Drain old artifacts and retain the pre-contract backup before applying. */
export const statement = `
alter table products.series rename to products;
alter table products.series_memberships rename to product_memberships;
alter table products.product_memberships rename column series_id to product_id;
alter table products.published_material_series_memberships rename to published_material_product_memberships;
alter table products.published_material_product_memberships rename column series_id to product_id;
alter table products.home_series_pin rename to home_product_pin;
alter table products.home_product_pin rename column series_id to product_id;
alter table content_covers.content_covers rename column series_id to product_id;
alter schema member_profiles rename to account_profiles;

-- Passive historical configuration only; current Product rights always use the fixed group.
alter table telegram_membership.product_communities rename to historical_product_community_records;

-- PostgreSQL retains constraint/index identities through table and column renames.
-- Rename their diagnostic labels too, without dropping or rebuilding constraints.
do $$
declare item record; canonical text;
begin
  for item in
    select namespace.nspname, relation.relname, constraint_row.conname
    from pg_constraint constraint_row
    join pg_class relation on relation.oid=constraint_row.conrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in ('products','content_covers','account_profiles')
      and (constraint_row.conname like '%series%' or constraint_row.conname like '%member_profile%')
  loop
    canonical := replace(replace(replace(item.conname,'member_profiles','account_profiles'),'member_profile','account_profile'),'series','product');
    execute format('alter table %I.%I rename constraint %I to %I',item.nspname,item.relname,item.conname,canonical);
  end loop;
  for item in
    select schemaname,indexname from pg_indexes
    where schemaname in ('products','content_covers','account_profiles')
      and (indexname like '%series%' or indexname like '%member_profile%')
  loop
    canonical := replace(replace(replace(item.indexname,'member_profiles','account_profiles'),'member_profile','account_profile'),'series','product');
    execute format('alter index %I.%I rename to %I',item.schemaname,item.indexname,canonical);
  end loop;
end $$;
`;
