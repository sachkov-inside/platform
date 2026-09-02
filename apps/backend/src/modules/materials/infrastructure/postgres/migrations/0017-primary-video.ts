export const name = "0017_primary_video";

export const statement = `
  do $$
  begin
    if exists (
      select 1
      from materials.materials
      where jsonb_path_exists(body, '$.** ? (@.type == "video")')
    ) then
      raise exception using
        message = 'legacy inline video nodes require an explicit no-loss migration before 0017_primary_video';
    end if;
  end $$;

  alter table materials.materials add column primary_video_id uuid;
  alter table materials.published_materials add column primary_video_id uuid;
`;
