export const name = "0021_workshop_material_access";

export const statement = `
  alter table materials.materials
    drop constraint materials_access_check,
    add constraint materials_access_check check (access in ('free', 'membership', 'workshop'));

  alter table materials.published_materials
    drop constraint published_materials_access_check,
    add constraint published_materials_access_check check (access in ('free', 'membership', 'workshop'));
`;
