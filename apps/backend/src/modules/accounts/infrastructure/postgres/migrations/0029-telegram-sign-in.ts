export const name = "0029_telegram_sign_in";
export const statement = `
alter table accounts.accounts add column telegram_subject_ref uuid;
create unique index accounts_telegram_subject_unique on accounts.accounts (telegram_subject_ref);
`;
