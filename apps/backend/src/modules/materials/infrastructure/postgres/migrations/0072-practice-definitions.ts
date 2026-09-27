export const name = "0072_practice_definitions";

export const statement = `
create table materials.practice_definitions (
  practice_id text primary key,
  material_id uuid not null references materials.materials(id),
  definition jsonb not null,
  definition_digest char(64) not null,
  practice_version bigint not null check (practice_version > 0),
  bound_source_id text not null,
  bound_source_revision char(64) not null,
  bound_content_version bigint not null check (bound_content_version > 0),
  publication_state text not null check (publication_state in ('published', 'unpublished')),
  source_repository text not null,
  source_commit char(40) not null,
  source_path text not null,
  updated_at timestamptz not null
);
create index practice_definitions_material_idx
  on materials.practice_definitions (material_id, publication_state);

create table materials.practice_import_receipts (
  actor_id uuid not null,
  operation text not null check (operation = 'apply_source_practice'),
  idempotency_key text not null,
  request_fingerprint char(64) not null,
  receipt jsonb,
  primary key (actor_id, operation, idempotency_key)
);
`;
