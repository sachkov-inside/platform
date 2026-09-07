export const name = "0036_video_upload_rejections";

export const statement = `
alter table videos.upload_attempts
  drop constraint video_upload_attempts_status_check,
  add constraint video_upload_attempts_status_check
    check (status in ('initializing', 'ready', 'unknown', 'rejected')),
  add constraint video_upload_attempts_rejected_shape_check check (
    status <> 'rejected' or (video_id is null and upload_endpoint is null and failure_code is not null and failure_code = 'upload_not_authorized')
  );
`;
