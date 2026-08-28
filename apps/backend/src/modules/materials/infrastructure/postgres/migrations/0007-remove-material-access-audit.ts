export const name = "0007_remove_material_access_audit";

export const statement = `
  drop table materials.material_access_audit_events;
`;
