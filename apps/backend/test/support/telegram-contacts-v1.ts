import type { TelegramContactsProvider } from "../../src/modules/telegram-membership/ports/telegram-contacts-provider.js";

/** A Telegram release before `inside.telegram-contact.v2`: both v2 operations answer 404. */
export const telegramWithoutContactsV2: Omit<TelegramContactsProvider, "read"> =
  {
    readWithMarketing: () =>
      Promise.resolve({ ok: false, reason: "not_supported" }),
    search: () => Promise.resolve({ ok: false, reason: "not_supported" }),
  };
