export const name = "0027_current_collection_search";

export const statement = `
update materials.published_materials as publication
set public_search_text = concat_ws(
  ' ',
  topic.name,
  topic.summary,
  format.name,
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
from materials.topics as topic, materials.formats as format
where topic.id = publication.topic_id
  and format.id = publication.format_id;
`;
