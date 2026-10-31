/**
 * Лента показывает только материалы, которые автор выложил в неё явно (#1885). Текущая лента
 * сохраняется без уроков курса: флаг получают опубликованные бесплатные материалы вне Products.
 */
export const name = "0115_explicit_feed";
export const statement = `
alter table materials.materials add column in_feed boolean not null default false;
alter table materials.published_materials add column in_feed boolean not null default false;
update materials.materials as material set in_feed = true
where material.publication_state = 'published'
  and material.access = 'free'
  and not exists (
    select 1 from products.product_memberships as membership
    where membership.material_id = material.id
  );
update materials.published_materials as publication set in_feed = material.in_feed
from materials.materials as material
where material.id = publication.material_id;
`;
