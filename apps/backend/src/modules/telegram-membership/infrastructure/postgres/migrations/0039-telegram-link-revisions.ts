export const name = "0039_telegram_link_revisions";
export const statement = `
  create table telegram_membership.account_link_states (
    account_id uuid primary key,
    link_ref uuid not null unique,
    revision integer not null check (revision > 0),
    principal_ref varchar(256),
    identity_ref varchar(256),
    updated_at timestamptz not null,
    check ((principal_ref is null) = (identity_ref is null))
  );
  create table telegram_membership.account_link_history (
    account_id uuid not null,
    revision integer not null check (revision > 0),
    link_ref uuid not null,
    principal_ref varchar(256),
    identity_ref varchar(256),
    recorded_at timestamptz not null,
    primary key(account_id, revision),
    check ((principal_ref is null) = (identity_ref is null))
  );
  create function telegram_membership.record_account_link_revision() returns trigger language plpgsql as $body$
  declare
    target uuid;
    current_state telegram_membership.account_link_states%rowtype;
    principal varchar(256);
    identity varchar(256);
    matches integer;
  begin
    target := case when TG_OP = 'DELETE' then OLD.account_id else NEW.account_id end;
    perform pg_advisory_xact_lock(hashtextextended('telegram-link-state:' || target::text, 0));
    select * into current_state from telegram_membership.account_link_states where account_id = target for update;
    select count(*), min(principal_ref), min(provider_identity_ref) into matches, principal, identity
      from telegram_membership.link_transactions
      where account_id = target and status = 'linked' and provider_identity_ref is not null;
    if matches <> 1 then principal := null; identity := null; end if;
    if current_state.account_id is null and principal is null then return null; end if;
    if current_state.account_id is not null and current_state.principal_ref is not distinct from principal
      and current_state.identity_ref is not distinct from identity then return null; end if;
    insert into telegram_membership.account_link_states(account_id, link_ref, revision, principal_ref, identity_ref, updated_at)
      values(target, coalesce(current_state.link_ref, gen_random_uuid()), coalesce(current_state.revision, 0) + 1, principal, identity, clock_timestamp())
      on conflict(account_id) do update set revision = excluded.revision, principal_ref = excluded.principal_ref,
        identity_ref = excluded.identity_ref, updated_at = excluded.updated_at;
    insert into telegram_membership.account_link_history(account_id, revision, link_ref, principal_ref, identity_ref, recorded_at)
      select account_id, revision, link_ref, principal_ref, identity_ref, updated_at
      from telegram_membership.account_link_states where account_id = target;
    return null;
  end;
  $body$;
  create trigger telegram_account_link_revision after insert or update or delete
    on telegram_membership.link_transactions for each row execute function telegram_membership.record_account_link_revision();
  -- Snapshot existing verified bindings only; no access or cohort membership is created.
  update telegram_membership.link_transactions set link_ref = link_ref where status = 'linked';
`;
