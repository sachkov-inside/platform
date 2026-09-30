export const name = "0074_sales_funnel";

// Неизменяемый журнал событий воронки от бота. Контакт бота непрозрачен: ни Telegram user id,
// ни username сюда не попадают. Аккаунт привязки запоминается при приёме события, чтобы метка
// осталась у аккаунта и после отвязки Telegram; если связи ещё нет, он находится при чтении.
export const statement = `
CREATE SCHEMA sales_funnel;
CREATE TABLE sales_funnel.bot_events (
  event_id uuid NOT NULL,
  contact_ref uuid NOT NULL,
  kind text NOT NULL,
  source_code text,
  granted boolean,
  telegram_identity_ref text,
  account_id uuid,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  CONSTRAINT bot_events_primary PRIMARY KEY (event_id),
  CONSTRAINT bot_events_kind_valid CHECK (
    kind IN ('bot_entered', 'marketing_consent', 'account_linked')
  ),
  CONSTRAINT bot_events_shape_valid CHECK (
    (kind = 'bot_entered' AND granted IS NULL AND telegram_identity_ref IS NULL
      AND (source_code IS NULL OR source_code ~ '^[A-Za-z0-9_-]{1,64}$'))
    OR (kind = 'marketing_consent' AND granted IS NOT NULL
      AND source_code IS NULL AND telegram_identity_ref IS NULL)
    OR (kind = 'account_linked' AND source_code IS NULL AND granted IS NULL
      AND char_length(telegram_identity_ref) BETWEEN 1 AND 256)
  ),
  CONSTRAINT bot_events_account_only_for_link CHECK (
    account_id IS NULL OR kind = 'account_linked'
  )
);
CREATE INDEX bot_events_contact_kind ON sales_funnel.bot_events (contact_ref, kind, occurred_at, event_id);
CREATE INDEX bot_events_kind_time ON sales_funnel.bot_events (kind, occurred_at);
`;
