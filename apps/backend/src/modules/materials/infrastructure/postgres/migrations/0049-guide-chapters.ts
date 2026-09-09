export const name = "0049_guide_chapters";

export const statement = `
create table materials.guide_chapters (
  id uuid not null,
  guide_id uuid not null,
  name text not null,
  summary text not null default '',
  ordinal integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_chapters_primary primary key (id),
  constraint guide_chapters_guide_fk foreign key (guide_id)
    references materials.series (id) on delete cascade,
  constraint guide_chapters_identity_unique unique (id, guide_id),
  constraint guide_chapters_ordinal_unique unique (guide_id, ordinal)
    deferrable initially deferred,
  constraint guide_chapters_ordinal_positive check (ordinal > 0),
  constraint guide_chapters_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  constraint guide_chapters_summary_valid check (
    summary = btrim(summary) and char_length(summary) <= 4000
  )
);

create index guide_chapters_guide_ordinal_idx
  on materials.guide_chapters (guide_id, ordinal);

alter table materials.series_memberships
  add column chapter_id uuid,
  add constraint series_memberships_chapter_fk
    foreign key (chapter_id, series_id)
    references materials.guide_chapters (id, guide_id)
    on delete set null (chapter_id);

create index series_memberships_chapter_idx
  on materials.series_memberships (chapter_id, ordinal)
  where chapter_id is not null;
`;
