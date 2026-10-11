/** Platform #461. Operation ledger only: Logto remains the sole identity/session issuer. */
export const name = "0088_login_email_intents";
export const statement = `
create table accounts.login_email_intents (
 id uuid primary key,
 account_id uuid not null references accounts.accounts(id),
 telegram_subject_ref uuid not null,
 command_ref uuid not null,
 interaction_ref varchar(128) not null unique check (char_length(interaction_ref) > 0),
 browser_binding_digest char(64) not null check (browser_binding_digest ~ '^[a-f0-9]{64}$'),
 state text not null check (state in ('pending', 'reserved', 'finalized', 'superseded', 'reconciliation_required')),
 candidate_fingerprint varchar(67) check (candidate_fingerprint ~ '^v1:[a-f0-9]{64}$'),
 verification_ref varchar(128) check (char_length(verification_ref) > 0),
 telegram_request_ref uuid,
 telegram_approved_at timestamptz,
 reserved_at timestamptz,
 expires_at timestamptz not null,
 created_at timestamptz not null,
 updated_at timestamptz not null,
 constraint login_email_intents_command_unique unique (account_id, command_ref),
 constraint login_email_intents_candidate_pair check ((candidate_fingerprint is null) = (verification_ref is null)),
 constraint login_email_intents_reserved_proof check (state not in ('reserved', 'reconciliation_required', 'finalized') or
  (candidate_fingerprint is not null and reserved_at is not null and telegram_request_ref is not null and telegram_approved_at is not null)),
 constraint login_email_intents_expiry check (expires_at > created_at)
);
create unique index login_email_intents_active_account on accounts.login_email_intents(account_id)
 where state in ('pending', 'reserved', 'reconciliation_required');
create unique index login_email_intents_reserved_email on accounts.login_email_intents(candidate_fingerprint)
 where state in ('reserved', 'reconciliation_required');
create index login_email_intents_account_state on accounts.login_email_intents(account_id, state);

create function accounts.guard_login_email_intent() returns trigger language plpgsql as $$
begin
 if tg_op = 'DELETE' then raise exception 'Login email intent is retained'; end if;
 if row(new.id, new.account_id, new.telegram_subject_ref, new.command_ref, new.interaction_ref, new.browser_binding_digest, new.expires_at, new.created_at)
  is distinct from row(old.id, old.account_id, old.telegram_subject_ref, old.command_ref, old.interaction_ref, old.browser_binding_digest, old.expires_at, old.created_at)
  or (old.candidate_fingerprint is not null and row(new.candidate_fingerprint, new.verification_ref) is distinct from row(old.candidate_fingerprint, old.verification_ref))
  or (old.reserved_at is not null and row(new.reserved_at, new.telegram_request_ref, new.telegram_approved_at) is distinct from row(old.reserved_at, old.telegram_request_ref, old.telegram_approved_at))
  or (old.state in ('finalized', 'superseded') and new is distinct from old)
  or (old.state = 'pending' and new.state not in ('pending', 'reserved', 'superseded'))
  or (old.state in ('reserved', 'reconciliation_required') and new.state not in ('reconciliation_required', 'finalized'))
 then raise exception 'Invalid login email intent transition'; end if;
 return new;
end $$;
create trigger login_email_intents_guard before update or delete on accounts.login_email_intents
 for each row execute function accounts.guard_login_email_intent();

-- All normal identity writers take the same email advisory lock. This also fails closed on a
-- direct Account write while a provider outcome is unknown; finalization changes both in one tx.
create function accounts.guard_reserved_login_email() returns trigger language plpgsql as $$
begin
 if new.email_fingerprint is not null and exists (
  select 1 from accounts.login_email_intents where candidate_fingerprint = new.email_fingerprint
   and state in ('reserved', 'reconciliation_required')
 ) then raise exception 'Login email identity conflict' using errcode = '23505'; end if;
 return new;
end $$;
create trigger accounts_reserved_login_email before insert or update of email_fingerprint on accounts.accounts
 for each row when (new.email_fingerprint is not null) execute function accounts.guard_reserved_login_email();
`;
