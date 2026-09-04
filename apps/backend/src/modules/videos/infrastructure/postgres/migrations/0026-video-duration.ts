export const name = "0026_video_duration";

export const statement = `
alter table videos.videos
  add column duration_seconds integer,
  add constraint videos_duration_seconds_positive check (
    duration_seconds is null or duration_seconds > 0
  );
`;
