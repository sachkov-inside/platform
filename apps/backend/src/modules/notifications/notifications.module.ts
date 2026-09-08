import { Module } from '@nestjs/common';
import { PLATFORM_CONFIG, type PlatformConfig } from '../../config/platform-config.js';
import { PrismaModule, PrismaClientProvider } from '../../infrastructure/prisma/index.js';
import { AccountsModule, ACCOUNTS, NotificationAccounts, accountId, type Accounts } from '../accounts/index.js';
import { TelegramAccountLinksModule, TelegramAccountLinks } from '../telegram-membership/index.js';
import { MaterialsModule, materialId } from '../materials/index.js';
import { CONTENT_ACCESS, type ContentAccess } from '../content-access/index.js';
import { Notifications } from './facets/notifications/notifications.js';
import { NotificationPreferencesController, NotificationOperationsController } from './features/read-deliveries/notifications.controller.js';
import { NotificationDispatchController } from './features/authorize-dispatch/notification-dispatch.controller.js';

@Module({
  imports: [PrismaModule, AccountsModule, TelegramAccountLinksModule, MaterialsModule],
  controllers: [NotificationPreferencesController, NotificationOperationsController, NotificationDispatchController],
  providers: [{ provide: Notifications, inject: [PrismaClientProvider, ACCOUNTS, NotificationAccounts, TelegramAccountLinks, CONTENT_ACCESS, PLATFORM_CONFIG],
    useFactory: (prisma: PrismaClientProvider, accounts: Accounts, contacts: NotificationAccounts, telegram: TelegramAccountLinks, access: ContentAccess, config: PlatformConfig) => new Notifications({
      prisma, now: () => new Date(), origin: config.notificationDelivery?.origin ?? 'https://sachkov.dev',
      sources: {
        // Producer facts and their facets arrive with Billing #410 / first-publication #437.
        // Transport acceptance is durable while an unconnected source remains unavailable.
        resolve: () => Promise.resolve({ status: 'unavailable' }),
        canRead: async (account, sourceRef) => {
          const decision = await access.authorize({ subject: { kind: 'account', accountId: accountId(account) },
            resource: { kind: 'material', materialId: materialId(sourceRef) }, action: 'read', enforcementPoint: 'published_material_read', correlationId: 'notifications' });
          return decision.effect === 'allow' ? 'allowed' : decision.reason === 'dependency_unavailable' ? 'unavailable' : 'denied';
        },
      },
      recipients: {
        enumerate: query => contacts.enumerate(query), exists: account => contacts.exists(account), email: binding => contacts.email(binding),
        binding: async (account, channel) => {
          if (channel === 'email') return contacts.binding(account);
          const result = await telegram.readBinding({ accountId: account });
          if (!result.ok) throw new Error('notification_binding_unavailable');
          return result.binding?.telegramIdentityRef && result.binding.accountRef ? { channel: 'telegram', ...result.binding, accountRef: result.binding.accountRef, telegramIdentityRef: result.binding.telegramIdentityRef } : null;
        },
      },
    }, accounts, config.notifications?.quarantineCapacity) }],
  exports: [Notifications],
})
export class NotificationsModule {}
