export const name = "0003_published_materials_cursor_index";

export const statement = `
  create index published_materials_cursor_idx
    on materials.published_materials (published_at desc, material_id desc);
`;
