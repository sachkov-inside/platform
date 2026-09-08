import { z } from 'zod';
import { createPrismaClient } from '../../../src/infrastructure/prisma/index.js';
import { assembleNotificationOutbox } from '../../../src/infrastructure/notification-transport/outbox.js';
import { connectNotificationBroker, consumeNotificationLane, publishNotification } from '../../../src/infrastructure/notification-transport/rabbitmq.js';
import { assembleNotificationTransport } from '../../../src/modules/notifications/index.js';
const config = z.object({ databaseUrl: z.string(), url: z.string(), caFile: z.string(), phase: z.string() }).parse(JSON.parse(process.env.CRASH_CONFIG ?? 'null'));
const prisma = createPrismaClient(config.databaseUrl);
const connection = await connectNotificationBroker(config);
const boundary = async () => { process.send?.('boundary'); await new Promise(() => undefined); };
if (config.phase.includes('confirm')) {
  await assembleNotificationOutbox(prisma.billingNotificationOutbox, ['billing']).relay('billing', async envelope => {
    if (config.phase === 'before-confirm') await boundary();
    await publishNotification(connection, envelope);
    await boundary();
  });
} else {
  const transport = assembleNotificationTransport(prisma, 100);
  await consumeNotificationLane(connection, 'billing', {
    ...transport,
    async accept(envelope) {
      if (config.phase === 'before-inbox') await boundary();
      const result = await transport.accept(envelope);
      if (config.phase === 'after-inbox') await boundary();
      // The adapter acks synchronously after this method resolves, before the next event-loop turn.
      setImmediate(() => process.send?.('boundary'));
      return result;
    },
  }, 1);
}
