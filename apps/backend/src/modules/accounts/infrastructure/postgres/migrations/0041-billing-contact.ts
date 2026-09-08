export const name = "0041_billing_contact";
export const statement = `
create table accounts.billing_contacts (
 account_id uuid primary key references accounts.accounts(id),
 revision integer not null default 0 check (revision >= 0),
 email_ciphertext text,
 verified_at timestamptz,
 challenge_ref uuid,
 check ((revision = 0 and email_ciphertext is null and verified_at is null) or
        (revision > 0 and email_ciphertext is not null and verified_at is not null))
);
create table accounts.billing_contact_challenges (
 id uuid primary key,
 account_id uuid not null references accounts.accounts(id),
 operation_id uuid not null,
 fingerprint text not null,
 recipient_fingerprint text not null,
 email_ciphertext text not null,
 code_digest text not null,
 base_revision integer not null check (base_revision >= 0),
 attempts integer not null default 0 check (attempts between 0 and 5),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 confirmed_at timestamptz,
 delivery text not null check (delivery in ('unknown','sent')),
 unique(account_id, operation_id),
 check (expires_at > created_at)
);
create index billing_contact_challenges_account_time on accounts.billing_contact_challenges(account_id, created_at);
create index billing_contact_challenges_recipient_time on accounts.billing_contact_challenges(recipient_fingerprint, created_at);
create table accounts.billing_contact_commands (
 account_id uuid not null references accounts.accounts(id),
 operation_id uuid not null,
 fingerprint text not null,
 result jsonb not null,
 primary key(account_id, operation_id)
);
create table accounts.billing_consent_evidence (
 id uuid primary key,
 account_id uuid not null references accounts.accounts(id),
 operation_id uuid not null,
 context_ref uuid not null,
 kind text not null check (kind in ('terms','recurring','personal_data','marketing')),
 document_id text not null,
 document_version text not null,
 document_digest text not null,
 document_text text not null,
 document_url text not null,
 accepted_at timestamptz not null,
 unique(account_id, operation_id, kind)
);
create function accounts.reject_consent_rewrite() returns trigger language plpgsql as $$
begin raise exception 'Consent evidence is immutable'; end;
$$;
create trigger billing_consent_evidence_immutable before update or delete on accounts.billing_consent_evidence
 for each row execute function accounts.reject_consent_rewrite();
`;
