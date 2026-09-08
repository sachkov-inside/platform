import { readFile } from 'node:fs/promises';
import { connect, type ChannelModel, type Channel, type ConsumeMessage } from 'amqplib';
import { encodeNotification, lanes, NOTIFICATION_MESSAGE_MAX_BYTES, type NotificationEnvelope, type NotificationLane } from './wire.js';

export const BROKER_CONFIRM_TIMEOUT_MS = 5_000;
export interface BrokerConnectionConfig { readonly url: string; readonly caFile?: string }
export async function connectNotificationBroker(config: BrokerConnectionConfig): Promise<ChannelModel> {
  const connection = await connect(config.url, {
    timeout: BROKER_CONFIRM_TIMEOUT_MS,
    ...(config.caFile ? { ca: [await readFile(config.caFile)] } : {}),
  });
  // The owner observes close; never log AMQP errors containing URLs or credentials.
  connection.on('error', () => undefined);
  return connection;
}
export async function publishNotification(connection: ChannelModel, envelope: NotificationEnvelope): Promise<void> {
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => undefined);
  const route = lanes[envelope.lane];
  let returned = false;
  channel.on('return', () => { returned = true; });
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('publisher_confirm_timeout')), BROKER_CONFIRM_TIMEOUT_MS);
      channel.once('close', () => reject(new Error('publisher_channel_closed')));
      // One in-flight publish on this channel bounds buffering and makes return correlation exact.
      channel.publish(route.exchange, route.key, Buffer.from(envelope.payload), {
        persistent: true, mandatory: true, contentType: 'application/json',
        messageId: envelope.messageId, type: envelope.version,
      }, error => {
        if (error || returned) reject(new Error(returned ? 'publisher_return' : 'publisher_nack'));
        else resolve();
      });
    });
  } finally {
    clearTimeout(timer);
    await channel.close().catch(() => undefined);
  }
}
export interface NotificationReceiver {
  accept(envelope: NotificationEnvelope): Promise<'accepted' | 'duplicate' | 'conflict'>;
  quarantine(lane: NotificationLane, bytes: Buffer, reason: string): Promise<void>;
}
export function decodeNotification(lane: NotificationLane, message: ConsumeMessage): NotificationEnvelope {
  const route = lanes[lane];
  if (message.content.length > NOTIFICATION_MESSAGE_MAX_BYTES) throw new Error('message_too_large');
  if (message.fields.exchange !== route.exchange || message.fields.routingKey !== route.key ||
    message.properties.contentType !== 'application/json' || message.properties.type !== route.version ||
    message.properties.deliveryMode !== 2) throw new Error('invalid_transport');
  const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message.content));
  const envelope = encodeNotification(lane, payload);
  if (message.properties.messageId !== envelope.messageId) throw new Error('message_id_mismatch');
  return envelope;
}
export async function consumeNotificationLane(connection: ChannelModel, lane: NotificationLane, receiver: NotificationReceiver, prefetch: number): Promise<{ stop(): Promise<void>; failed: Promise<void> }> {
  const channel: Channel = await connection.createChannel();
  channel.on('error', () => undefined);
  let fail!: (error: Error) => void;
  const failed = new Promise<void>((_resolve, reject) => { fail = reject; });
  // Install a handler immediately, even when startup of another lane is still pending.
  void failed.catch(() => undefined);
  let stopping = false;
  const active = new Set<Promise<void>>();
  channel.on('close', () => { if (!stopping) fail(new Error('consumer_channel_closed')); });
  await channel.prefetch(prefetch);
  const consumer = await channel.consume(lanes[lane].queue, message => {
    if (!message) { fail(new Error('consumer_cancelled')); return; }
    const task = (async () => {
      let envelope: NotificationEnvelope;
      try { envelope = decodeNotification(lane, message); }
      catch {
        await receiver.quarantine(lane, message.content, 'invalid_transport_or_payload');
        channel.ack(message);
        return;
      }
      const result = await receiver.accept(envelope);
      if (result === 'conflict') await receiver.quarantine(lane, message.content, 'payload_conflict');
      // A failed durable write or quarantine admission never reaches this ack.
      channel.ack(message);
    })();
    active.add(task);
    void task.catch(() => {
      fail(new Error('notification_receipt_unavailable'));
      stopping = true;
      void channel.close().catch(() => undefined);
    }).finally(() => active.delete(task));
  }, { noAck: false });
  return {
    failed,
    async stop() {
      stopping = true;
      await channel.cancel(consumer.consumerTag).catch(() => undefined);
      await Promise.allSettled(active);
      await channel.close().catch(() => undefined);
    },
  };
}
