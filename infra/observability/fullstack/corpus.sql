-- Own disposable database only. Published reader projection is part of the workload corpus.
DO $$ BEGIN IF current_database()<>'inside' OR current_user<>'platform' THEN RAISE EXCEPTION 'wrong synthetic database'; END IF; END $$;
INSERT INTO materials.materials(id,slug,title,summary,body,schema_version,created_by,access,publication_state,content_version,first_published_at,published_at,published_by,format_id,topic_id,in_feed)
SELECT overlay(overlay(md5('resource-material-'||n) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid,
 'resource-material-'||n,'Synthetic '||n,coalesce(m.summary,'Synthetic corpus'),m.body,m.schema_version,m.created_by,
 'free','published',1,now(),now(),m.published_by,m.format_id,m.topic_id,true
FROM generate_series(1,512)n CROSS JOIN LATERAL
 (SELECT material.* FROM materials.materials material JOIN materials.published_materials publication ON publication.material_id=material.id
  WHERE material.publication_state='published' AND material.primary_video_id IS NULL AND material.topic_id IS NOT NULL AND material.format_id IS NOT NULL LIMIT 1)m;
INSERT INTO materials.published_materials(material_id,content_version,slug,title,summary,access,topic_id,format_id,published_by,published_at,public_search_text,in_feed)
SELECT id,content_version,slug,title,summary,access,topic_id,format_id,published_by,published_at,'Synthetic corpus',in_feed
FROM materials.materials WHERE slug LIKE 'resource-material-%' AND publication_state='published';
ANALYZE materials.published_materials;
