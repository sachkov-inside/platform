export const name = "0022_workshop_video_access";

export const statement = `
  alter table videos.videos
    drop constraint videos_access_check,
    add constraint videos_access_check check (access in ('free', 'membership', 'workshop'));

  alter table videos.upload_attempts
    drop constraint video_upload_attempts_access_check,
    add constraint video_upload_attempts_access_check check (access in ('free', 'membership', 'workshop'));
`;
