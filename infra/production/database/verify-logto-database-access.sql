\set ON_ERROR_STOP on

-- Run as the cluster administrator after Logto seed and database ACL changes.
-- This checks effective permissions, including inherited tenant-group grants.
BEGIN READ ONLY;
DO $$
DECLARE
  required_role text;
  foreign_role text;
BEGIN
  FOREACH required_role IN ARRAY ARRAY[
    'logto_owner', 'logto_tenant_logto_default', 'logto_tenant_logto_admin'
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = required_role) THEN
      RAISE EXCEPTION 'Required Logto role is missing: %', required_role;
    END IF;
    IF NOT has_database_privilege(required_role, 'logto', 'CONNECT') THEN
      RAISE EXCEPTION 'Logto role cannot connect to its database: %', required_role;
    END IF;
  END LOOP;

  -- Telegram is provisioned separately and may not exist on a fresh foundation.
  FOREACH foreign_role IN ARRAY ARRAY['platform', 'telegram_owner'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = foreign_role) THEN
      IF has_database_privilege(foreign_role, 'logto', 'CONNECT') THEN
        RAISE EXCEPTION 'Foreign application can connect to Logto: %', foreign_role;
      END IF;
    END IF;
  END LOOP;
END $$;
ROLLBACK;
