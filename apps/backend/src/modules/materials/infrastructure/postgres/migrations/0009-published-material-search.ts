export const name = "0009_published_material_search";

export const statement = `
  alter table materials.published_materials
    add column public_search_text text not null default '';

  update materials.published_materials as publication
  set public_search_text = concat_ws(
    ' ',
    topic.name,
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
        select string_agg(series.name, ' ' order by series.name)
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

  alter table materials.published_materials
    add column search_vector tsvector generated always as (
      setweight(
        to_tsvector('russian'::regconfig, coalesce(title, '')) ||
        to_tsvector('english'::regconfig, coalesce(title, '')) ||
        to_tsvector('simple'::regconfig, coalesce(title, '')),
        'A'
      ) ||
      setweight(
        to_tsvector('russian'::regconfig, coalesce(summary, '')) ||
        to_tsvector('english'::regconfig, coalesce(summary, '')) ||
        to_tsvector('simple'::regconfig, coalesce(summary, '')),
        'B'
      ) ||
      setweight(
        to_tsvector('russian'::regconfig, coalesce(public_search_text, '')) ||
        to_tsvector('english'::regconfig, coalesce(public_search_text, '')) ||
        to_tsvector('simple'::regconfig, coalesce(public_search_text, '')),
        'C'
      )
    ) stored;

  create index published_materials_search_vector_idx
    on materials.published_materials using gin (search_vector);
  create index published_materials_topic_cursor_idx
    on materials.published_materials (topic_id, published_at desc, material_id desc);
  create index published_materials_format_cursor_idx
    on materials.published_materials (format_id, published_at desc, material_id desc);
  create index published_material_series_lookup_idx
    on materials.published_material_series_memberships (series_id, material_id);
`;
