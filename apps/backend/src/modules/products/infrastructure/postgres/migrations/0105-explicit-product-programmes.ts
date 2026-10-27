export const name = "0105_explicit_product_programmes";

export const statement = `
-- Preserve existing explicit/repeated IDs. Expand any legacy automatic membership omitted by the
-- earlier programme rollout before contracting its old writable order/chapter representation.
with missing as (
  select membership.*, coalesce((select max(ordinal) from products.product_programme_placements p where p.product_id=membership.series_id),0)
    + row_number() over(partition by membership.series_id order by membership.ordinal,membership.material_id) as programme_ordinal
  from products.series_memberships membership
  join products.series product on product.id=membership.series_id
  where not product.programme_explicit
    and (membership.chapter_id is not null or not exists(select 1 from products.product_chapters chapter where chapter.product_id=membership.series_id))
    and not exists(select 1 from products.product_programme_placements p where p.product_id=membership.series_id and p.material_id=membership.material_id)
)
insert into products.product_programme_placements(id,product_id,material_id,chapter_id,ordinal,step_group)
select gen_random_uuid(),series_id,material_id,chapter_id,programme_ordinal,step_group from missing;

alter table products.series drop column programme_explicit;
alter table products.series_memberships drop column ordinal, drop column chapter_id, drop column step_group;
alter table products.published_material_series_memberships drop column ordinal;

-- Cross-owner existence/reference validation now runs through the owner's interface under the
-- shared transaction/reference lock. Immutable removal audit survives Material removal.
alter table products.series_memberships drop constraint series_memberships_material_fk;
alter table products.published_material_series_memberships drop constraint published_material_series_material_fk;
alter table products.product_artifact_material_links drop constraint product_artifact_material_links_material_fk;
alter table products.product_material_removals drop constraint product_material_removals_material_id_fkey;
alter table materials.materials drop constraint materials_current_cover_fk;
alter table materials.topics drop constraint topics_current_cover_fk;
alter table products.series drop constraint series_current_cover_fk;
alter table materials.published_materials drop constraint published_materials_current_cover_fk;
`;
