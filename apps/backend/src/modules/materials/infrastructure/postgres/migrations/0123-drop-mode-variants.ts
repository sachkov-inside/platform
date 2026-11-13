export const name = "0123_drop_mode_variants";

/** The variant step was retired with the reading modes (#2119), so no lesson carries one. */
export const statement = `
alter table materials.published_materials drop column has_mode_variants;
`;
