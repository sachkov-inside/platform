import { z } from "zod";

import type { TelegramLinkState } from "./account-telegram-membership";

const sessionKey = "inside.telegram-link.v1";
const savedLinkSchema = z
  .object({
    deepLink: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "t.me" &&
        url.username === "" &&
        url.password === "" &&
        url.searchParams.has("start")
      );
    }),
    expiresAt: z.iso.datetime({ offset: true }),
    linkRef: z.uuid(),
  })
  .strict();

/** Ссылка во вкладке не заменяет begin: сервер подтверждает ожидающую привязку и её срок. */
export function resolveTelegramLinkDeepLink(
  state: TelegramLinkState,
): string | null {
  if (state.status !== "pending" || Date.parse(state.expiresAt) <= Date.now()) {
    clearTelegramLinkSession();
    return null;
  }
  if (state.deepLink !== undefined) {
    try {
      window.sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          deepLink: state.deepLink,
          expiresAt: state.expiresAt,
          linkRef: state.linkRef,
        }),
      );
    } catch {
      // Browser storage is optional: the newly issued link still opens.
    }
    return state.deepLink;
  }
  try {
    const raw = window.sessionStorage.getItem(sessionKey);
    const saved = savedLinkSchema.safeParse(
      raw === null ? null : JSON.parse(raw),
    );
    if (
      saved.success &&
      saved.data.linkRef === state.linkRef &&
      saved.data.expiresAt === state.expiresAt
    ) {
      return saved.data.deepLink;
    }
  } catch {
    // A denied storage read or malformed record falls back to the existing Access path.
  }
  clearTelegramLinkSession();
  return null;
}

export function clearTelegramLinkSession(): void {
  try {
    window.sessionStorage.removeItem(sessionKey);
  } catch {
    // Browser storage can be disabled independently of linking.
  }
}
