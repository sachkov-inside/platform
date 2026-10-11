// Ownership: platform#443, reservation https://github.com/sachkov-inside/platform/issues/443#issuecomment-6092333900.
export const name = "0089_material_term_definitions";

export const statement = `
create table materials.term_definitions (
  term_id uuid primary key,
  definition jsonb not null,
  definition_digest char(64) not null,
  term_version bigint not null check (term_version > 0),
  publication_state text not null check (publication_state in ('draft', 'published', 'unpublished')),
  detailed_material_id uuid references materials.materials(id),
  source_id text unique,
  source_path text,
  source_revision char(64),
  updated_at timestamptz not null,
  check ((source_id is null and source_path is null and source_revision is null)
    or (source_id is not null and source_path is not null))
);
create table materials.term_import_receipts (
  actor_id uuid not null,
  operation text not null check (operation in ('apply_source_term', 'save_term')),
  idempotency_key text not null,
  request_fingerprint char(64) not null,
  receipt jsonb,
  primary key (actor_id, operation, idempotency_key)
);
`;
