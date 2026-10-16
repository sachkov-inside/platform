"use client";

import { TelegramLinkAction } from "./telegram-link-action.client";

/** A quiet account-level reminder; connection begins only after an explicit click. */
export function AccountTelegramNotice({
  onRefresh,
}: {
  readonly onRefresh: () => Promise<void>;
}) {
  return (
    <section aria-label="Подключение Telegram" className="shrink-0">
      <TelegramLinkAction
        compact
        label="Подключить Telegram"
        className="min-h-11 min-w-11 rounded-full bg-muted px-3 text-sm text-action hover:bg-action/8 hover:text-action"
        onRefresh={onRefresh}
      />
    </section>
  );
}
