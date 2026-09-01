export const name = "0015_profile_avatars";

export const statement = `
  create table member_profiles.avatars (
    id uuid primary key,
    account_id uuid not null,
    state text not null,
    failure_code varchar(64),
    currently_referenced boolean not null default false,
    orphaned_at timestamptz not null default now(),
    cleanup_claimed_at timestamptz,
    ready_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profile_avatars_profile_fk foreign key (account_id)
      references member_profiles.profiles (account_id) on delete cascade,
    constraint profile_avatars_state_check check (
      state in ('processing', 'ready', 'failed')
    ),
    constraint profile_avatars_id_account_unique unique (id, account_id)
  );

  create table member_profiles.avatar_renditions (
    avatar_id uuid not null,
    size integer not null,
    content_type varchar(255) not null,
    byte_size integer not null,
    checksum_sha256 char(64) not null,
    protected_object_key varchar(512) not null,
    constraint profile_avatar_renditions_primary primary key (avatar_id, size),
    constraint profile_avatar_renditions_avatar_fk foreign key (avatar_id)
      references member_profiles.avatars (id) on delete cascade,
    constraint profile_avatar_renditions_size_check check (size in (160, 320, 640)),
    constraint profile_avatar_renditions_content_type_check check (
      content_type = 'image/webp'
    ),
    constraint profile_avatar_renditions_byte_size_positive check (byte_size > 0),
    constraint profile_avatar_renditions_checksum_check check (
      checksum_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

  alter table member_profiles.profiles
    add column avatar_id uuid,
    add constraint member_profiles_avatar_account_unique unique (avatar_id, account_id),
    add constraint member_profiles_current_avatar_fk foreign key (avatar_id, account_id)
      references member_profiles.avatars (id, account_id);

  create index profile_avatars_cleanup_idx
    on member_profiles.avatars (orphaned_at, updated_at);

  alter table member_profiles.audit_events
    drop constraint member_profile_audit_event_check,
    add constraint member_profile_audit_event_check check (
      event in (
        'profile_created',
        'profile_updated',
        'profile_deleted',
        'profile_disabled',
        'profile_restored',
        'profile_reported',
        'avatar_uploaded',
        'avatar_replaced',
        'avatar_removed'
      )
    );
`;
