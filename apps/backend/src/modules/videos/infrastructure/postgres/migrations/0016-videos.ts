export const name = "0016_videos";

export const statement = `
  create schema videos;

  create table videos.videos (
    id uuid primary key,
    material_id uuid not null,
    created_by uuid not null,
    access text not null,
    project_id varchar(128) not null,
    provider_video_id varchar(256) not null,
    title varchar(255) not null,
    original_filename varchar(255),
    provider_embed_locator varchar(2048),
    provider_status varchar(64) not null,
    state text not null,
    failure_code varchar(64),
    provider_message varchar(500),
    ready_at timestamptz,
    last_synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint videos_access_check check (access in ('free', 'membership')),
    constraint videos_state_check check (state in ('uploading', 'processing', 'ready', 'failed')),
    constraint videos_ready_shape_check check (
      state <> 'ready' or (provider_embed_locator is not null and ready_at is not null)
    ),
    constraint videos_provider_identity_unique unique (provider_video_id, project_id),
    constraint videos_reference_identity_unique unique (id, material_id, access)
  );
  create index videos_material_state_idx on videos.videos (material_id, state);

  create table videos.upload_attempts (
    id uuid primary key,
    video_id uuid references videos.videos(id) on delete cascade,
    material_id uuid not null,
    created_by uuid not null,
    idempotency_key varchar(128) not null,
    access text not null,
    project_id varchar(128) not null,
    title varchar(255) not null,
    status text not null,
    upload_endpoint varchar(2048),
    failure_code varchar(64),
    filename varchar(255) not null,
    byte_size bigint not null check (byte_size > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint video_upload_attempts_access_check check (access in ('free', 'membership')),
    constraint video_upload_attempts_status_check check (status in ('initializing', 'ready', 'unknown')),
    constraint video_upload_attempts_ready_shape_check check (
      status <> 'ready' or (video_id is not null and upload_endpoint is not null)
    ),
    constraint video_upload_attempts_idempotency_unique unique (material_id, created_by, idempotency_key)
  );

  create unique index video_upload_attempts_one_unresolved_idx
    on videos.upload_attempts (material_id, created_by)
    where status in ('initializing', 'unknown');

  create table videos.webhook_inbox (
    id uuid primary key,
    provider_video_id varchar(256) not null,
    event varchar(128) not null,
    provider_status varchar(64),
    received_at timestamptz not null default now(),
    reconciled_at timestamptz
  );
  create index video_webhook_inbox_provider_idx
    on videos.webhook_inbox (provider_video_id, received_at desc);

  create table videos.playback_progress (
    account_id uuid not null,
    video_id uuid not null references videos.videos(id) on delete cascade,
    position_seconds integer not null check (position_seconds >= 0),
    duration_seconds integer not null check (duration_seconds > 0),
    updated_at timestamptz not null default now(),
    constraint video_playback_progress_position_check check (position_seconds <= duration_seconds),
    constraint video_playback_progress_primary primary key (account_id, video_id)
  );
`;
