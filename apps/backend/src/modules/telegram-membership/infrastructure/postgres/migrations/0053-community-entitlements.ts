export const name = "0053_community_entitlements";
export const statement = `
  create table telegram_membership.community_desired_states (
    account_id uuid primary key,
    entitlement_revision integer not null default 0 check (entitlement_revision >= 0),
    access_revision integer not null default 0 check (access_revision >= 0),
    link_revision integer not null default 0 check (link_revision >= 0),
    link_ref uuid,
    account_ref varchar(256),
    identity_ref varchar(256),
    access jsonb not null,
    next_boundary timestamptz,
    latest_operation_id uuid,
    projected_at timestamptz not null,
    check ((account_ref is null) = (identity_ref is null)),
    check (account_ref is null or link_ref is not null)
  );
  create index community_desired_states_boundary_idx
    on telegram_membership.community_desired_states(next_boundary)
    where next_boundary is not null;

  create table telegram_membership.community_operations (
    operation_id uuid primary key,
    account_id uuid not null,
    entitlement_revision integer not null check (entitlement_revision > 0),
    purpose text not null check (purpose in ('apply', 'cleanup')),
    link_ref uuid not null,
    link_revision integer not null check (link_revision > 0),
    account_ref varchar(256) not null,
    identity_ref varchar(256) not null,
    access jsonb not null,
    command jsonb not null,
    payload_digest char(64) not null,
    issued_at timestamptz not null,
    delivery text not null check (delivery in ('pending', 'accepted', 'rejected', 'superseded')),
    attempts integer not null default 0 check (attempts >= 0),
    next_attempt_at timestamptz not null,
    error_code text,
    result jsonb,
    result_status text check (
      result_status is null or result_status in (
        'accepted', 'waiting_for_join', 'applied', 'superseded', 'failed', 'unknown', 'expired'
      )
    ),
    observed_membership text check (
      observed_membership is null or observed_membership in ('member', 'not_member', 'unknown')
    ),
    result_at timestamptz,
    polled_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    unique (account_id, entitlement_revision)
  );
  create index community_operations_delivery_idx
    on telegram_membership.community_operations(delivery, next_attempt_at);
  create index community_operations_poll_idx
    on telegram_membership.community_operations(delivery, result_status, polled_at);

  -- The command Telegram accepted is the durable fact; only delivery observations change.
  create function telegram_membership.protect_community_operation() returns trigger language plpgsql as $body$
  begin
    if row(new.operation_id, new.account_id, new.entitlement_revision, new.purpose, new.link_ref, new.link_revision,
           new.account_ref, new.identity_ref, new.access, new.command, new.payload_digest, new.issued_at, new.created_at)
       is distinct from
       row(old.operation_id, old.account_id, old.entitlement_revision, old.purpose, old.link_ref, old.link_revision,
           old.account_ref, old.identity_ref, old.access, old.command, old.payload_digest, old.issued_at, old.created_at)
    then raise exception 'Community operation command is immutable'; end if;
    return new;
  end;
  $body$;
  create trigger immutable_community_operation before update on telegram_membership.community_operations
    for each row execute function telegram_membership.protect_community_operation();
  create function telegram_membership.reject_community_operation_delete() returns trigger language plpgsql as $body$
  begin raise exception 'Community operation history is append-only'; end;
  $body$;
  create trigger append_only_community_operation before delete on telegram_membership.community_operations
    for each row execute function telegram_membership.reject_community_operation_delete();

  create table telegram_membership.community_authorizations (
    operation_id uuid primary key,
    dispatch_id uuid not null,
    attempt_id uuid not null,
    effect_ref uuid not null,
    effect text not null,
    digest char(64) not null,
    response jsonb not null,
    created_at timestamptz not null
  );
  create index community_authorizations_dispatch_idx
    on telegram_membership.community_authorizations(dispatch_id, created_at);

  create table telegram_membership.community_projection_cursor (
    id smallint primary key check (id = 1),
    access_revision integer not null default 0 check (access_revision >= 0),
    updated_at timestamptz not null
  );
`;
