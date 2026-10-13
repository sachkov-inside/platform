import type { NotificationAccounts } from "../accounts/index.js";
import type { BillingPayments } from "../billing/index.js";
import type { TelegramAccountLinks } from "../telegram-membership/index.js";
import { hasText } from "../../infrastructure/contracts/text.js";
import type { NotificationRecipients } from "./ports/notification-sources.js";

/** The same recipient policy for Nest and framework-free process/test composition. */
export function assembleNotificationRecipients(
  contacts: Pick<
    NotificationAccounts,
    "enumerate" | "exists" | "email" | "binding"
  >,
  payments: Pick<BillingPayments, "purchaseEmail">,
  telegram: Pick<TelegramAccountLinks, "readBinding">,
): NotificationRecipients {
  return {
    enumerate: (query) => contacts.enumerate(query),
    exists: (account) => contacts.exists(account),
    email: async (binding) => {
      if (binding.contactRef === binding.accountRef)
        return contacts.email(binding);
      if (binding.contactRevision !== 1) return null;
      const result = await payments.purchaseEmail(
        binding.accountRef,
        binding.contactRef,
      );
      if (!result.ok) throw new Error("notification_order_contact_unavailable");
      return result.value;
    },
    binding: async (account, channel, source) => {
      if (channel === "email") {
        const verified = await contacts.binding(account);
        if (verified !== null) return verified;
        if (
          source?.status !== "current" ||
          source.accountId !== account ||
          source.purchaseRef === undefined
        )
          return null;
        const result = await payments.purchaseEmail(
          account,
          source.purchaseRef,
        );
        if (!result.ok)
          throw new Error("notification_order_contact_unavailable");
        return result.value === null
          ? null
          : {
              channel: "email",
              accountRef: account,
              contactRef: source.purchaseRef,
              contactRevision: 1,
            };
      }
      const result = await telegram.readBinding({ accountId: account });
      if (!result.ok) throw new Error("notification_binding_unavailable");
      return hasText(result.binding?.telegramIdentityRef) &&
        hasText(result.binding.accountRef)
        ? {
            channel: "telegram",
            ...result.binding,
            accountRef: result.binding.accountRef,
            telegramIdentityRef: result.binding.telegramIdentityRef,
          }
        : null;
    },
  };
}
