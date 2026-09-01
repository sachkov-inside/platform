export const name = "0012_remove_member_profile_reports";

export const statement = `
  drop table member_profiles.reports;
`;
