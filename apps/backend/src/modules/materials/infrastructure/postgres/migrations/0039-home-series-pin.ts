export const name = "0039_home_series_pin";

export const statement = `
alter table materials.home_material_pin rename to home_series_pin;
alter table materials.home_series_pin drop column material_id;
alter table materials.home_series_pin add column series_id uuid references materials.series(id);
update materials.home_series_pin set version = version + 1;
`;
