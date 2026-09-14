export const name = "0063_subscription_enrollments";
export const statement = `
ALTER TABLE billing.offers ADD COLUMN available_for_assignment boolean NOT NULL DEFAULT false;
ALTER TABLE billing.offers ADD COLUMN content_scope jsonb;
UPDATE billing.offers SET published = false, revision = revision + 1
WHERE published AND EXISTS (SELECT 1 FROM billing.payment_options WHERE offer_id = billing.offers.id AND mode = 'subscription');
CREATE TABLE membership_entitlements.subscription_enrollments (
 id uuid PRIMARY KEY, account_id uuid NOT NULL,
 tier_id uuid NOT NULL, tier_revision integer NOT NULL CHECK (tier_revision > 0), snapshot jsonb NOT NULL,
 origin text NOT NULL CHECK (origin IN ('course','tribute','manual','platform_payment')),
 source_ref varchar(256) NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz,
 end_policy text NOT NULL CHECK (end_policy IN ('fixed','confirmed_external','temporary_membership')),
 billing_ref uuid, revoked_at timestamptz, revision integer NOT NULL CHECK (revision > 0),
 reason varchar(1000) NOT NULL, UNIQUE(origin,source_ref),
 CHECK (ends_at IS NULL OR ends_at > starts_at),
 CHECK (origin <> 'course' OR (ends_at IS NULL AND billing_ref IS NULL)),
 CHECK ((origin = 'platform_payment') = (billing_ref IS NOT NULL))
);
CREATE INDEX subscription_enrollments_account_idx ON membership_entitlements.subscription_enrollments(account_id);
ALTER TABLE membership_entitlements.access_grants ADD COLUMN content_scope jsonb;
ALTER TABLE membership_entitlements.access_grants ADD COLUMN enrollment_id uuid REFERENCES membership_entitlements.subscription_enrollments(id);
CREATE INDEX access_grants_enrollment_idx ON membership_entitlements.access_grants(enrollment_id);
-- Immutable compatibility boundary, shared by historical grants and late fulfillment.
CREATE TABLE membership_entitlements.content_scope_baseline (
 id integer PRIMARY KEY CHECK(id = 1), scope jsonb NOT NULL
);
INSERT INTO membership_entitlements.content_scope_baseline VALUES (1, jsonb_build_object(
 'guideIds', (SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM materials.series WHERE archived_at IS NULL),
 'materialIds', (SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM materials.materials WHERE publication_state = 'published')
));
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM membership_entitlements.content_scope_baseline
 WHERE jsonb_array_length(scope->'guideIds') > 1000 OR jsonb_array_length(scope->'materialIds') > 1000)
 THEN RAISE EXCEPTION 'Content scope exceeds supported bounds; review migration preview'; END IF;
END $$;
-- Agreed launch tier: assignment only, no invented price or payment option.
INSERT INTO billing.offers(id, name, benefits, benefit_periods, revision, archived, published, available_for_assignment, content_scope)
 SELECT '62000000-0000-4000-8000-000000000624'::uuid, 'Материалы + сообщество', ARRAY['materials','community']::text[], '[]'::jsonb, 1, false, false, true, scope
 FROM membership_entitlements.content_scope_baseline WHERE id = 1;
UPDATE membership_entitlements.access_grants SET content_scope = (SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id = 1)
 WHERE capabilities @> ARRAY['materials']::text[] AND content_scope IS NULL;
ALTER TABLE membership_entitlements.legacy_classifications ADD COLUMN bridge_benefits text[] NOT NULL DEFAULT ARRAY['materials','community']::text[];
UPDATE membership_entitlements.legacy_classifications SET bridge_benefits = ARRAY['materials','community','support','reviews']::text[] WHERE bridge_enabled;
ALTER TABLE membership_entitlements.legacy_classifications ADD COLUMN bridge_content_scope jsonb;
UPDATE membership_entitlements.legacy_classifications SET bridge_content_scope = (SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id = 1) WHERE bridge_enabled;
-- A confirmed existing Platform payment can be identified without manufacturing a purchase,
-- recurring consent or an external source. Historical receipts and snapshot bytes stay intact.
INSERT INTO membership_entitlements.subscription_enrollments
 (id, account_id, tier_id, tier_revision, snapshot, origin, source_ref, starts_at, ends_at, end_policy, billing_ref, revoked_at, revision, reason)
 SELECT p.id, p.account_id, (p.snapshot->'offer'->>'id')::uuid,
 (p.snapshot->'offer'->>'revision')::integer,
 jsonb_build_object('id',p.snapshot->'offer'->'id','revision',p.snapshot->'offer'->'revision',
  'name',p.snapshot->'offer'->'name','benefits',p.snapshot->'offer'->'benefits',
  'contentScope',coalesce(nullif(p.snapshot->'offer'->'contentScope','null'::jsonb),(SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id=1))),
 'platform_payment', 'purchase:'||p.id::text, coalesce(existing.starts_at,p.confirmed_at), p.period_ends_at, 'fixed', p.subscription_ref,
 CASE WHEN existing.all_revoked THEN existing.revoked_at ELSE NULL END, 1, 'Imported confirmed Platform payment'
 FROM billing.purchases p JOIN LATERAL (
  SELECT min(g.starts_at) AS starts_at, bool_and(g.revoked_at IS NOT NULL) AS all_revoked, max(g.revoked_at) AS revoked_at
  FROM membership_entitlements.access_grants g WHERE g.source='paid' AND (g.source_ref=p.id::text OR g.source_ref LIKE p.id::text||':%')
 ) existing ON true
 WHERE p.subscription_ref IS NOT NULL AND p.confirmed_at IS NOT NULL AND p.period_ends_at > coalesce(existing.starts_at,p.confirmed_at)
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.snapshot->'offer'->'benefits') benefit WHERE benefit LIKE 'guide:%');
UPDATE membership_entitlements.access_grants g SET enrollment_id=e.id
 FROM membership_entitlements.subscription_enrollments e WHERE e.origin='platform_payment' AND g.source='paid'
 AND (g.source_ref=e.id::text OR g.source_ref LIKE e.id::text||':%');
CREATE FUNCTION membership_entitlements.freeze_material_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.content_scope IS NULL AND NEW.capabilities @> ARRAY['materials']::text[] THEN
  NEW.content_scope := (SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id = 1);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER access_grant_material_scope BEFORE INSERT OR UPDATE ON membership_entitlements.access_grants
 FOR EACH ROW EXECUTE FUNCTION membership_entitlements.freeze_material_scope();
CREATE FUNCTION membership_entitlements.freeze_bridge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.bridge_enabled AND NEW.bridge_content_scope IS NULL THEN
  NEW.bridge_content_scope := (SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id = 1);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_bridge_material_scope BEFORE INSERT OR UPDATE ON membership_entitlements.legacy_classifications
 FOR EACH ROW EXECUTE FUNCTION membership_entitlements.freeze_bridge_scope();
CREATE TABLE membership_entitlements.activation_rules (
 id uuid PRIMARY KEY, code varchar(40) NOT NULL UNIQUE, name varchar(200) NOT NULL, revision integer NOT NULL CHECK(revision > 0),
 tier_id uuid NOT NULL, tier_revision integer NOT NULL CHECK(tier_revision > 0), source_ref varchar(256) NOT NULL,
 published boolean NOT NULL DEFAULT false, starts_at timestamptz NOT NULL, ends_at timestamptz, reason varchar(1000) NOT NULL,
 CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE membership_entitlements.source_entitlements (
 id uuid PRIMARY KEY, origin text NOT NULL CHECK(origin IN ('course','tribute','manual','platform_payment')),
 source_ref varchar(256) NOT NULL, source_policy_ref varchar(256) NOT NULL, identity_ref varchar(256) NOT NULL,
 account_id uuid, enrollment_id uuid REFERENCES membership_entitlements.subscription_enrollments(id),
 revision integer NOT NULL CHECK(revision > 0), evidence jsonb NOT NULL, revoked_at timestamptz, checked_at timestamptz NOT NULL,
 UNIQUE(origin, source_ref)
);
CREATE TABLE membership_entitlements.activation_attempts (
 id uuid PRIMARY KEY, identity_ref varchar(256) NOT NULL, rule_id uuid NOT NULL REFERENCES membership_entitlements.activation_rules(id),
 rule_revision integer NOT NULL, account_id uuid, result jsonb NOT NULL, expires_at timestamptz NOT NULL
);
`;
