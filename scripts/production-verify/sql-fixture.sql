CREATE SCHEMA materials;
CREATE SCHEMA account_rights;
CREATE SCHEMA product_tasks;
CREATE TABLE materials.materials (id uuid PRIMARY KEY, product_id uuid, access text, format_id text);
INSERT INTO materials.materials VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'public', 'guide');
-- A renamed PostgreSQL index retains its historical attribute alias. Table columns use product_id.
ALTER TABLE materials.materials ADD COLUMN guide_id uuid;
CREATE INDEX material_product_idx ON materials.materials(guide_id);
ALTER TABLE materials.materials RENAME COLUMN guide_id TO coverage_id;
CREATE TABLE account_rights.access_grants (capabilities text[], source text, source_ref text);
CREATE TABLE applications (id text, tenant_id text, secret text);
CREATE TABLE application_secrets (application_id text, tenant_id text, expires_at timestamptz, value text);
INSERT INTO applications VALUES ('test-app', 'default', NULL);
INSERT INTO application_secrets VALUES
 ('test-app', 'default', now() + interval '1 day', 'secret-value-future'),
 ('test-app', 'default', NULL, 'secret-value-no-expiry'),
 ('test-app', 'default', now() - interval '1 day', 'secret-value-expired');
