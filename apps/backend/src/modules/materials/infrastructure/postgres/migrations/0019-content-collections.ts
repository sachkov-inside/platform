export const name = "0019_content_collections";

export const statement = `
alter table materials.topics
  add column summary text not null default '',
  add column archived_at timestamptz,
  add column version integer not null default 1,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint topics_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  add constraint topics_slug_length check (char_length(slug) between 1 and 120),
  add constraint topics_summary_valid check (
    summary = btrim(summary) and char_length(summary) <= 500
  ),
  add constraint topics_version_positive check (version > 0);

alter table materials.series
  add column summary text not null default '',
  add column archived_at timestamptz,
  add column version integer not null default 1,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint series_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  add constraint series_slug_length check (char_length(slug) between 1 and 120),
  add constraint series_summary_valid check (
    summary = btrim(summary) and char_length(summary) <= 500
  ),
  add constraint series_version_positive check (version > 0);

create index topics_active_name_idx
  on materials.topics (name, id)
  where archived_at is null;

create index series_active_name_idx
  on materials.series (name, id)
  where archived_at is null;
`;
