export const name = "0002_identity_principals";

export const statement = `
  create schema identity_principals;

  create table identity_principals.principals (
    id uuid primary key,
    kind text not null,
    state text not null default 'active',
    created_at timestamptz not null default now(),
    security_version integer not null default 1,
    constraint principals_kind_check check (kind in ('human', 'service')),
    constraint principals_state_check check (state in ('active', 'disabled')),
    constraint principals_security_version_positive check (security_version > 0)
  );

  create table identity_principals.external_identities (
    id uuid primary key,
    principal_id uuid not null,
    issuer text not null,
    subject text not null,
    email_fingerprint varchar(67),
    created_at timestamptz not null default now(),
    constraint external_identities_issuer_subject_unique unique (issuer, subject),
    constraint external_identities_email_fingerprint_unique unique (email_fingerprint),
    constraint external_identities_principal_fk foreign key (principal_id)
      references identity_principals.principals (id),
    constraint external_identities_issuer_https check (issuer like 'https://%'),
    constraint external_identities_subject_nonempty check (length(subject) between 1 and 500),
    constraint external_identities_email_fingerprint_v1 check (
      email_fingerprint is null or email_fingerprint ~ '^v1:[0-9a-f]{64}$'
    )
  );

  create table identity_principals.principal_permissions (
    principal_id uuid not null,
    permission text not null,
    created_at timestamptz not null default now(),
    constraint principal_permissions_primary primary key (principal_id, permission),
    constraint principal_permissions_principal_fk foreign key (principal_id)
      references identity_principals.principals (id) on delete cascade,
    constraint principal_permissions_value_check check (
      permission in ('materials:author', 'materials:publish', 'identity:admin')
    )
  );

  create table identity_principals.platform_sessions (
    id uuid primary key,
    principal_id uuid not null,
    created_at timestamptz not null,
    expires_at timestamptz not null,
    authenticated_at timestamptz not null,
    ended_at timestamptz,
    security_version integer not null,
    constraint platform_sessions_principal_fk foreign key (principal_id)
      references identity_principals.principals (id),
    constraint platform_sessions_finite check (expires_at > created_at),
    constraint platform_sessions_max_lifetime check (
      expires_at <= created_at + interval '7 days'
    ),
    constraint platform_sessions_end_after_creation check (
      ended_at is null or ended_at >= created_at
    ),
    constraint platform_sessions_security_version_positive check (security_version > 0)
  );

  create table identity_principals.identity_idempotency (
    operation text not null,
    idempotency_key varchar(200) not null,
    request_fingerprint char(64) not null,
    principal_id uuid,
    session_id uuid,
    created_at timestamptz not null default now(),
    constraint identity_idempotency_primary primary key (operation, idempotency_key),
    constraint identity_idempotency_principal_fk foreign key (principal_id)
      references identity_principals.principals (id),
    constraint identity_idempotency_session_fk foreign key (session_id)
      references identity_principals.platform_sessions (id),
    constraint identity_idempotency_effect_complete check (
      (principal_id is null) = (session_id is null)
    )
  );

  create table identity_principals.identity_reauthentication_attempts (
    id uuid primary key,
    session_id uuid not null,
    created_at timestamptz not null,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    token_fingerprint char(64) unique,
    begin_idempotency_key varchar(200) not null unique,
    begin_request_fingerprint char(64) not null,
    complete_idempotency_key varchar(200) unique,
    complete_request_fingerprint char(64),
    constraint identity_reauthentication_session_fk foreign key (session_id)
      references identity_principals.platform_sessions (id),
    constraint identity_reauthentication_finite check (
      expires_at > created_at and expires_at <= created_at + interval '5 minutes'
    ),
    constraint identity_reauthentication_completion_complete check (
      (consumed_at is null and token_fingerprint is null and
        complete_idempotency_key is null and complete_request_fingerprint is null)
      or
      (consumed_at is not null and token_fingerprint is not null and
        complete_idempotency_key is not null and complete_request_fingerprint is not null)
    )
  );

  create table identity_principals.identity_audit_events (
    id uuid primary key,
    operation text not null,
    outcome text not null,
    principal_id uuid,
    session_id uuid,
    created_at timestamptz not null default now(),
    constraint identity_audit_principal_fk foreign key (principal_id)
      references identity_principals.principals (id),
    constraint identity_audit_session_fk foreign key (session_id)
      references identity_principals.platform_sessions (id)
  );
`;
