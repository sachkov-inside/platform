import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PLATFORM_CONFIG, type PlatformConfig } from '../config/platform-config.js';
import { OperationalReadiness } from '../infrastructure/operational-readiness.js';
import { PrismaClientProvider } from '../infrastructure/prisma/index.js';
import { runWorker } from '../infrastructure/worker-runtime.js';
import { assembleNotificationWorker } from '../infrastructure/notification-transport/worker.js';
import { assembleBillingNotificationOutbox } from '../modules/billing/index.js';
import { assembleMaterialsNotificationOutbox } from '../modules/materials/index.js';
import { Notifications, assembleNotificationEmailSender } from '../modules/notifications/index.js';
import { NotificationsWorkerModule } from './notifications-worker/notifications-worker.module.js';

void bootstrap().catch(() => {
  console.error(JSON.stringify({ process: 'notifications-worker', status: 'operator_attention', reason: 'worker_stopped' }));
  process.exitCode = 1;
});
async function bootstrap() {
  const application = await NestFactory.createApplicationContext(NotificationsWorkerModule);
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  if (!config.notifications) { await application.close(); throw new Error('Notifications configuration required'); }
  const prisma = application.get(PrismaClientProvider);
  const notifications = application.get(Notifications);
  const sendEmail = config.billingContact && config.notificationDelivery ? assembleNotificationEmailSender(config.billingContact) : undefined;
  const worker = assembleNotificationWorker({
    config: config.notifications,
    billing: assembleBillingNotificationOutbox(prisma), materials: assembleMaterialsNotificationOutbox(prisma),
    transport: notifications.transport,
    processInbox: () => notifications.sweep(sendEmail),
    report: event => console.info(JSON.stringify({ process: 'notifications-worker', ...event })),
  });
  await runWorker({ application, databaseUrl: config.database.url, jobs: worker, failed: worker.failed,
    process: 'notifications-worker', readiness: application.get(OperationalReadiness), registerJobs: () => Promise.resolve(),
  });
}
