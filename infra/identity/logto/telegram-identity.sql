-- Logto-owned forward schema change. Apply before enabling the Inside connector.
create unique index if not exists users_inside_telegram_identity_unique
  on public.users (tenant_id, (identities->'inside-telegram'->>'userId'))
  where identities->'inside-telegram'->>'userId' is not null;
