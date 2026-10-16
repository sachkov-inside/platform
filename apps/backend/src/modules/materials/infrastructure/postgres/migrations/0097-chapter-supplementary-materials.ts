export const name = "0097_chapter_supplementary_materials";

export const statement = `
alter table materials.series add column programme_explicit boolean not null default false;
create table materials.product_chapter_supplementary_materials (
  chapter_id uuid not null,
  product_id uuid not null,
  material_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  primary key (chapter_id, material_id),
  foreign key (chapter_id, product_id)
    references materials.product_chapters (id, product_id) on delete cascade,
  foreign key (product_id, material_id) references materials.series_memberships (series_id, material_id) on delete cascade,
  unique (chapter_id, ordinal) deferrable initially deferred
);
create index product_chapter_supplementary_materials_product_idx
  on materials.product_chapter_supplementary_materials (product_id);
create table materials.product_programme_placements (
  id uuid primary key,
  product_id uuid not null,
  material_id uuid not null,
  chapter_id uuid,
  ordinal integer not null check (ordinal > 0),
  step_group text,
  unique (product_id, ordinal) deferrable initially deferred,
  foreign key (product_id, material_id) references materials.series_memberships (series_id, material_id) on delete cascade,
  foreign key (chapter_id, product_id) references materials.product_chapters (id, product_id) on delete set null (chapter_id)
);
insert into materials.product_programme_placements (id, product_id, material_id, chapter_id, ordinal, step_group)
select gen_random_uuid(), membership.series_id, membership.material_id, membership.chapter_id,
  row_number() over (partition by membership.series_id order by membership.ordinal, membership.material_id), membership.step_group
from materials.series_memberships as membership
where membership.chapter_id is not null or not exists (
  select 1 from materials.product_chapters as chapter where chapter.product_id = membership.series_id
);
`;
