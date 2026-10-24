export const name = "0111_legacy_practice_tasks";

/** Expand/migrate only: original Practice rows and import receipts remain immutable evidence.
 * Ambiguous ownership never manufactures a Product/chapter or overrides an existing Task. */
export const statement = `
CREATE TABLE product_tasks.legacy_practice_migrations (
  practice_id text PRIMARY KEY,
  practice_version bigint NOT NULL,
  definition_digest char(64) NOT NULL,
  bound_content_version bigint NOT NULL,
  original jsonb NOT NULL,
  import_receipts jsonb NOT NULL,
  disposition text NOT NULL CHECK (disposition IN (
    'migrated', 'existing_task', 'unowned', 'ambiguous_ownership', 'conflicting_task_binding',
    'stale_source_binding', 'unsupported_identity', 'invalid_definition_digest'
  )),
  task_id uuid,
  task_version integer,
  CHECK ((task_id IS NOT NULL) = (task_version IS NOT NULL)),
  CHECK ((disposition IN ('migrated', 'existing_task')) = (task_id IS NOT NULL))
);

-- Match the canonical JSON contract used by Task imports. The helper exists only while migrating.
CREATE FUNCTION product_tasks.migration_canonical_json(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN '{' || coalesce((SELECT string_agg(to_jsonb(key)::text || ':' ||
      product_tasks.migration_canonical_json(child), ',' ORDER BY key COLLATE "C")
      FROM jsonb_each(value) AS entry(key, child)), '') || '}'
    WHEN 'array' THEN '[' || coalesce((SELECT string_agg(
      product_tasks.migration_canonical_json(child), ',' ORDER BY ordinal)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(child, ordinal)), '') || ']'
    ELSE value::text END;
$$;

DO $$
DECLARE
  legacy record;
  placement record;
  existing record;
  mapped_definition jsonb;
  mapped_digest text;
  task_identity uuid;
  task_version integer;
  reason text;
  migrated_code text;
  owner_count integer;
BEGIN
  FOR legacy IN SELECT p.*, m.source_id AS current_source_id, m.source_revision AS current_source_revision,
    m.content_version AS current_content_version, m.access AS material_access
    FROM materials.practice_definitions p JOIN materials.materials m ON m.id = p.material_id
    ORDER BY p.practice_id
  LOOP
    reason := NULL;
    task_identity := NULL;
    task_version := NULL;
    migrated_code := split_part(legacy.practice_id, ':', 2);
    SELECT count(*) INTO owner_count FROM (
      SELECT DISTINCT product_id, chapter_id FROM products.product_programme_placements
      WHERE material_id = legacy.material_id
    ) owners;
    SELECT DISTINCT product_id, chapter_id INTO placement
      FROM products.product_programme_placements WHERE material_id = legacy.material_id;
    SELECT * INTO existing FROM product_tasks.tasks
      WHERE source_id = legacy.practice_id OR embedded_material_id = legacy.material_id
      ORDER BY (source_id = legacy.practice_id) DESC LIMIT 1;
    IF legacy.definition_digest <> encode(sha256(convert_to(product_tasks.migration_canonical_json(
      jsonb_build_object('definition', legacy.definition, 'sourceReference', jsonb_build_object(
        'materialSourceId', legacy.bound_source_id, 'materialSourceRevision', legacy.bound_source_revision))), 'UTF8')), 'hex') THEN
      reason := 'invalid_definition_digest';
    ELSIF legacy.bound_source_id IS DISTINCT FROM legacy.current_source_id
      OR legacy.bound_source_revision IS DISTINCT FROM legacy.current_source_revision
      OR legacy.bound_content_version IS DISTINCT FROM legacy.current_content_version THEN
      reason := 'stale_source_binding';
    ELSIF owner_count = 0 THEN reason := 'unowned';
    ELSIF owner_count <> 1 OR placement.chapter_id IS NULL THEN reason := 'ambiguous_ownership';
    ELSIF existing.id IS NOT NULL THEN
      -- An exact identity AND embedded source binding proves ownership; title similarity does not.
      IF existing.source_id = legacy.practice_id AND existing.embedded_material_id = legacy.material_id
        AND existing.product_id = placement.product_id AND existing.chapter_id = placement.chapter_id THEN
        reason := 'existing_task'; task_identity := existing.id; task_version := existing.current_version;
      ELSE reason := 'conflicting_task_binding'; END IF;
    ELSIF char_length(migrated_code) > 120 OR legacy.practice_id !~ '^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$'
      OR EXISTS (SELECT 1 FROM product_tasks.tasks WHERE tasks.code = migrated_code)
      OR EXISTS (SELECT 1 FROM materials.materials WHERE source_id = legacy.practice_id) THEN
      reason := 'unsupported_identity';
    ELSE
      mapped_definition := jsonb_build_object('schemaVersion', 1,
        'situation', legacy.definition->'businessInputs',
        'result', jsonb_build_array(legacy.definition->'expectedOutcome'),
        'freedom', legacy.definition->'allowedFreedom',
        'criteria', (SELECT jsonb_agg(criterion || '{"level":"required"}'::jsonb ORDER BY ordinal)
          FROM jsonb_array_elements(legacy.definition->'criteria') WITH ORDINALITY AS entry(criterion, ordinal)));
      mapped_digest := encode(sha256(convert_to(product_tasks.migration_canonical_json(mapped_definition), 'UTF8')), 'hex');
      task_identity := gen_random_uuid(); task_version := 1;
      INSERT INTO product_tasks.tasks(id, code, source_id, product_id, chapter_id, position, title,
        access, related_material_source_ids, publication_state, current_version, revision,
        created_at, updated_at, programme_visibility, embedded_material_id)
      VALUES (task_identity, migrated_code, legacy.practice_id, placement.product_id, placement.chapter_id, 1,
        legacy.definition->>'title', legacy.material_access, ARRAY[legacy.bound_source_id],
        legacy.publication_state, 1, 1, legacy.updated_at, legacy.updated_at, 'embedded', legacy.material_id);
      INSERT INTO product_tasks.task_versions(task_id, version, definition, definition_digest, created_at,
        source_repository, source_commit, source_path)
      VALUES(task_identity, 1, mapped_definition, mapped_digest, legacy.updated_at,
        legacy.source_repository, legacy.source_commit, legacy.source_path);
      reason := 'migrated';
    END IF;
    INSERT INTO product_tasks.legacy_practice_migrations
      (practice_id, practice_version, definition_digest, bound_content_version, original, import_receipts,
       disposition, task_id, task_version)
    SELECT legacy.practice_id, legacy.practice_version, legacy.definition_digest, legacy.bound_content_version,
      to_jsonb(p), coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id, operation, idempotency_key)
        FROM materials.practice_import_receipts r WHERE receipt->>'practiceId' = legacy.practice_id), '[]'::jsonb),
      reason, task_identity, task_version FROM materials.practice_definitions p WHERE p.practice_id = legacy.practice_id;
  END LOOP;
END;
$$;
DROP FUNCTION product_tasks.migration_canonical_json(jsonb);

CREATE TRIGGER legacy_practice_migrations_immutable BEFORE UPDATE OR DELETE ON product_tasks.legacy_practice_migrations
  FOR EACH ROW EXECUTE FUNCTION product_tasks.reject_rewrite();
-- Deletion has the same immutable history contract as rewriting. A future data-policy procedure
-- must explicitly own any erasure instead of silently bypassing the learning history contract.
CREATE TRIGGER task_versions_no_delete BEFORE DELETE ON product_tasks.task_versions
  FOR EACH ROW EXECUTE FUNCTION product_tasks.reject_rewrite();
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON product_tasks.submissions
  FOR EACH ROW EXECUTE FUNCTION product_tasks.reject_rewrite();
`;
