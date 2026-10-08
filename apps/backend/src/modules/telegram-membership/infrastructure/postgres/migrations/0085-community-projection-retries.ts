export const name = "0085_community_projection_retries";
export const statement = `
  create table telegram_membership.community_projection_retries (
    account_id uuid primary key,
    attempt_id uuid not null,
    next_attempt_at timestamptz not null,
    error_code text,
    updated_at timestamptz not null
  );
  create index community_projection_retries_due_idx
    on telegram_membership.community_projection_retries(next_attempt_at, account_id);
`;
