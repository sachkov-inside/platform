export const name = "0018_durable_video_upload_attempts";

export const statement = `
  alter table videos.upload_attempts
    alter column video_id drop not null,
    alter column upload_endpoint drop not null,
    add column access text,
    add column project_id varchar(128),
    add column title varchar(255),
    add column status text,
    add column failure_code varchar(64),
    add column updated_at timestamptz;

  update videos.upload_attempts as upload_attempt
  set
    access = video.access,
    project_id = video.project_id,
    title = video.title,
    status = 'ready',
    updated_at = upload_attempt.created_at
  from videos.videos as video
  where video.id = upload_attempt.video_id;

  alter table videos.upload_attempts
    alter column access set not null,
    alter column project_id set not null,
    alter column title set not null,
    alter column status set not null,
    alter column updated_at set not null,
    alter column updated_at set default now(),
    add constraint video_upload_attempts_access_check check (access in ('free', 'membership')),
    add constraint video_upload_attempts_status_check check (status in ('initializing', 'ready', 'unknown')),
    add constraint video_upload_attempts_ready_shape_check check (
      status <> 'ready' or (video_id is not null and upload_endpoint is not null)
    );

  create unique index video_upload_attempts_one_unresolved_idx
    on videos.upload_attempts (material_id, created_by)
    where status in ('initializing', 'unknown');
`;
