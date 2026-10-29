import type { AccountId } from "../../modules/accounts/index.js";
import type { TelegramLinks } from "../../modules/content-access/index.js";
import type { TelegramAccountLinks } from "../../modules/telegram-membership/index.js";

/** Content Access reads the confirmed Telegram links that Telegram Integration owns (#1825). */
export function assembleTelegramLinks(
  links: Pick<TelegramAccountLinks, "readConfirmedLinks">,
): TelegramLinks {
  return Object.freeze({
    async confirmedLinks(accountIds: readonly AccountId[]) {
      const read = await links.readConfirmedLinks(accountIds);
      if (!read.ok) return read;
      return {
        ok: true as const,
        links: new Map(
          accountIds.map((id) => [id, read.links.get(id) === true] as const),
        ),
      };
    },
  });
}
