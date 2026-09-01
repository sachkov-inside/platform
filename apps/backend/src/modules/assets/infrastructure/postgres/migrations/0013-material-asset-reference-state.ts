export const name = "0013_material_asset_reference_state";

export const statement = `
  alter table assets.material_assets
    add column currently_referenced boolean not null default false;
`;
