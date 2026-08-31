export const name = "0011_telegram_membership";

export const statement = `
  create schema telegram_membership;

  create table telegram_membership.link_transactions (
    link_ref uuid primary key,
    account_id uuid not null,
    principal_ref varchar(256) not null,
    return_correlation varchar(256) not null,
    token_digest char(43) not null,
    provider_transaction_ref varchar(256),
    provider_identity_ref varchar(256),
    status text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint telegram_link_principal_unique unique (principal_ref),
    constraint telegram_link_return_correlation_unique unique (return_correlation),
    constraint telegram_link_token_digest_unique unique (token_digest),
    constraint telegram_link_provider_transaction_unique unique (provider_transaction_ref),
    constraint telegram_link_principal_nonempty check (length(principal_ref) > 0),
    constraint telegram_link_return_correlation_nonempty check (length(return_correlation) > 0),
    constraint telegram_link_provider_transaction_nonempty check (
      provider_transaction_ref is null or length(provider_transaction_ref) > 0
    ),
    constraint telegram_link_provider_identity_nonempty check (
      provider_identity_ref is null or length(provider_identity_ref) > 0
    ),
    constraint telegram_link_status_check check (
      status in (
        'registering',
        'pending',
        'linked',
        'expired',
        'replayed',
        'conflict',
        'unavailable',
        'recovery_required'
      )
    ),
    constraint telegram_link_expiry_check check (expires_at > created_at)
  );

  create index telegram_link_account_updated_idx
    on telegram_membership.link_transactions (account_id, updated_at desc, link_ref desc);
`;
