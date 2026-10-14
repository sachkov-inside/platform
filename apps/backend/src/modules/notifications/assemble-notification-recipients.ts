import type { NotificationAccounts } from "../accounts/index.js";
import type { BillingPayments } from "../billing/index.js";
import type { TelegramAccountLinks } from "../telegram-membership/index.js";
import { hasText } from "../../infrastructure/contracts/text.js";
import { settle } from "./features/expand-audience/expand-audience.js";
import type { Binding } from "./domain/notification-wire.js";
import type { NotificationRecipients } from "./ports/notification-sources.js";

/** The same recipient policy for Nest and framework-free process/test composition. */
export function assembleNotificationRecipients(
  contacts: Pick<
    NotificationAccounts,
    "enumerate" | "exists" | "email" | "binding"
  > &
    Partial<Pick<NotificationAccounts, "bindings">>,
  payments: Pick<BillingPayments, "purchaseEmail">,
  telegram: Pick<TelegramAccountLinks, "readBinding"> &
    Partial<Pick<TelegramAccountLinks, "readBindings">>,
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
    bindings: async (accountIds, source) => {
      const emails = await settle(() =>
        contacts.bindings === undefined
          ? Promise.all(
              accountIds.map(
                async (id) => [id, await contacts.binding(id)] as const,
              ),
            ).then((rows) => new Map(rows))
          : contacts.bindings(accountIds),
      );
      const telegrams = await settle(async () => {
        if (telegram.readBindings === undefined)
          return new Map(
            await Promise.all(
              accountIds.map(async (id) => {
                const result = await telegram.readBinding({ accountId: id });
                if (!result.ok)
                  throw new Error("notification_binding_unavailable");
                return [id, result.binding] as const;
              }),
            ),
          );
        const result = await telegram.readBindings(accountIds);
        if (!result.ok) throw new Error("notification_binding_unavailable");
        return result.bindings;
      });
      const result = new Map<
        string,
        {
          email: PromiseSettledResult<Binding | null>;
          telegram: PromiseSettledResult<Binding | null>;
        }
      >();
      for (const account of accountIds) {
        let email: PromiseSettledResult<Binding | null> =
          emails.status === "rejected"
            ? emails
            : { status: "fulfilled", value: emails.value.get(account) ?? null };
        if (
          email.status === "fulfilled" &&
          email.value === null &&
          source?.status === "current" &&
          source.accountId === account &&
          source.purchaseRef !== undefined
        ) {
          const purchaseRef = source.purchaseRef;
          email = await settle(async () => {
            const contact = await payments.purchaseEmail(account, purchaseRef);
            if (!contact.ok)
              throw new Error("notification_order_contact_unavailable");
            return contact.value === null
              ? null
              : {
                  channel: "email" as const,
                  accountRef: account,
                  contactRef: purchaseRef,
                  contactRevision: 1,
                };
          });
        }
        const binding =
          telegrams.status === "fulfilled"
            ? telegrams.value.get(account)
            : undefined;
        result.set(account, {
          email,
          telegram:
            telegrams.status === "rejected"
              ? telegrams
              : {
                  status: "fulfilled",
                  value:
                    hasText(binding?.telegramIdentityRef) &&
                    hasText(binding.accountRef)
                      ? {
                          channel: "telegram",
                          ...binding,
                          accountRef: binding.accountRef,
                          telegramIdentityRef: binding.telegramIdentityRef,
                        }
                      : null,
                },
        });
      }
      return result;
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
