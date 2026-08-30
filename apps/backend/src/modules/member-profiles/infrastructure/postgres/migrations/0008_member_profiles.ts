export const name = "0008_member_profiles";

export const statement = `
  create schema member_profiles;

  create table member_profiles.profiles (
    account_id uuid primary key,
    public_profile_id uuid not null,
    display_name varchar(80) not null,
    bio varchar(500),
    status text not null,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint member_profiles_account_fk foreign key (account_id)
      references accounts.accounts (id) on delete cascade,
    constraint member_profiles_public_profile_id_unique unique (public_profile_id),
    constraint member_profiles_display_name_length check (
      char_length(display_name) between 2 and 80
    ),
    constraint member_profiles_bio_length check (
      bio is null or char_length(bio) between 1 and 500
    ),
    constraint member_profiles_status_check check (status in ('active', 'disabled')),
    constraint member_profiles_version_positive check (version > 0)
  );

  create table member_profiles.audit_events (
    id uuid primary key,
    event text not null,
    account_id uuid not null,
    public_profile_id uuid not null,
    created_at timestamptz not null default now(),
    constraint member_profile_audit_event_check check (
      event in (
        'profile_created',
        'profile_updated',
        'profile_deleted',
        'profile_disabled',
        'profile_restored',
        'profile_reported'
      )
    )
  );

  create index member_profile_audit_account_created_idx
    on member_profiles.audit_events (account_id, created_at desc);

  create table member_profiles.reports (
    id uuid primary key,
    public_profile_id uuid not null,
    reporter_account_id uuid not null,
    reason text not null,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint member_profile_reports_profile_fk foreign key (public_profile_id)
      references member_profiles.profiles (public_profile_id) on delete cascade,
    constraint member_profile_reports_reporter_fk foreign key (reporter_account_id)
      references accounts.accounts (id) on delete cascade,
    constraint member_profile_reports_reason_check check (
      reason in ('unsafe_content', 'impersonation', 'other')
    ),
    constraint member_profile_reports_status_check check (status in ('open', 'resolved')),
    constraint member_profile_reports_reporter_unique unique (
      public_profile_id,
      reporter_account_id
    )
  );

  create index member_profile_reports_status_created_idx
    on member_profiles.reports (status, created_at);
`;
