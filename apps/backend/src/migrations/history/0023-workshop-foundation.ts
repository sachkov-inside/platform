export const name = "0023_workshop_foundation";

export const statement = `
  create schema workshop;

  create table workshop.entitlements (
    id uuid primary key,
    account_id uuid not null,
    workshop_scope varchar(128) not null,
    starts_at timestamptz not null,
    valid_until timestamptz not null,
    grant_source varchar(64) not null,
    granted_by uuid not null,
    idempotency_key varchar(200) not null,
    request_fingerprint char(64) not null,
    created_at timestamptz not null,
    constraint workshop_entitlements_interval_check check (starts_at < valid_until),
    constraint workshop_entitlements_scope_check check (
      workshop_scope = btrim(workshop_scope) and char_length(workshop_scope) between 1 and 128
    ),
    constraint workshop_entitlements_grant_source_check check (
      grant_source in ('owner_beta')
    ),
    constraint workshop_entitlements_idempotency_unique unique (granted_by, idempotency_key)
  );

  create index workshop_entitlements_access_idx
    on workshop.entitlements (account_id, workshop_scope, valid_until desc);

  create table workshop.cases (
    id uuid primary key,
    slug varchar(120) not null,
    workshop_scope varchar(128) not null,
    lifecycle text not null,
    current_version_id uuid,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint workshop_cases_slug_unique unique (slug),
    constraint workshop_cases_scope_check check (
      workshop_scope = btrim(workshop_scope) and char_length(workshop_scope) between 1 and 128
    ),
    constraint workshop_cases_lifecycle_check check (
      lifecycle in ('draft', 'published', 'retired')
    )
  );

  create table workshop.case_versions (
    id uuid primary key,
    case_id uuid not null,
    case_version varchar(128) not null,
    schema_version varchar(128) not null,
    case_spec jsonb not null,
    content_digest char(64) not null,
    source_repository varchar(256) not null,
    source_commit char(40) not null,
    artifacts jsonb not null,
    publication_fingerprint char(64) not null,
    published_by uuid not null,
    idempotency_key varchar(200) not null,
    published_at timestamptz not null,
    withdrawn_at timestamptz,
    constraint workshop_case_versions_case_fk foreign key (case_id)
      references workshop.cases (id) on delete restrict,
    constraint workshop_case_versions_domain_version_unique unique (case_id, case_version),
    constraint workshop_case_versions_source_unique unique (
      source_repository, source_commit, content_digest
    ),
    constraint workshop_case_versions_idempotency_unique unique (
      published_by, idempotency_key
    ),
    constraint workshop_case_versions_digest_check check (
      content_digest ~ '^[0-9a-f]{64}$'
    ),
    constraint workshop_case_versions_source_commit_check check (
      source_commit ~ '^[0-9a-f]{40}$'
    ),
    constraint workshop_case_versions_withdrawal_check check (
      withdrawn_at is null or withdrawn_at >= published_at
    )
  );

  alter table workshop.cases
    add constraint workshop_cases_current_version_unique unique (current_version_id),
    add constraint workshop_cases_current_version_fk foreign key (current_version_id)
      references workshop.case_versions (id) on delete restrict;

  create table workshop.case_materials (
    case_version_id uuid not null,
    material_id uuid not null,
    role text not null,
    ordinal integer not null,
    release_policy text not null,
    hint_key varchar(128),
    constraint workshop_case_materials_primary primary key (case_version_id, material_id),
    constraint workshop_case_materials_ordinal_unique unique (case_version_id, ordinal),
    constraint workshop_case_materials_version_fk foreign key (case_version_id)
      references workshop.case_versions (id) on delete restrict,
    constraint workshop_case_materials_role_check check (
      role in (
        'prerequisite', 'optional_reference', 'hint', 'exact_solution',
        'walkthrough', 'alternatives'
      )
    ),
    constraint workshop_case_materials_ordinal_check check (ordinal > 0),
    constraint workshop_case_materials_release_check check (
      (role in ('prerequisite', 'optional_reference') and release_policy = 'immediate' and hint_key is null)
      or (role = 'hint' and release_policy = 'hint_reveal' and hint_key is not null)
      or (role in ('exact_solution', 'walkthrough', 'alternatives') and release_policy = 'solution_reveal' and hint_key is null)
    )
  );

  create table workshop.hint_reveals (
    id uuid primary key,
    account_id uuid not null,
    case_version_id uuid not null,
    hint_key varchar(128) not null,
    idempotency_key varchar(200) not null,
    request_fingerprint char(64) not null,
    revealed_at timestamptz not null,
    constraint workshop_hint_reveals_version_fk foreign key (case_version_id)
      references workshop.case_versions (id) on delete restrict,
    constraint workshop_hint_reveals_identity_unique unique (
      account_id, case_version_id, hint_key
    ),
    constraint workshop_hint_reveals_idempotency_unique unique (
      account_id, idempotency_key
    )
  );

  create table workshop.solution_reveals (
    id uuid primary key,
    account_id uuid not null,
    case_version_id uuid not null,
    reason text not null,
    idempotency_key varchar(200) not null,
    request_fingerprint char(64) not null,
    revealed_at timestamptz not null,
    constraint workshop_solution_reveals_version_fk foreign key (case_version_id)
      references workshop.case_versions (id) on delete restrict,
    constraint workshop_solution_reveals_identity_unique unique (
      account_id, case_version_id
    ),
    constraint workshop_solution_reveals_idempotency_unique unique (
      account_id, idempotency_key
    ),
    constraint workshop_solution_reveals_reason_check check (
      reason in ('after_attempt', 'learner_requested')
    )
  );

  create function workshop.reject_immutable_record_change()
  returns trigger
  language plpgsql
  as $$
  begin
    raise exception 'Workshop record is immutable' using errcode = '23514';
  end;
  $$;

  create trigger workshop_entitlements_immutable
    before update or delete on workshop.entitlements
    for each row execute function workshop.reject_immutable_record_change();

  create function workshop.reject_case_version_change()
  returns trigger
  language plpgsql
  as $$
  begin
    if tg_op = 'UPDATE'
      and old.withdrawn_at is null
      and new.withdrawn_at is not null
      and (to_jsonb(new) - 'withdrawn_at') = (to_jsonb(old) - 'withdrawn_at') then
      return new;
    end if;
    raise exception 'Workshop CaseVersion is immutable' using errcode = '23514';
  end;
  $$;

  create trigger workshop_case_versions_immutable
    before update or delete on workshop.case_versions
    for each row execute function workshop.reject_case_version_change();

  create trigger workshop_case_materials_immutable
    before update or delete on workshop.case_materials
    for each row execute function workshop.reject_immutable_record_change();

  create trigger workshop_hint_reveals_immutable
    before update or delete on workshop.hint_reveals
    for each row execute function workshop.reject_immutable_record_change();

  create trigger workshop_solution_reveals_immutable
    before update or delete on workshop.solution_reveals
    for each row execute function workshop.reject_immutable_record_change();
`;
