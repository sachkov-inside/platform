export const name = "0001_materials";

export const statement = `
create schema materials;

create table materials.topics (
  id uuid primary key,
  slug text not null constraint topics_slug_unique unique,
  name text not null,
  constraint topics_slug_normalized check (slug = lower(btrim(slug)))
);

create table materials.formats (
  id uuid primary key,
  slug text not null constraint formats_slug_unique unique,
  name text not null,
  constraint formats_slug_normalized check (slug = lower(btrim(slug)))
);

create table materials.tags (
  id uuid primary key,
  name text not null,
  normalized_name text not null constraint tags_normalized_name_unique unique,
  constraint tags_normalized_name_canonical check (
    normalized_name = lower(btrim(normalized_name))
  )
);

create table materials.series (
  id uuid primary key,
  slug text not null constraint series_slug_unique unique,
  name text not null,
  constraint series_slug_normalized check (slug = lower(btrim(slug)))
);

create table materials.materials (
  id uuid primary key,
  slug text not null constraint materials_slug_unique unique,
  current_draft_revision_id uuid not null,
  current_published_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint materials_slug_normalized check (slug = lower(btrim(slug)))
);

create table materials.material_revisions (
  id uuid primary key,
  material_id uuid not null,
  title text not null,
  summary text not null,
  slug text not null,
  topic_id uuid not null,
  format_id uuid not null,
  schema_version smallint not null,
  body jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  access text not null,
  restored_from_revision_id uuid,
  constraint material_revisions_material_and_id_unique unique (material_id, id),
  constraint material_revisions_material_fk foreign key (material_id)
    references materials.materials (id) on delete cascade,
  constraint material_revisions_topic_fk foreign key (topic_id)
    references materials.topics (id),
  constraint material_revisions_format_fk foreign key (format_id)
    references materials.formats (id),
  constraint material_revisions_restored_from_fk foreign key (
    material_id,
    restored_from_revision_id
  ) references materials.material_revisions (material_id, id),
  constraint material_revisions_schema_version_check check (schema_version = 1),
  constraint material_revisions_slug_normalized check (slug = lower(btrim(slug))),
  constraint material_revisions_access_check check (access in ('free', 'membership'))
);

alter table materials.materials
  add constraint materials_current_draft_revision_fk
  foreign key (id, current_draft_revision_id)
  references materials.material_revisions (material_id, id)
  deferrable initially deferred;

alter table materials.materials
  add constraint materials_current_published_revision_fk
  foreign key (id, current_published_revision_id)
  references materials.material_revisions (material_id, id);

create table materials.material_tags (
  material_id uuid not null,
  tag_id uuid not null,
  constraint material_tags_primary primary key (material_id, tag_id),
  constraint material_tags_material_fk foreign key (material_id)
    references materials.materials (id) on delete cascade,
  constraint material_tags_tag_fk foreign key (tag_id)
    references materials.tags (id)
);

create table materials.series_memberships (
  series_id uuid not null,
  material_id uuid not null,
  ordinal integer not null,
  constraint series_memberships_primary primary key (series_id, material_id),
  constraint series_memberships_ordinal_unique unique (series_id, ordinal),
  constraint series_memberships_series_fk foreign key (series_id)
    references materials.series (id),
  constraint series_memberships_material_fk foreign key (material_id)
    references materials.materials (id) on delete cascade,
  constraint series_memberships_ordinal_positive check (ordinal > 0)
);

create table materials.material_revision_tags (
  revision_id uuid not null,
  material_id uuid not null,
  tag_id uuid not null,
  constraint material_revision_tags_primary primary key (revision_id, tag_id),
  constraint material_revision_tags_revision_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id) on delete cascade,
  constraint material_revision_tags_tag_fk foreign key (tag_id)
    references materials.tags (id)
);

create table materials.material_revision_series_memberships (
  revision_id uuid not null,
  material_id uuid not null,
  series_id uuid not null,
  ordinal integer not null,
  constraint material_revision_series_primary primary key (revision_id, series_id),
  constraint material_revision_series_revision_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id) on delete cascade,
  constraint material_revision_series_series_fk foreign key (series_id)
    references materials.series (id),
  constraint material_revision_series_ordinal_positive check (ordinal > 0)
);

create table materials.material_publication_events (
  id uuid primary key,
  material_id uuid not null,
  revision_id uuid not null,
  kind text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint material_publication_events_revision_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id),
  constraint material_publication_events_kind_check check (kind in ('publish', 'unpublish'))
);

create table materials.authoring_idempotency (
  actor_id uuid not null,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint char(64) not null,
  material_id uuid,
  revision_id uuid,
  publication_event_id uuid,
  created_at timestamptz not null default now(),
  constraint authoring_idempotency_primary primary key (
    actor_id,
    operation,
    idempotency_key
  ),
  constraint authoring_idempotency_effect_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id),
  constraint authoring_idempotency_publication_event_fk foreign key (publication_event_id)
    references materials.material_publication_events (id),
  constraint authoring_idempotency_operation_check check (
    operation in (
      'create_draft',
      'revise_draft',
      'publish_revision',
      'unpublish_material',
      'restore_revision'
    )
  ),
  constraint authoring_idempotency_effect_complete check (
    (material_id is null) = (revision_id is null)
  )
);

create table materials.published_materials (
  material_id uuid primary key,
  revision_id uuid not null,
  slug text not null constraint published_materials_slug_unique unique,
  title text not null,
  summary text not null,
  access text not null,
  topic_id uuid not null,
  format_id uuid not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  constraint published_materials_material_revision_unique unique (material_id, revision_id),
  constraint published_materials_revision_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id) on delete cascade,
  constraint published_materials_topic_fk foreign key (topic_id)
    references materials.topics (id),
  constraint published_materials_format_fk foreign key (format_id)
    references materials.formats (id),
  constraint published_materials_slug_normalized check (slug = lower(btrim(slug))),
  constraint published_materials_access_check check (access in ('free', 'membership'))
);

create table materials.published_material_tags (
  material_id uuid not null,
  tag_id uuid not null,
  constraint published_material_tags_primary primary key (material_id, tag_id),
  constraint published_material_tags_material_fk foreign key (material_id)
    references materials.published_materials (material_id) on delete cascade,
  constraint published_material_tags_tag_fk foreign key (tag_id)
    references materials.tags (id)
);

create table materials.published_material_series_memberships (
  material_id uuid not null,
  series_id uuid not null,
  ordinal integer not null,
  constraint published_material_series_primary primary key (material_id, series_id),
  constraint published_material_series_ordinal_unique unique (series_id, ordinal),
  constraint published_material_series_material_fk foreign key (material_id)
    references materials.published_materials (material_id) on delete cascade,
  constraint published_material_series_series_fk foreign key (series_id)
    references materials.series (id),
  constraint published_material_series_ordinal_positive check (ordinal > 0)
);

create table materials.material_search_documents (
  material_id uuid primary key,
  revision_id uuid not null,
  plain_text text not null,
  constraint material_search_documents_publication_fk foreign key (material_id, revision_id)
    references materials.published_materials (material_id, revision_id) on delete cascade
);

create table materials.material_access_audit_events (
  id uuid primary key,
  material_id uuid not null,
  revision_id uuid not null,
  actor_id uuid,
  action text not null,
  decision text not null,
  created_at timestamptz not null default now(),
  constraint material_access_audit_events_revision_fk foreign key (material_id, revision_id)
    references materials.material_revisions (material_id, id),
  constraint material_access_audit_events_action_check check (action in ('preview', 'read')),
  constraint material_access_audit_events_decision_check check (decision in ('allow', 'deny'))
);

create function materials.reject_immutable_material_revision_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'material revision data is immutable' using errcode = '55000';
end;
$$;

create trigger material_revisions_immutable
before update or delete on materials.material_revisions
for each row execute function materials.reject_immutable_material_revision_change();

create trigger material_revision_tags_immutable
before update or delete on materials.material_revision_tags
for each row execute function materials.reject_immutable_material_revision_change();

create trigger material_revision_series_memberships_immutable
before update or delete on materials.material_revision_series_memberships
for each row execute function materials.reject_immutable_material_revision_change();

create trigger material_publication_events_immutable
before update or delete on materials.material_publication_events
for each row execute function materials.reject_immutable_material_revision_change();

create trigger material_access_audit_events_immutable
before update or delete on materials.material_access_audit_events
for each row execute function materials.reject_immutable_material_revision_change();
`;
