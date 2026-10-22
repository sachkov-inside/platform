export const name = "0103_material_source_commit";
export const statement = `
ALTER TABLE materials.materials
  ADD COLUMN source_commit char(40),
  ADD CONSTRAINT materials_source_commit_valid CHECK (source_commit ~ '^[0-9a-f]{40}$');
`;
