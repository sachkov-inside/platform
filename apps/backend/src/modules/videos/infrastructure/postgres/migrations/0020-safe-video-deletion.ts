export const name = "0020_safe_video_deletion";

export const statement = `
  alter table videos.videos
    add column origin text,
    add column provider_visible_at timestamptz,
    add column deleted_at timestamptz;

  update videos.videos as video
  set
    origin = case
      when exists (
        select 1
        from videos.upload_attempts as upload_attempt
        where upload_attempt.video_id = video.id
      ) then 'platform_upload'
      else 'external_attachment'
    end,
    provider_visible_at = case
      when exists (
        select 1
        from videos.upload_attempts as upload_attempt
        where upload_attempt.video_id = video.id
      ) then video.created_at
      else video.last_synced_at
    end;

  alter table videos.videos
    alter column origin set not null,
    drop constraint videos_state_check,
    add constraint videos_origin_check check (
      origin in ('platform_upload', 'external_attachment')
    ),
    add constraint videos_state_check check (
      state in (
        'uploading',
        'processing',
        'ready',
        'failed',
        'deletion_requested',
        'deleting',
        'deleted',
        'delete_failed'
      )
    ),
    add constraint videos_deleted_shape_check check (
      (state = 'deleted' and deleted_at is not null and provider_embed_locator is null)
      or (state <> 'deleted' and deleted_at is null)
    ),
    add constraint videos_deletion_identity_unique unique (id, material_id);

  create function videos.reject_video_origin_change()
  returns trigger
  language plpgsql
  as $$
  begin
    if new.origin is distinct from old.origin then
      raise exception 'Video origin is immutable' using errcode = '23514';
    end if;
    return new;
  end;
  $$;

  create trigger videos_origin_immutable
    before update of origin on videos.videos
    for each row
    execute function videos.reject_video_origin_change();

  create table videos.deletion_operations (
    id uuid primary key,
    video_id uuid not null,
    material_id uuid not null,
    requested_by uuid not null,
    state text not null,
    requested_at timestamptz not null,
    claimed_at timestamptz,
    completed_at timestamptz,
    attempts integer not null default 0,
    cycle_attempts integer not null default 0,
    next_attempt_at timestamptz not null,
    last_error_category varchar(64),
    provider_request_id varchar(256),
    updated_at timestamptz not null,
    constraint video_deletion_operations_video_unique unique (video_id),
    constraint video_deletion_operations_video_material_unique
      unique (video_id, material_id),
    constraint video_deletion_operations_video_material_fk
      foreign key (video_id, material_id)
      references videos.videos (id, material_id)
      on delete restrict,
    constraint video_deletion_operations_state_check check (
      state in ('deletion_requested', 'deleting', 'deleted', 'delete_failed')
    ),
    constraint video_deletion_operations_attempts_check check (attempts >= 0),
    constraint video_deletion_operations_cycle_attempts_check check (cycle_attempts >= 0),
    constraint video_deletion_operations_claimed_shape_check check (
      state <> 'deleting' or (claimed_at is not null and attempts > 0 and cycle_attempts > 0)
    ),
    constraint video_deletion_operations_completed_shape_check check (
      (state = 'deleted' and completed_at is not null)
      or (state <> 'deleted' and completed_at is null)
    )
  );

  create index video_deletion_operations_claim_idx
    on videos.deletion_operations (state, next_attempt_at, requested_at);
`;
