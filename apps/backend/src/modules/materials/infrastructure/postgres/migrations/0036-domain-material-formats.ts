export const name = "0036_domain_material_formats";

export const statement = `
do $$ begin
  if exists (
    select 1 from materials.formats f
    where f.slug not in ('video', 'guide', 'note', 'text') and (
      exists (select 1 from materials.materials m where m.format_id = f.id) or
      exists (select 1 from materials.published_materials p where p.format_id = f.id)
    )
  ) then raise exception 'Unsupported legacy material format: explicit conversion required'; end if;
end $$;

alter table materials.materials drop constraint materials_format_fk;
alter table materials.published_materials drop constraint published_materials_format_fk;
alter table materials.materials alter column format_id type text using format_id::text;
alter table materials.published_materials alter column format_id type text using format_id::text;

update materials.materials m set format_id = case when f.slug = 'text' then 'note' else f.slug end
from materials.formats f where m.format_id = f.id::text;
update materials.published_materials p set format_id = case when f.slug = 'text' then 'note' else f.slug end
from materials.formats f where p.format_id = f.id::text;

alter table materials.materials add constraint materials_format_check check (format_id in ('video', 'guide', 'note'));
alter table materials.published_materials add constraint published_materials_format_check check (format_id in ('video', 'guide', 'note'));
drop table materials.formats;

update materials.published_materials as publication
set public_search_text = concat_ws(
  ' ',
  topic.name,
  topic.summary,
  case publication.format_id when 'video' then 'Видео' when 'guide' then 'Гайд' when 'note' then 'Заметка' end,
  coalesce(
    (
      select string_agg(tag.name, ' ' order by tag.normalized_name)
      from materials.published_material_tags as membership
      join materials.tags as tag on tag.id = membership.tag_id
      where membership.material_id = publication.material_id
    ),
    ''
  ),
  coalesce(
    (
      select string_agg(
        concat_ws(' ', series.name, series.summary),
        ' ' order by series.name
      )
      from materials.published_material_series_memberships as membership
      join materials.series as series on series.id = membership.series_id
      where membership.material_id = publication.material_id
    ),
    ''
  )
)
from materials.topics as topic
where topic.id = publication.topic_id;

`;
