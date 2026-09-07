export const name = "0034_content_cover_cleanup";

export const statement = `
-- Keep the immutable storage keys until the worker deletes every rendition.
-- Owner identity remains on the row even after that owner has been deleted.
alter table materials.content_covers
  drop constraint content_covers_material_owner_fk,
  drop constraint content_covers_topic_owner_fk,
  drop constraint content_covers_series_owner_fk;
`;
