import { z } from 'zod';
import { encodeNotification, digestNotificationPayload, type NotificationLane } from '../../../infrastructure/notification-transport/wire.js';

// AJV at the transport boundary enforces the complete immutable bundle. These codecs
// select the application fields and infer domain types; they never authenticate a producer.
const id = z.uuid().transform(value => value.toLowerCase());
const revision = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });
export const channelSchema = z.enum(['email', 'telegram']);
export type Channel = z.infer<typeof channelSchema>;
export const eventSchema = z.object({
  contractVersion: z.literal('inside.notification-event.v1'), messageId: id,
  eventType: z.enum(['billing.notice-ready', 'material.published']),
  accountRef: z.string().optional(), kind: z.string().optional(), occurrenceRef: id, sourceRef: z.string(), sourceRevision: revision, occurredAt: instant, notAfter: instant,
});
export type NotificationEvent = z.infer<typeof eventSchema>;
export const bindingSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), accountRef: z.string(), contactRef: id, contactRevision: revision }),
  z.object({ channel: z.literal('telegram'), accountRef: z.string(), telegramIdentityRef: z.string(), linkRef: id, linkRevision: revision }),
]);
export type Binding = z.infer<typeof bindingSchema>;
export const contentSchema = z.discriminatedUnion('category', [
  z.object({ category: z.literal('material'), kind: z.literal('material_published') }),
  z.object({ category: z.literal('subscription'), kind: z.enum(['renewal_reminder', 'payment_succeeded', 'payment_failed', 'renewal_cancelled', 'access_expired', 'refund_resolved']) }),
]);
export const deliverySchema = z.object({
  contractVersion: z.literal('inside.notification-delivery.v1'), operationId: id,
  notificationRef: id, deliveryRef: id, commandRevision: revision, sourceEventId: id,
  content: contentSchema, templateRef: z.string(), templateRevision: revision,
  text: z.string(), subject: z.string().optional(), issuedAt: instant, notAfter: instant, binding: bindingSchema,
});
export type DeliveryCommand = z.infer<typeof deliverySchema>;
export const resultSchema = z.object({
  contractVersion: z.literal('inside.notification-result.v1'), messageId: id, operationId: id,
  deliveryRef: id, commandRevision: revision, payloadDigest: z.string(), resultRevision: revision,
  channel: channelSchema, recordedAt: instant,
  state: z.enum(['accepted', 'retrying', 'suppressed', 'unknown', 'sent', 'failed']),
  reason: z.string().optional(), attemptRef: id.nullable().optional(), receiptRef: id.optional(), nextAttemptAt: instant.optional(),
});
export type DeliveryResult = z.infer<typeof resultSchema>;
export const authorizeSchema = z.strictObject({
  contractVersion: z.literal('inside.notification-dispatch.v1'), operationId: id,
  deliveryOperationId: id, deliveryRef: id, commandRevision: revision,
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u), attemptRef: id,
});
export type AuthorizeRequest = z.infer<typeof authorizeSchema>;
export const dispatchResponseSchema = z.discriminatedUnion('status', [
  authorizeSchema.extend({ status: z.literal('allowed'), permitRef: id, validUntil: instant }),
  authorizeSchema.extend({ status: z.literal('denied'), reason: z.enum(['expired', 'superseded', 'preference_disabled', 'access_denied', 'binding_conflict', 'not_found', 'payload_conflict']) }),
  authorizeSchema.extend({ status: z.literal('error'), code: z.enum(['malformed', 'unauthorized', 'unsupported_contract', 'operation_conflict', 'unavailable']) }),
]);
export type DispatchResponse = z.infer<typeof dispatchResponseSchema>;
export function parseWire<T>(lane: NotificationLane, input: unknown, schema: z.ZodType<T>) {
  const envelope = encodeNotification(lane, input);
  return { envelope, value: schema.parse(JSON.parse(envelope.payload)) };
}
export function fingerprint(input: unknown): string {
  const jsonSchema = z.json();
  type Json = z.infer<typeof jsonSchema>;
  const sort = (value: Json): Json => Array.isArray(value) ? value.map(sort) : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sort(item)])) : value;
  return digestNotificationPayload(JSON.stringify(sort(z.json().parse(input))));
}
export const COMMAND_LIFETIME_MS = 10 * 60 * 1_000;
// Both ends of the window come from one clock reading. A second reading can declare a lifetime
// longer than the one the command's own consumer accepts, and such a command is quarantined instead
// of delivered. A deadline already reached leaves no window at all, and there is no command to issue.
export function commandWindow(issuedAt: Date, deadline: Date) {
  if (deadline <= issuedAt) return null;
  return { issuedAt: issuedAt.toISOString(), notAfter: new Date(Math.min(deadline.getTime(), issuedAt.getTime() + COMMAND_LIFETIME_MS)).toISOString() };
}
export const PERMIT_LIFETIME_MS = 5_000;
export const MATERIAL_LIFETIME_MS = 24 * 60 * 60 * 1_000;
