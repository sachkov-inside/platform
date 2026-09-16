export const name = "0065_video_detachment";

export const statement = `
alter table videos.videos
  add column detached_at timestamptz;
`;
