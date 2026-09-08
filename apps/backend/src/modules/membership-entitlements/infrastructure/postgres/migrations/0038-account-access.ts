export const name = "0038_account_access";
export const statement = `
  create table membership_entitlements.access_grants (
    id uuid primary key,
    account_id uuid not null,
    source text not null check (source in ('paid', 'manual', 'legacy')),
    source_ref varchar(256) not null,
    capabilities text[] not null check (cardinality(capabilities) > 0 and capabilities <@ array['materials', 'community', 'reviews']::text[]),
    starts_at timestamptz not null,
    valid_until timestamptz,
    revoked_at timestamptz,
    revision integer not null check (revision > 0),
    reason varchar(1000) not null,
    unique (source, source_ref),
    check (valid_until is null or valid_until > starts_at),
    check (source <> 'paid' or valid_until is not null)
  );
  create index access_grants_account_idx on membership_entitlements.access_grants(account_id);
  create table membership_entitlements.access_receipts (
    scope varchar(256) not null,
    operation_id uuid not null,
    fingerprint char(64) not null,
    result jsonb not null,
    created_at timestamptz not null,
    primary key (scope, operation_id)
  );
  create table membership_entitlements.access_batch_previews (
    id uuid primary key,
    actor_id uuid not null,
    operation_id uuid not null,
    fingerprint char(64) not null,
    rows jsonb not null,
    revision integer not null default 1 check (revision > 0),
    expires_at timestamptz not null,
    unique(actor_id, operation_id)
  );
  create table membership_entitlements.legacy_classifications (
    account_id uuid primary key,
    classification text not null check (classification in ('confirmed_legacy', 'confirmed_new', 'unknown')),
    source_ref varchar(256) not null,
    reason varchar(1000) not null,
    verified_at timestamptz not null,
    revision integer not null check (revision > 0),
    bridge_enabled boolean not null default false,
    tribute_stopped boolean not null default false,
    check (not bridge_enabled or classification = 'confirmed_legacy'),
    check (not tribute_stopped or classification = 'confirmed_legacy')
  );
  create table membership_entitlements.access_changes (
    revision serial primary key,
    account_id uuid not null,
    grant_id uuid,
    actor_id uuid,
    operation_id uuid not null,
    kind text not null,
    reason varchar(1000) not null,
    recorded_at timestamptz not null
  );
  create index access_changes_account_idx on membership_entitlements.access_changes(account_id, revision);
`;
