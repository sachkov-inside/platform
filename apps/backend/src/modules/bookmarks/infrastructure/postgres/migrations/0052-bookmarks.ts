export const name = "0052_bookmarks";
export const statement = `
CREATE SCHEMA bookmarks;
CREATE TABLE bookmarks.bookmarked_materials (
  account_id uuid NOT NULL,
  material_id uuid NOT NULL,
  bookmarked_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, material_id)
);
CREATE INDEX bookmarked_materials_recent ON bookmarks.bookmarked_materials (account_id, bookmarked_at DESC, material_id);
`;
