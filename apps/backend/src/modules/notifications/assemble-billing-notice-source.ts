import type { TelegramAccountLinks } from "../telegram-membership/index.js";
import { dependencyFailure } from "../../infrastructure/observability/dependency-failure.js";
import type { NotificationEvent } from "./domain/notification-wire.js";
import type {
  NotificationSource,
  SaleBuyer,
} from "./ports/notification-sources.js";

/**
 * The `billing.notice-ready` source for Nest and framework-free composition. A sale also carries the
 * buyer's current Telegram (#2085): Billing does not know it, so it is read here at every build.
 * An unreadable link is a dependency state, so the build waits instead of sending a guess.
 */
export function assembleBillingNoticeSource(
  notices: {
    resolveNotice(event: NotificationEvent): Promise<NotificationSource>;
  },
  telegram: Pick<TelegramAccountLinks, "readContacts">,
): (event: NotificationEvent) => Promise<NotificationSource> {
  return async (event) => {
    const source = await notices.resolveNotice(event);
    if (
      source.status !== "current" ||
      source.content.kind !== "sale_recorded" ||
      source.sale === undefined
    )
      return source;
    const buyer = await readBuyer(telegram, event.accountRef);
    return buyer === undefined
      ? { status: "unavailable" }
      : { ...source, sale: { ...source.sale, buyer } };
  };
}

async function readBuyer(
  telegram: Pick<TelegramAccountLinks, "readContacts">,
  accountId: string | undefined,
): Promise<SaleBuyer | undefined> {
  if (accountId === undefined) return undefined;
  try {
    const reading = await telegram.readContacts([accountId]);
    if (!reading.ok) return undefined;
    const contact = reading.contacts.get(accountId);
    if (contact === undefined) return undefined;
    if (contact.telegramContactState === "not_linked")
      return { state: "not_linked" };
    if (contact.telegramContactState === "unavailable")
      return { state: "unavailable" };
    return {
      state: "available",
      displayName: contact.displayName,
      username: contact.telegramUsername,
    };
  } catch (error) {
    return dependencyFailure(
      { module: "notifications", operation: "readSaleBuyer" },
      error,
      undefined,
    );
  }
}
