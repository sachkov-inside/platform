export const name = "0025_content_covers";

export const statement = `
create table materials.content_covers (
  id uuid primary key,
  material_id uuid,
  topic_id uuid,
  series_id uuid,
  state text not null,
  failure_code varchar(64),
  currently_referenced boolean not null default false,
  orphaned_at timestamptz not null default now(),
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_covers_exactly_one_owner check (
    num_nonnulls(material_id, topic_id, series_id) = 1
  ),
  constraint content_covers_state_check check (
    state in ('processing', 'ready', 'failed')
  ),
  constraint content_covers_material_owner_fk foreign key (material_id)
    references materials.materials (id) on delete cascade,
  constraint content_covers_topic_owner_fk foreign key (topic_id)
    references materials.topics (id) on delete cascade,
  constraint content_covers_series_owner_fk foreign key (series_id)
    references materials.series (id) on delete cascade,
  constraint content_covers_material_identity unique (id, material_id),
  constraint content_covers_topic_identity unique (id, topic_id),
  constraint content_covers_series_identity unique (id, series_id)
);

create table materials.content_cover_renditions (
  cover_id uuid not null,
  width integer not null,
  height integer not null,
  content_type varchar(255) not null,
  byte_size integer not null,
  checksum_sha256 char(64) not null,
  public_object_key varchar(512) not null,
  constraint content_cover_renditions_primary primary key (cover_id, width),
  constraint content_cover_renditions_cover_fk foreign key (cover_id)
    references materials.content_covers (id) on delete cascade,
  constraint content_cover_renditions_dimensions_positive check (
    width > 0 and height > 0
  ),
  constraint content_cover_renditions_byte_size_positive check (byte_size > 0),
  constraint content_cover_renditions_checksum_check check (
    checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
);

alter table materials.materials add column cover_id uuid;
alter table materials.topics add column cover_id uuid;
alter table materials.series add column cover_id uuid;
alter table materials.published_materials add column cover_id uuid;

alter table materials.materials
  add constraint materials_current_cover_fk foreign key (cover_id, id)
    references materials.content_covers (id, material_id);
alter table materials.topics
  add constraint topics_current_cover_fk foreign key (cover_id, id)
    references materials.content_covers (id, topic_id);
alter table materials.series
  add constraint series_current_cover_fk foreign key (cover_id, id)
    references materials.content_covers (id, series_id);
alter table materials.published_materials
  add constraint published_materials_current_cover_fk foreign key (cover_id, material_id)
    references materials.content_covers (id, material_id);

create index content_covers_orphan_idx
  on materials.content_covers (currently_referenced, orphaned_at, updated_at);
`;
