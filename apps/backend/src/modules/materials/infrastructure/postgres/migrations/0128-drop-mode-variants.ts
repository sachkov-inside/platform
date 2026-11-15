export const name = "0128_drop_mode_variants";

/**
 * Contract step of the retired reading modes (#2119, #2140). Since v82 no application version
 * reads or writes the flag, and the owner no longer needs a rollback to v81. Irreversible.
 */
export const statement = `
alter table materials.published_materials drop column has_mode_variants;
`;
