export const name = "0104_products_ownership";

export const statement = `
create schema products;
create schema content_covers;

alter table materials.series set schema products;
alter table materials.product_artifacts set schema products;
alter table materials.product_artifact_versions set schema products;
alter table materials.product_artifact_placements set schema products;
alter table materials.product_artifact_material_links set schema products;
alter table materials.product_chapters set schema products;
alter table materials.product_programme_placements set schema products;
alter table materials.product_chapter_supplementary_materials set schema products;
alter table materials.series_memberships set schema products;
alter table materials.published_material_series_memberships set schema products;
alter table materials.product_material_removals set schema products;
alter table materials.home_series_pin set schema products;
alter table materials.content_covers set schema content_covers;
alter table materials.content_cover_renditions set schema content_covers;
`;
