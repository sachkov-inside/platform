import { Module } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaModule,
  PrismaClientProvider,
} from "../../infrastructure/prisma/index.js";
import {
  AccountsModule,
  ACCOUNTS,
  NotificationAccounts,
  accountId,
  type Accounts,
} from "../accounts/index.js";
import {
  BillingModule,
  BillingNotices,
  BillingPayments,
} from "../billing/index.js";
import {
  TelegramAccountLinksModule,
  TelegramAccountLinks,
} from "../telegram-membership/index.js";
import {
  MaterialAnnouncements,
  MaterialsModule,
  materialId,
} from "../materials/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import type { NotificationEvent } from "./domain/notification-wire.js";
import type { NotificationSource } from "./ports/notification-sources.js";
import { Notifications } from "./facets/notifications/notifications.js";
import {
  NotificationPreferencesController,
  NotificationOperationsController,
} from "./features/read-deliveries/notifications.controller.js";
import { NotificationDispatchController } from "./features/authorize-dispatch/notification-dispatch.controller.js";
import { hasText } from "../../infrastructure/contracts/text.js";

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    TelegramAccountLinksModule,
    MaterialsModule,
    BillingModule,
  ],
  controllers: [
    NotificationPreferencesController,
    NotificationOperationsController,
    NotificationDispatchController,
  ],
  providers: [
    {
      provide: Notifications,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        NotificationAccounts,
        TelegramAccountLinks,
        CONTENT_ACCESS,
        PLATFORM_CONFIG,
        BillingNotices,
        BillingPayments,
        MaterialAnnouncements,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        contacts: NotificationAccounts,
        telegram: TelegramAccountLinks,
        access: ContentAccess,
        config: PlatformConfig,
        notices: BillingNotices,
        payments: BillingPayments,
        announcements: MaterialAnnouncements,
      ) =>
        new Notifications(
          {
            // Адрес читателя может отсутствовать: без настройки доставки повод ждёт, а не падает.
            prisma,
            now: () => new Date(),
            origin: config.notificationDelivery?.origin,
            sources: {
              // Каждый источник подтверждает свой повод собственными фактами: Billing — поводом оплаты,
              // Materials — анонсом первой публикации. Данные брокера сами по себе отправку не разрешают.
              // Таблица закрыта типом события: следующий источник обязан назвать здесь своего владельца,
              // иначе его события молча спрашивали бы чужой повод.
              resolve: (event) =>
                (
                  ({
                    "billing.notice-ready": () => notices.resolveNotice(event),
                    "material.published": () =>
                      announcements.resolveAnnouncement(event),
                  }) satisfies Record<
                    NotificationEvent["eventType"],
                    () => Promise<NotificationSource>
                  >
                )[event.eventType](),
              canRead: async (account, sourceRef) => {
                const decision = await access.authorize({
                  subject: { kind: "account", accountId: accountId(account) },
                  resource: {
                    kind: "material",
                    materialId: materialId(sourceRef),
                  },
                  action: "read",
                  enforcementPoint: "published_material_read",
                  correlationId: "notifications",
                });
                return decision.effect === "allow"
                  ? "allowed"
                  : decision.reason === "dependency_unavailable"
                    ? "unavailable"
                    : "denied";
              },
            },
            recipients: {
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
                if (!result.ok)
                  throw new Error("notification_order_contact_unavailable");
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
                const result = await telegram.readBinding({
                  accountId: account,
                });
                if (!result.ok)
                  throw new Error("notification_binding_unavailable");
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
            },
          },
          accounts,
          config.notifications?.quarantineCapacity,
        ),
    },
  ],
  exports: [Notifications],
})
export class NotificationsModule {}
