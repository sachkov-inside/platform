export const name = "0004_accounts";

export const statement = `
  create schema accounts;

  create table accounts.accounts (
    id uuid primary key,
    logto_issuer text not null,
    logto_subject text not null,
    email_fingerprint varchar(67),
    created_at timestamptz not null default now(),
    constraint accounts_logto_identity_unique unique (logto_issuer, logto_subject),
    constraint accounts_email_fingerprint_unique unique (email_fingerprint),
    constraint accounts_logto_issuer_https check (logto_issuer like 'https://%'),
    constraint accounts_logto_subject_nonempty check (length(logto_subject) between 1 and 500),
    constraint accounts_email_fingerprint_v1 check (
      email_fingerprint is null or
      (length(email_fingerprint) = 67 and starts_with(email_fingerprint, 'v1:'))
    )
  );

  create table accounts.account_permissions (
    account_id uuid not null,
    permission text not null,
    created_at timestamptz not null default now(),
    constraint account_permissions_primary primary key (account_id, permission),
    constraint account_permissions_account_fk foreign key (account_id)
      references accounts.accounts (id) on delete cascade,
    constraint account_permissions_value_check check (permission = 'materials:manage')
  );

  create table accounts.account_audit_events (
    id uuid primary key,
    event text not null,
    account_id uuid,
    created_at timestamptz not null default now(),
    constraint account_audit_account_fk foreign key (account_id)
      references accounts.accounts (id),
    constraint account_audit_event_check check (
      event in (
        'account_created',
        'duplicate_identity_rejected',
        'owner_bootstrap_completed',
        'permission_granted',
        'permission_revoked'
      )
    )
  );

  insert into accounts.accounts (
    id,
    logto_issuer,
    logto_subject,
    email_fingerprint,
    created_at
  )
  select
    principals.id,
    external_identities.issuer,
    external_identities.subject,
    external_identities.email_fingerprint,
    principals.created_at
  from identity_principals.principals as principals
  inner join identity_principals.external_identities as external_identities
    on external_identities.principal_id = principals.id
  where principals.kind = 'human';

  insert into accounts.account_permissions (account_id, permission, created_at)
  select principal_id, 'materials:manage', min(created_at)
  from identity_principals.principal_permissions
  where permission in ('materials:author', 'materials:publish')
    and principal_id in (select id from accounts.accounts)
  group by principal_id;

  drop schema identity_principals cascade;
`;
