export const name = "0082_domain_names";

// #1065: the runner executes the whole statement in one transaction. No rows are deleted.
// Old application images cannot run against the renamed schema; rollback needs a forward repair.
export const statement = `
CREATE FUNCTION pg_temp.domain_name(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(value,
    'membership_entitlements', 'account_rights'),
    'subscription_enrollment', 'tariff_assignment'),
    'content_scope', 'coverage'), 'allGuides', 'wholePlatform'), 'contentScope', 'coverage'), 'Guide', 'Product'), 'guide', 'product');
$$;
CREATE FUNCTION pg_temp.domain_json(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb; item record; key text; child jsonb;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      result := '{}'::jsonb;
      FOR item IN SELECT * FROM jsonb_each(value) LOOP
        key := replace(replace(replace(item.key, 'contentScope', 'coverage'), 'ContentScope', 'Coverage'), 'allGuides', 'wholePlatform');
        key := replace(replace(key, 'guide', 'product'), 'Guide', 'Product');
        child := pg_temp.domain_json(item.value);
        IF item.key = 'access' AND item.value = '"membership"'::jsonb THEN child := '"closed"'::jsonb; END IF;
        IF item.key = 'kind' AND item.value = '"guide"'::jsonb THEN child := '"product"'::jsonb; END IF;
        IF result ? key THEN RAISE EXCEPTION 'Domain JSON key collision: %', key; END IF;
        result := result || jsonb_build_object(key, child);
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(pg_temp.domain_json(element) ORDER BY ordinal), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(element, ordinal);
      RETURN result;
    WHEN 'string' THEN
      IF value #>> '{}' LIKE 'guide:%' THEN RETURN to_jsonb('product:' || substring(value #>> '{}' FROM 7)); END IF;
      RETURN value;
    ELSE RETURN value;
  END CASE;
END;
$$;

ALTER SCHEMA membership_entitlements RENAME TO account_rights;
ALTER SCHEMA guide_tasks RENAME TO product_tasks;

-- Catalog-driven identifier changes cover constraints and indexes as well as Prisma names.
-- Scope is limited to the repository's application schemas, never queues or migration ledgers.
CREATE TEMP TABLE domain_tables ON COMMIT DROP AS
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname IN
    ('account_rights', 'materials', 'reading_activity', 'billing', 'product_tasks', 'videos',
     'telegram_membership', 'notifications', 'communications', 'sales_funnel', 'accounts', 'assets', 'bookmarks', 'member_profiles');
DO $$ DECLARE item record; target text; BEGIN
  FOR item IN SELECT * FROM domain_tables LOOP
    target := pg_temp.domain_name(item.table_name);
    IF target <> item.table_name THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', item.schema_name, item.table_name, target);
    END IF;
  END LOOP;
  FOR item IN SELECT a.attrelid, a.attname FROM pg_attribute a JOIN domain_tables t ON t.oid = a.attrelid
    WHERE a.attnum > 0 AND NOT a.attisdropped LOOP
    target := pg_temp.domain_name(item.attname);
    IF target <> item.attname THEN
      EXECUTE format('ALTER TABLE %s RENAME COLUMN %I TO %I', item.attrelid::regclass, item.attname, target);
    END IF;
  END LOOP;
END $$;

CREATE TEMP TABLE domain_checks ON COMMIT DROP AS
  SELECT c.conrelid, c.conname,
    CASE WHEN c.conname LIKE '%format%' THEN pg_get_constraintdef(c.oid) ELSE replace(pg_temp.domain_name(pg_get_constraintdef(c.oid)), '''membership''', '''closed''') END AS definition
  FROM pg_constraint c JOIN domain_tables t ON t.oid = c.conrelid
  WHERE c.contype = 'c' AND pg_get_constraintdef(c.oid) <>
    CASE WHEN c.conname LIKE '%format%' THEN pg_get_constraintdef(c.oid) ELSE replace(pg_temp.domain_name(pg_get_constraintdef(c.oid)), '''membership''', '''closed''') END;
CREATE TEMP TABLE domain_triggers ON COMMIT DROP AS
  SELECT tg.tgrelid, tg.tgname, tg.tgenabled FROM pg_trigger tg JOIN domain_tables t ON t.oid = tg.tgrelid
  WHERE NOT tg.tgisinternal;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM domain_checks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.conrelid::regclass, item.conname);
  END LOOP;
  FOR item IN SELECT * FROM domain_triggers LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', item.tgrelid::regclass, item.tgname);
  END LOOP;
  FOR item IN SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (SELECT DISTINCT schema_name FROM domain_tables) AND p.prokind = 'f' LOOP
    IF item.proname <> pg_temp.domain_name(item.proname) THEN
      EXECUTE format('ALTER FUNCTION %I.%I(%s) RENAME TO %I', item.nspname, item.proname, item.arguments, pg_temp.domain_name(item.proname));
    END IF;
  END LOOP;
  FOR item IN SELECT p.oid, pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (SELECT DISTINCT schema_name FROM domain_tables) AND p.prokind = 'f' LOOP
    IF item.definition <> pg_temp.domain_name(item.definition) THEN
      EXECUTE pg_temp.domain_name(item.definition);
    END IF;
  END LOOP;
END $$;

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT a.attrelid, a.attname, a.atttypid FROM pg_attribute a
    JOIN domain_tables t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped LOOP
    -- Only application-owned domain snapshots carry renamed keys. Never rewrite authored
    -- bodies, legal evidence, provider payloads, task definitions or hashed delivery commands.
    IF item.atttypid = 'jsonb'::regtype AND (item.attrelid::regclass::text, item.attname) IN (
      ('account_rights.access_grants', 'coverage'), ('account_rights.coverage_baseline', 'scope'),
      ('account_rights.access_receipts', 'result'), ('account_rights.access_receipts', 'payload'),
      ('account_rights.access_batch_previews', 'rows'),
      ('account_rights.legacy_classifications', 'bridge_coverage'),
      ('account_rights.tariff_assignments', 'snapshot'),
      ('account_rights.activation_attempts', 'result'),
      ('account_rights.tribute_policies', 'tier_snapshot'),
      ('account_rights.tribute_import_reviews', 'pending_rows'),
      ('billing.offers', 'coverage'), ('billing.offers', 'benefit_periods'), ('billing.pricing_commands', 'outcome'),
      ('billing.price_quotes', 'snapshot'), ('billing.promo_reservations', 'snapshot'),
      ('billing.purchases', 'snapshot'), ('billing.fulfillment_outbox', 'payload'),
      ('billing.subscriptions', 'snapshot'), ('billing.subscriptions', 'pending_change'),
      ('billing.subscription_events', 'payload'), ('billing.subscription_commands', 'result'),
      ('billing.subscription_change_quotes', 'plan'), ('billing.owner_commands', 'result'),
      ('reading_activity.commands', 'outcome'), ('product_tasks.import_receipts', 'receipt')
    ) THEN
      EXECUTE format('UPDATE %s SET %I = pg_temp.domain_json(%I) WHERE %I IS DISTINCT FROM pg_temp.domain_json(%I)',
        item.attrelid::regclass, item.attname, item.attname, item.attname, item.attname);
    ELSIF item.atttypid = 'text[]'::regtype AND item.attname IN ('capabilities', 'benefits') THEN
      EXECUTE format('UPDATE %s SET %I = ARRAY(SELECT CASE WHEN entry LIKE ''guide:%%'' THEN ''product:'' || substring(entry FROM 7) ELSE entry END FROM unnest(%I) WITH ORDINALITY AS entries(entry, ordinal) ORDER BY ordinal) WHERE EXISTS (SELECT 1 FROM unnest(%I) AS entry WHERE entry LIKE ''guide:%%'')',
        item.attrelid::regclass, item.attname, item.attname, item.attname);
    ELSIF item.attname = 'access' AND item.atttypid = 'text'::regtype THEN
      EXECUTE format('UPDATE %s SET %I = ''closed'' WHERE %I = ''membership''', item.attrelid::regclass, item.attname, item.attname);
    ELSIF item.attname = 'operation' THEN
      EXECUTE format('UPDATE %s SET %I = replace(%I, ''guide'', ''product'') WHERE %I LIKE ''%%guide%%''',
        item.attrelid::regclass, item.attname, item.attname, item.attname);
    END IF;
  END LOOP;
END $$;

DO $$ DECLARE item record; target text; BEGIN
  FOR item IN SELECT * FROM domain_checks LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.conrelid::regclass, pg_temp.domain_name(item.conname), item.definition);
  END LOOP;
  FOR item IN SELECT c.conrelid, c.conname FROM pg_constraint c JOIN domain_tables t ON t.oid = c.conrelid LOOP
    target := pg_temp.domain_name(item.conname);
    IF target <> item.conname THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', item.conrelid::regclass, item.conname, target);
    END IF;
  END LOOP;
  FOR item IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('i', 'S') AND n.nspname IN (SELECT DISTINCT schema_name FROM domain_tables) LOOP
    target := pg_temp.domain_name(item.relname);
    IF target <> item.relname THEN
      EXECUTE format('ALTER %s %I.%I RENAME TO %I', CASE WHEN item.relname IN
        (SELECT relname FROM pg_class WHERE relkind = 'S') THEN 'SEQUENCE' ELSE 'INDEX' END,
        item.nspname, item.relname, target);
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM domain_triggers LOOP
    EXECUTE format('ALTER TABLE %s %s TRIGGER %I', item.tgrelid::regclass,
      CASE item.tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' ELSE 'ENABLE' END, item.tgname);
    target := pg_temp.domain_name(item.tgname);
    IF target <> item.tgname THEN EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I', item.tgname, item.tgrelid::regclass, target); END IF;
  END LOOP;
END $$;
`;
