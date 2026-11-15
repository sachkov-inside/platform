export const name = "0128_drop_mode_variants";

/**
 * Contract step of the retired reading modes (#2119, #2140). The application stopped reading and
 * writing the flag in v82 (#2118); on 2026-11-15 the owner ruled out a rollback to v81 or earlier.
 * Irreversible.
 */
export const statement = `
alter table materials.published_materials drop column has_mode_variants;
`;
