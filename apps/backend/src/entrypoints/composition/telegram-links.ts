import type { AccountId } from "../../modules/accounts/index.js";
import type { TelegramLinks } from "../../modules/content-access/index.js";
import type { TelegramAccountLinks } from "../../modules/telegram-membership/index.js";

/**
 * Content Access reads the confirmed Telegram links that Telegram Integration owns (#1825): a
 * current binding with a principal and a verified identity, by the same rule as recipients.
 */
export function composeTelegramLinks(
  links: Pick<TelegramAccountLinks, "readBindings">,
): TelegramLinks {
  return Object.freeze({
    async confirmedLinks(
      accountIds: readonly AccountId[],
    ): Promise<ReadonlyMap<string, boolean>> {
      const result = await links.readBindings(accountIds);
      if (!result.ok) throw new Error("Telegram link read failed");
      return new Map(
        accountIds.map((accountId): readonly [string, boolean] => {
          const binding = result.bindings.get(accountId);
          return [
            accountId,
            binding != null &&
              binding.accountRef !== null &&
              binding.telegramIdentityRef !== null,
          ];
        }),
      );
    },
  });
}
