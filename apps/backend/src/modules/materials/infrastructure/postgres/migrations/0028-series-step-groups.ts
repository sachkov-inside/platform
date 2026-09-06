export const name = "0028_series_step_groups";
export const statement = `
alter table materials.series_memberships
  add column step_group text,
  add constraint series_memberships_step_group_nonempty
    check (step_group is null or length(btrim(step_group)) > 0);
`;
