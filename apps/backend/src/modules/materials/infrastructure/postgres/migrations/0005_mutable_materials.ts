export const name = "0005_mutable_materials";

export const statement = `
create temporary table mutable_material_sources on commit drop as
select
  materials.id as material_id,
  coalesce(
    materials.current_published_revision_id,
    materials.current_draft_revision_id
  ) as revision_id
from materials.materials as materials;

create temporary table mutable_material_search_documents on commit drop as
select search_documents.material_id, search_documents.plain_text
from materials.material_search_documents as search_documents
inner join materials.materials as materials
  on materials.id = search_documents.material_id
 and materials.current_published_revision_id = search_documents.revision_id;

alter table materials.materials
  alter column slug drop not null,
  add column title text,
  add column summary text,
  add column topic_id uuid,
  add column format_id uuid,
  add column schema_version smallint,
  add column body jsonb,
  add column created_by uuid,
  add column access text,
  add column publication_state text,
  add column content_version bigint,
  add column first_published_at timestamptz,
  add column published_at timestamptz,
  add column published_by uuid;

update materials.materials as materials
set
  slug = revision.slug,
  title = revision.title,
  summary = revision.summary,
  topic_id = revision.topic_id,
  format_id = revision.format_id,
  schema_version = revision.schema_version,
  body = revision.body,
  created_by = revision.created_by,
  access = revision.access,
  publication_state = case
    when materials.current_published_revision_id is not null then 'published'
    when exists (
      select 1
      from materials.material_publication_events as event
      where event.material_id = materials.id
        and event.kind = 'publish'
    ) then 'unpublished'
    else 'draft'
  end,
  content_version = 1,
  first_published_at = (
    select min(event.created_at)
    from materials.material_publication_events as event
    where event.material_id = materials.id
      and event.kind = 'publish'
  ),
  published_at = coalesce(
    (
      select projection.published_at
      from materials.published_materials as projection
      where projection.material_id = materials.id
    ),
    (
      select max(event.created_at)
      from materials.material_publication_events as event
      where event.material_id = materials.id
        and event.kind = 'publish'
    )
  ),
  published_by = coalesce(
    (
      select projection.published_by
      from materials.published_materials as projection
      where projection.material_id = materials.id
    ),
    (
      select event.actor_id
      from materials.material_publication_events as event
      where event.material_id = materials.id
        and event.kind = 'publish'
      order by event.created_at desc, event.id desc
      limit 1
    )
  )
from mutable_material_sources as source
inner join materials.material_revisions as revision
  on revision.material_id = source.material_id
 and revision.id = source.revision_id
where materials.id = source.material_id;

delete from materials.material_tags;
insert into materials.material_tags (material_id, tag_id)
select source.material_id, revision_tag.tag_id
from mutable_material_sources as source
inner join materials.material_revision_tags as revision_tag
  on revision_tag.material_id = source.material_id
 and revision_tag.revision_id = source.revision_id;

delete from materials.series_memberships;
insert into materials.series_memberships (series_id, material_id, ordinal)
select revision_series.series_id, source.material_id, revision_series.ordinal
from mutable_material_sources as source
inner join materials.material_revision_series_memberships as revision_series
  on revision_series.material_id = source.material_id
 and revision_series.revision_id = source.revision_id;

drop table materials.material_search_documents;
drop table materials.published_material_series_memberships;
drop table materials.published_material_tags;
drop table materials.published_materials;
drop table materials.material_access_audit_events;
drop table materials.authoring_idempotency;
drop table materials.material_publication_events;
drop table materials.material_revision_series_memberships;
drop table materials.material_revision_tags;

alter table materials.materials
  drop constraint materials_current_draft_revision_fk,
  drop constraint materials_current_published_revision_fk,
  drop column current_draft_revision_id,
  drop column current_published_revision_id;

drop table materials.material_revisions;
drop function materials.reject_immutable_material_revision_change();

alter table materials.materials
  alter column schema_version set not null,
  alter column body set not null,
  alter column created_by set not null,
  alter column access set not null,
  alter column publication_state set not null,
  alter column content_version set not null,
  add constraint materials_topic_fk foreign key (topic_id)
    references materials.topics (id),
  add constraint materials_format_fk foreign key (format_id)
    references materials.formats (id),
  add constraint materials_schema_version_check check (schema_version = 1),
  add constraint materials_access_check check (access in ('free', 'membership')),
  add constraint materials_publication_state_check check (
    publication_state in ('draft', 'published', 'unpublished')
  ),
  add constraint materials_content_version_positive check (content_version > 0),
  add constraint materials_publication_history_complete check (
    (
      publication_state = 'draft'
      and first_published_at is null
      and published_at is null
      and published_by is null
    ) or (
      publication_state in ('published', 'unpublished')
      and first_published_at is not null
      and published_at is not null
      and published_by is not null
    )
  ),
  add constraint materials_published_fields_complete check (
    publication_state <> 'published' or (
      title is not null
      and summary is not null
      and slug is not null
      and topic_id is not null
      and format_id is not null
    )
  ),
  add constraint materials_id_content_version_unique unique (id, content_version);

create function materials.reject_published_material_slug_change()
returns trigger
language plpgsql
as $$
begin
  if old.first_published_at is not null and new.slug is distinct from old.slug then
    raise exception 'published Material slug is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger materials_published_slug_immutable
before update of slug on materials.materials
for each row execute function materials.reject_published_material_slug_change();

create table materials.authoring_idempotency (
  actor_id uuid not null,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint char(64) not null,
  material_id uuid,
  content_version bigint,
  publication_state text,
  published_at timestamptz,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint authoring_idempotency_primary primary key (
    actor_id,
    operation,
    idempotency_key
  ),
  constraint authoring_idempotency_operation_check check (
    operation in ('create_draft', 'save_material', 'delete_draft')
  ),
  constraint authoring_idempotency_publication_state_check check (
    publication_state is null or
    publication_state in ('draft', 'published', 'unpublished')
  ),
  constraint authoring_idempotency_effect_complete check (
    (
      material_id is null
      and content_version is null
      and publication_state is null
      and published_at is null
      and deleted = false
    ) or (
      material_id is not null
      and content_version is not null
      and publication_state is not null
      and deleted = false
    ) or (
      material_id is not null
      and content_version is null
      and publication_state is null
      and published_at is null
      and deleted = true
    )
  )
);

create table materials.published_materials (
  material_id uuid primary key,
  content_version bigint not null,
  slug text not null constraint published_materials_slug_unique unique,
  title text not null,
  summary text not null,
  access text not null,
  topic_id uuid not null,
  format_id uuid not null,
  published_by uuid not null,
  published_at timestamptz not null,
  constraint published_materials_current_material_fk foreign key (
    material_id,
    content_version
  ) references materials.materials (id, content_version)
    deferrable initially deferred,
  constraint published_materials_topic_fk foreign key (topic_id)
    references materials.topics (id),
  constraint published_materials_format_fk foreign key (format_id)
    references materials.formats (id),
  constraint published_materials_slug_normalized check (slug = lower(btrim(slug))),
  constraint published_materials_access_check check (access in ('free', 'membership'))
);

create index published_materials_cursor_idx
  on materials.published_materials (published_at desc, material_id desc);

insert into materials.published_materials (
  material_id,
  content_version,
  slug,
  title,
  summary,
  access,
  topic_id,
  format_id,
  published_by,
  published_at
)
select
  id,
  content_version,
  slug,
  title,
  summary,
  access,
  topic_id,
  format_id,
  published_by,
  published_at
from materials.materials
where publication_state = 'published';

create table materials.published_material_tags (
  material_id uuid not null,
  tag_id uuid not null,
  constraint published_material_tags_primary primary key (material_id, tag_id),
  constraint published_material_tags_material_fk foreign key (material_id)
    references materials.published_materials (material_id) on delete cascade,
  constraint published_material_tags_tag_fk foreign key (tag_id)
    references materials.tags (id)
);

insert into materials.published_material_tags (material_id, tag_id)
select material_tags.material_id, material_tags.tag_id
from materials.material_tags as material_tags
inner join materials.published_materials as published
  on published.material_id = material_tags.material_id;

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

insert into materials.published_material_series_memberships (
  material_id,
  series_id,
  ordinal
)
select memberships.material_id, memberships.series_id, memberships.ordinal
from materials.series_memberships as memberships
inner join materials.published_materials as published
  on published.material_id = memberships.material_id;

create table materials.material_search_documents (
  material_id uuid primary key,
  content_version bigint not null,
  plain_text text not null,
  constraint material_search_documents_current_material_fk foreign key (
    material_id,
    content_version
  ) references materials.materials (id, content_version)
    deferrable initially deferred
);

insert into materials.material_search_documents (
  material_id,
  content_version,
  plain_text
)
select migrated.material_id, material.content_version, migrated.plain_text
from mutable_material_search_documents as migrated
inner join materials.materials as material on material.id = migrated.material_id
where material.publication_state = 'published';

create table materials.material_access_audit_events (
  id uuid primary key,
  material_id uuid not null,
  content_version bigint not null,
  actor_id uuid,
  action text not null,
  decision text not null,
  created_at timestamptz not null default now(),
  constraint material_access_audit_events_material_fk foreign key (material_id)
    references materials.materials (id) on delete cascade,
  constraint material_access_audit_events_action_check check (
    action in ('preview', 'read')
  ),
  constraint material_access_audit_events_decision_check check (
    decision in ('allow', 'deny')
  )
);
`;
