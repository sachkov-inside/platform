import { setTimeout as delay } from 'node:timers/promises';
import type { ChannelModel } from 'amqplib';
import type { NotificationsConfig } from '../../config/notifications-config.js';
import type { NotificationTransport } from '../../modules/notifications/index.js';
import type { NotificationOutbox } from './outbox.js';
import { notificationLaneSchema, lanes, type NotificationLane, type NotificationPrincipal } from './wire.js';
import { connectNotificationBroker, consumeNotificationLane, publishNotification } from './rabbitmq.js';

const RELAY_SWEEP_MS = 1_000;
const OBSERVATION_INTERVAL_MS = 60_000;
const BACKLOG_ALERT_MS = 5 * 60 * 1_000;
export function assembleNotificationWorker(input: {
  config: NotificationsConfig; transport: NotificationTransport;
  billing: NotificationOutbox; materials: NotificationOutbox;
  report: (event: Record<string, unknown>) => void;
}) {
  const connections = new Map<NotificationPrincipal, ChannelModel>();
  const consumers: Awaited<ReturnType<typeof consumeNotificationLane>>[] = [];
  const abort = new AbortController();
  const tasks: Promise<void>[] = [];
  let stopping = false;
  let fail!: (error: Error) => void;
  const failed = new Promise<void>((_resolve, reject) => { fail = reject; });
  void failed.catch(() => undefined);
  async function sweep(lane: NotificationLane, connection: ChannelModel) {
    const source = lane === 'billing' ? input.billing : lane === 'materials' ? input.materials : input.transport.outbox;
    while (!abort.signal.aborted) {
      try { await source.relay(lane, envelope => publishNotification(connection, envelope)); }
      catch { input.report({ status: 'operator_attention', reason: 'publish_not_confirmed', lane }); }
      await delay(RELAY_SWEEP_MS, undefined, { signal: abort.signal }).catch(() => undefined);
    }
  }
  return {
    failed,
    async start() {
      try {
        for (const principal of ['billing', 'materials', 'notifications', 'email'] as const) {
          const connection = await connectNotificationBroker({ url: input.config.urls[principal], ...(input.config.caFile ? { caFile: input.config.caFile } : {}) });
          connections.set(principal, connection);
          connection.on('close', () => { if (!stopping) fail(new Error('notification_broker_disconnected')); });
        }
        for (const lane of Object.keys(lanes).map(key => notificationLaneSchema.parse(key))) {
          const route = lanes[lane];
          const publisher = connections.get(route.publisher);
          if (publisher) tasks.push(sweep(lane, publisher));
          const consumer = connections.get(route.consumer);
          if (consumer) {
            const handle = await consumeNotificationLane(consumer, lane, input.transport, input.config.prefetch);
            consumers.push(handle);
            void handle.failed.catch(() => fail(new Error('notification_consumer_stopped')));
          }
        }
        tasks.push((async () => {
          while (!abort.signal.aborted) {
            const observation = await input.transport.observe();
            input.report({ status: observation.oldest && Date.now() - observation.oldest.getTime() > BACKLOG_ALERT_MS ? 'operator_attention' : 'transport_observation', ...observation });
            await delay(OBSERVATION_INTERVAL_MS, undefined, { signal: abort.signal }).catch(() => undefined);
          }
        })());
        for (const task of tasks) void task.catch(() => fail(new Error('notification_worker_failed')));
      } catch {
        await this.stop();
        throw new Error('notification_worker_start_failed');
      }
    },
    async stop() {
      stopping = true;
      abort.abort();
      await Promise.allSettled(consumers.map(consumer => consumer.stop()));
      await Promise.allSettled(tasks);
      await Promise.allSettled([...connections.values()].map(connection => connection.close()));
    },
  };
}
