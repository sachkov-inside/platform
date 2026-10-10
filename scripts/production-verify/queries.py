"""Fixed SQL reads; callers set default_transaction_read_only and statement_timeout."""
DOMAIN_CATALOG = """
WITH identifiers AS (
 SELECT n.nspname AS schema_name,c.relname AS name,'relation' AS kind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 UNION ALL SELECT n.nspname,a.attname,'column'
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
 UNION ALL SELECT n.nspname,c.conname,'constraint' FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
 UNION ALL SELECT n.nspname,p.proname,'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 UNION ALL SELECT n.nspname,t.tgname,'trigger' FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
)
SELECT json_build_object(
 'newSchemas',(SELECT count(*) FROM pg_namespace WHERE nspname IN ('account_rights','product_tasks')),
 'oldSchemas',(SELECT count(*) FROM pg_namespace WHERE nspname IN ('membership_entitlements','guide_tasks')),
 'oldPhysicalNames',(SELECT coalesce(json_agg(json_build_object('schema',schema_name,'kind',kind,'name',name)),'[]')
 FROM identifiers WHERE schema_name IN ('account_rights','materials','reading_activity','billing','product_tasks','videos',
 'telegram_membership','notifications','communications','sales_funnel','accounts','assets','bookmarks','member_profiles')
 AND name ~ '(guide|Guide|content_scope|contentScope|subscription_enrollment|membership_entitlements)'),
 'membershipAccessRows',(SELECT count(*) FROM materials.materials WHERE access='membership'),
 'oldCapabilitiesRows',(SELECT count(*) FROM account_rights.access_grants WHERE EXISTS
 (SELECT 1 FROM unnest(capabilities) AS capability WHERE capability LIKE 'guide:%')),
 'oldPaidSourceRefs',(SELECT count(*) FROM account_rights.access_grants WHERE source='paid'
 AND source_ref ~ '^[0-9a-f-]{36}:guide:[0-9a-f-]{36}$'),
 'materialFormats',(SELECT coalesce(json_object_agg(format_id,total),'{}') FROM
 (SELECT format_id,count(*) AS total FROM materials.materials GROUP BY format_id) counts)
)
"""


def logto_secret_inventory(application_id):
    # Only counts cross the boundary; the credential values stay in PostgreSQL.
    literal = "'" + application_id.replace("'", "''") + "'"
    return """
SELECT json_build_object(
 'applications',(SELECT count(*) FROM applications WHERE tenant_id='default' AND id=%s),
 'activeSecrets',(SELECT count(*) FROM application_secrets WHERE tenant_id='default' AND application_id=%s
 AND (expires_at IS NULL OR expires_at > now())),
 'legacySecretPresent',(SELECT coalesce(bool_or(secret IS NOT NULL AND secret<>''),false)
 FROM applications WHERE tenant_id='default' AND id=%s)
)
""" % (literal, literal, literal)
