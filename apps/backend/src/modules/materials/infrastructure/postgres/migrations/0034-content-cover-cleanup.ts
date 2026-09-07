export const name = "0034_content_cover_cleanup";

export const statement = `
-- Keep the immutable storage keys until the worker deletes every rendition.
-- Owner identity remains on the row even after that owner has been deleted.
alter table materials.content_covers
  drop constraint content_covers_material_owner_fk,
  drop constraint content_covers_topic_owner_fk,
  drop constraint content_covers_series_owner_fk;

alter table materials.content_covers
  add column upload_confirmed boolean not null default false;

-- These states are reached only after every PUT has succeeded. Other legacy
-- rows retain their keys because a failed request can still write remotely.
update materials.content_covers
set upload_confirmed = true
where state = 'ready' or failure_code in ('owner_not_found', 'conflict');
`;
