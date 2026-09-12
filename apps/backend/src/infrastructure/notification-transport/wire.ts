import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { notificationSchema } from './schema.generated.js';

export const NOTIFICATION_MESSAGE_MAX_BYTES = 16 * 1024;
// Протокол ленты материалов: notAfter события первой публикации — ровно сутки от самой
// публикации. Producer и consumer сверяют одно и то же число, поэтому оно живёт рядом с lanes.
export const MATERIAL_EVENT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const lanes = {
  billing: { exchange: 'inside.events.billing.v1', key: 'billing.notice-ready', queue: 'platform.notifications.billing.v1', publisher: 'billing', consumer: 'notifications', version: 'inside.notification-event.v1' },
  materials: { exchange: 'inside.events.materials.v1', key: 'material.published', queue: 'platform.notifications.materials.v1', publisher: 'materials', consumer: 'notifications', version: 'inside.notification-event.v1' },
  telegramSubscription: { exchange: 'inside.notifications.telegram.v1', key: 'subscription', queue: 'telegram.notifications.subscription.v1', publisher: 'notifications', consumer: 'telegram', version: 'inside.notification-delivery.v1' },
  telegramMaterial: { exchange: 'inside.notifications.telegram.v1', key: 'material', queue: 'telegram.notifications.material.v1', publisher: 'notifications', consumer: 'telegram', version: 'inside.notification-delivery.v1' },
  emailSubscription: { exchange: 'inside.notifications.email.v1', key: 'subscription', queue: 'email.notifications.subscription.v1', publisher: 'notifications', consumer: 'email', version: 'inside.notification-delivery.v1' },
  emailMaterial: { exchange: 'inside.notifications.email.v1', key: 'material', queue: 'email.notifications.material.v1', publisher: 'notifications', consumer: 'email', version: 'inside.notification-delivery.v1' },
  telegramResult: { exchange: 'inside.results.telegram.v1', key: 'delivery.result', queue: 'platform.notification-results.telegram.v1', publisher: 'telegram', consumer: 'notifications', version: 'inside.notification-result.v1' },
  emailResult: { exchange: 'inside.results.email.v1', key: 'delivery.result', queue: 'platform.notification-results.email.v1', publisher: 'email', consumer: 'notifications', version: 'inside.notification-result.v1' },
} as const;
export type NotificationLane = keyof typeof lanes;
export type NotificationPrincipal = (typeof lanes)[NotificationLane]['publisher'];
export const notificationLaneSchema = z.custom<NotificationLane>(value => typeof value === 'string' && Object.hasOwn(lanes, value));
const ajv = new Ajv({ strict: true });
addFormats.default(ajv);
const validate = ajv.compile(notificationSchema);
// Only fields declared as UUID identifiers are normalized; opaque refs and text stay byte-faithful.
const uuidFields = new Set(['messageId', 'operationId', 'occurrenceRef', 'notificationRef', 'deliveryRef', 'sourceEventId', 'attemptRef', 'receiptRef', 'linkRef', 'contactRef']);
const routingShape = z.looseObject({
  contractVersion: z.string(), messageId: z.uuid().optional(), operationId: z.uuid().optional(),
  eventType: z.string().optional(), channel: z.string().optional(),
  content: z.object({ category: z.string() }).optional(),
  binding: z.object({ channel: z.string() }).optional(),
});
export interface NotificationEnvelope {
  readonly lane: NotificationLane;
  readonly messageId: string;
  readonly version: string;
  readonly payload: string;
  readonly digest: string;
}
export function digestNotificationPayload(payload: string | Buffer): string {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
const jsonSchema = z.json();
type Json = z.infer<typeof jsonSchema>;
function canonical(value: Json, key = ''): Json {
  if (typeof value === 'string') return uuidFields.has(key) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(item => canonical(item));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v, k)]));
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('invalid_number');
  return value;
}
export function encodeNotification(lane: NotificationLane, input: unknown): NotificationEnvelope {
  if (!validate(input)) throw new Error('invalid_notification');
  const body = routingShape.parse(input);
  const route = lanes[lane];
  const channel = lane.startsWith('telegram') ? 'telegram' : 'email';
  if (body.contractVersion !== route.version ||
    (route.version === 'inside.notification-event.v1' && body.eventType !== route.key) ||
    (route.version === 'inside.notification-delivery.v1' && (body.content?.category !== route.key || body.binding?.channel !== channel)) ||
    (route.version === 'inside.notification-result.v1' && body.channel !== channel)) throw new Error('route_mismatch');
  const payload = JSON.stringify(canonical(z.json().parse(input)));
  if (Buffer.byteLength(payload) > NOTIFICATION_MESSAGE_MAX_BYTES) throw new Error('message_too_large');
  const messageId = route.version === 'inside.notification-delivery.v1' ? body.operationId : body.messageId;
  if (!messageId) throw new Error('missing_message_id');
  return { lane, messageId: messageId.toLowerCase(), version: route.version, payload, digest: digestNotificationPayload(payload) };
}

const FAILURE_TEXT_LIMIT = 300;
const providerErrorSchema = z.object({ name: z.string(), code: z.string().optional() });
/**
 * Причина отказа для журнала. Своя ошибка называется текстом, а ошибка драйвера базы и отказ
 * разбора JSON — только именем: их текст пересказывает переданный объект или сам разбираемый
 * payload, то есть адрес получателя и содержимое сообщения. Укорочение здесь — предел, а не защита.
 */
export function loggableFailure(error: unknown): string {
  const provider = providerErrorSchema.safeParse(error);
  if (provider.success && provider.data.name.startsWith('Prisma')) {
    return `${provider.data.name}${provider.data.code === undefined ? '' : `: ${provider.data.code}`}`;
  }
  // Отказ разбора JSON цитирует кусок разбираемого текста, поэтому у него остаётся только имя.
  if (error instanceof SyntaxError) return error.name;
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, FAILURE_TEXT_LIMIT);
}
