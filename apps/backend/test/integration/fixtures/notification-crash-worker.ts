import { z } from 'zod';
import { crashWorkerSignals } from '../setup/crash-worker-protocol.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/index.js';
import { assembleNotificationOutbox } from '../../../src/infrastructure/notification-transport/outbox.js';
import { connectNotificationBroker, consumeNotificationLane, publishNotification } from '../../../src/infrastructure/notification-transport/rabbitmq.js';
import { assembleNotificationTransport } from '../../../src/modules/notifications/index.js';
const config = z.object({ databaseUrl: z.string(), url: z.string(), caFile: z.string(), phase: z.string() }).parse(JSON.parse(process.env.CRASH_CONFIG ?? 'null'));
const prisma = createPrismaClient(config.databaseUrl);
const connection = await connectNotificationBroker(config);
// Готовность отделена от проверяемого поведения: загрузка tsx, TLS-рукопожатие с брокером и запуск
// движка Prisma занимают столько, сколько занимают на этой машине, и не должны попадать в бюджет
// ожидания транспорта. Prisma подключается лениво, поэтому её соединение открывается здесь явно:
// иначе первый же запрос внутри проверяемого поведения оплатил бы запуск движка из чужого бюджета.
await prisma.$connect();
process.send?.(crashWorkerSignals.ready);
const boundary = async () => { process.send?.(crashWorkerSignals.boundary); await new Promise(() => undefined); };
if (config.phase.includes('confirm')) {
  await assembleNotificationOutbox(prisma.billingNotificationOutbox, ['billing']).relay('billing', async envelope => {
    if (config.phase === 'before-confirm') {
      // Intercept only confirm observation at the SDK boundary; publish still uses real AMQPS.
      const createChannel = connection.createConfirmChannel.bind(connection);
      connection.createConfirmChannel = async () => {
        const channel = await createChannel();
        const publish = channel.publish.bind(channel);
        channel.publish = (exchange, key, content, options, _confirm) => {
          const writable = publish(exchange, key, content, options, () => undefined);
          void boundary();
          return writable;
        };
        return channel;
      };
    }
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
      setImmediate(() => process.send?.(crashWorkerSignals.boundary));
      return result;
    },
  }, 1);
}
