export const name = "0114_billing_contact_email_fingerprint";
export const statement = `
alter table accounts.billing_contacts
  add column email_fingerprint varchar(67),
  add column email_fingerprint_revision integer,
  add constraint billing_contacts_email_fingerprint_revision_check check (
    (email_fingerprint is null) = (email_fingerprint_revision is null)
  );
create index billing_contacts_email_fingerprint
  on accounts.billing_contacts (email_fingerprint)
  where email_fingerprint is not null;
`;
