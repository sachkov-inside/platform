export const name = "0065_authoring_source";

export const statement = `
alter table materials.series add column source_id text, add constraint series_source_id_unique unique (source_id);

alter table materials.materials
  add column video_chapters jsonb not null default '[]'::jsonb,
  add column source_id text,
  add column source_path text,
  add column source_revision text,
  add column show_in_feed boolean not null default true,
  add constraint materials_source_id_unique unique (source_id),
  add constraint materials_source_complete check (
    (source_id is null and source_path is null and source_revision is null)
    or (source_id is not null and source_path is not null and source_revision is not null)
  );
`;
