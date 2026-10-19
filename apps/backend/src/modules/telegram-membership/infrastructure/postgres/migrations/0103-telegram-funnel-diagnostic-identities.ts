export const name = "0103_telegram_funnel_diagnostic_identities";

export const statement = `
create index account_link_states_verified_identity on telegram_membership.account_link_states(identity_ref, account_id) where principal_ref is not null;
`;
