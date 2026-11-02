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
import { assembleNotificationRecipients } from "./assemble-notification-recipients.js";

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
              canReadAccounts: async (accountIds, sourceRef) => {
                if (access.authorizeAccounts === undefined)
                  throw new Error("notification_account_batch_unavailable");
                const decisions = await access.authorizeAccounts({
                  accountIds: accountIds.map(accountId),
                  resource: {
                    kind: "material",
                    materialId: materialId(sourceRef),
                  },
                  action: "read",
                  enforcementPoint: "published_material_read",
                  correlationId: "notifications",
                });
                return new Map(
                  [...decisions].map(([id, decision]) => [
                    id,
                    decision.effect === "allow"
                      ? ("allowed" as const)
                      : decision.reason === "dependency_unavailable"
                        ? ("unavailable" as const)
                        : ("denied" as const),
                  ]),
                );
              },
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
            recipients: assembleNotificationRecipients(
              contacts,
              payments,
              telegram,
            ),
          },
          accounts,
          config.notifications?.quarantineCapacity,
        ),
    },
  ],
  exports: [Notifications],
})
export class NotificationsModule {}
