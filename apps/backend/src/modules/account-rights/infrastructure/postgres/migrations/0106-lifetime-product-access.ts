export const name = "0106_lifetime_product_access";
export const statement = `
CREATE TABLE account_rights.product_access (
 account_id uuid NOT NULL, product_id uuid NOT NULL, first_issued_at timestamptz,
 revoked_at timestamptz, revision integer NOT NULL CHECK(revision>0), PRIMARY KEY(account_id,product_id)
);
CREATE TABLE account_rights.product_access_sources (
 source varchar(40) NOT NULL, source_ref varchar(256) NOT NULL,
 account_id uuid NOT NULL, product_id uuid NOT NULL, issued_at timestamptz NOT NULL,
 reason varchar(1000) NOT NULL, PRIMARY KEY(source,source_ref),
 FOREIGN KEY(account_id,product_id) REFERENCES account_rights.product_access(account_id,product_id)
);
CREATE INDEX product_access_sources_account_id_product_id_idx ON account_rights.product_access_sources(account_id,product_id);
CREATE TABLE account_rights.product_access_actions (
 id uuid PRIMARY KEY,account_id uuid NOT NULL,product_id uuid NOT NULL,actor_id uuid,
 kind varchar(40) NOT NULL,reason varchar(1000) NOT NULL,recorded_at timestamptz NOT NULL,revision integer NOT NULL CHECK(revision>0),
 FOREIGN KEY(account_id,product_id) REFERENCES account_rights.product_access(account_id,product_id)
);
CREATE INDEX product_access_actions_account_id_product_id_revision_idx ON account_rights.product_access_actions(account_id,product_id,revision);
-- Keep a durable inventory including unmappable historical facts. No old row or snapshot is edited.
CREATE TABLE account_rights.product_access_migration_inventory (
 legacy_kind text NOT NULL, legacy_id uuid NOT NULL, account_id uuid NOT NULL,
 product_ids uuid[] NOT NULL, disposition text NOT NULL,
 PRIMARY KEY(legacy_kind,legacy_id)
);
INSERT INTO account_rights.product_access_migration_inventory
SELECT 'grant',g.id,g.account_id,array(
 SELECT DISTINCT p.id FROM products.series p WHERE
  g.capabilities @> ARRAY['product:'||p.id::text]::text[]
  OR (g.capabilities @> ARRAY['materials']::text[] AND coalesce(g.coverage->'productIds','[]'::jsonb) @> to_jsonb(ARRAY[p.id::text]))
),CASE
 WHEN g.starts_at>now() THEN 'future_history'
 WHEN g.revoked_at IS NOT NULL THEN 'withdrawn_product_or_unscoped_history'
 WHEN g.valid_until IS NOT NULL AND g.valid_until<=now() THEN 'expired_history'
 ELSE 'explicit_product_or_unscoped_review' END
FROM account_rights.access_grants g;
INSERT INTO account_rights.product_access(account_id,product_id,first_issued_at,revoked_at,revision)
SELECT i.account_id,mapped.product_id,min(g.starts_at),
 CASE WHEN max(e.revoked_at) IS NOT NULL THEN max(e.revoked_at)
 WHEN bool_and(g.revoked_at IS NOT NULL) THEN max(g.revoked_at) ELSE NULL END,1
FROM account_rights.product_access_migration_inventory i JOIN account_rights.access_grants g ON i.legacy_kind='grant' AND i.legacy_id=g.id
CROSS JOIN LATERAL unnest(i.product_ids) AS mapped(product_id)
LEFT JOIN account_rights.product_access_exclusions e ON e.account_id=i.account_id AND e.product_id=mapped.product_id
WHERE g.starts_at<=now() AND (g.revoked_at IS NOT NULL OR g.valid_until IS NULL OR g.valid_until>now())
GROUP BY i.account_id,mapped.product_id;
INSERT INTO account_rights.product_access_sources(source,source_ref,account_id,product_id,issued_at,reason)
SELECT 'migration_grant',g.id::text||':'||product_id::text,i.account_id,product_id,g.starts_at,g.reason
FROM account_rights.product_access_migration_inventory i JOIN account_rights.access_grants g ON i.legacy_kind='grant' AND i.legacy_id=g.id
CROSS JOIN LATERAL unnest(i.product_ids) AS mapped(product_id) WHERE g.starts_at<=now() AND (g.revoked_at IS NOT NULL OR g.valid_until IS NULL OR g.valid_until>now());
-- Legacy bridge projections identify membership, not an accepted acquisition of a named Product.
-- Keep every record passive and inventoried for explicit review; never broaden whole-platform or
-- Material-only history into a Product purchase, course activation or owner issuance.
INSERT INTO account_rights.product_access_migration_inventory
SELECT 'bridge',c.account_id,c.account_id,'{}'::uuid[],'passive_bridge_review'
FROM account_rights.legacy_classifications c;
-- An explicit prior Product withdrawal remains a latch even if its old grant is missing/unscoped.
INSERT INTO account_rights.product_access(account_id,product_id,first_issued_at,revoked_at,revision)
SELECT account_id,product_id,NULL,revoked_at,1 FROM account_rights.product_access_exclusions
ON CONFLICT(account_id,product_id) DO UPDATE SET revoked_at=excluded.revoked_at;
INSERT INTO account_rights.product_access_actions(id,account_id,product_id,kind,reason,recorded_at,revision)
SELECT gen_random_uuid(),account_id,product_id,'migrate','Preserved legacy Product Access; original facts retained',coalesce(first_issued_at,revoked_at),1 FROM account_rights.product_access;
-- No bridge or provider evidence is consulted by runtime readers after this migration.
`;
