export const name = "0038_home_material_pin";

export const statement = `
create table materials.home_material_pin (
  id integer primary key check (id = 1),
  material_id uuid references materials.materials(id),
  version integer not null default 1 check (version > 0)
);
insert into materials.home_material_pin (id) values (1);
`;
