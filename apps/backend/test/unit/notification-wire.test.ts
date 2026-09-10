import { expect, test } from 'vitest';
import fixtures from '../../../../docs/contracts/notifications-v1/fixtures.json' with { type: 'json' };
import { encodeNotification, NOTIFICATION_MESSAGE_MAX_BYTES } from '../../src/infrastructure/notification-transport/wire.js';
import { parseNotificationsConfig } from '../../src/config/notifications-config.js';
import { commandWindow, COMMAND_LIFETIME_MS } from '../../src/modules/notifications/domain/notification-wire.js';

const event = fixtures.find(fixture => fixture.valid && fixture.definition === 'billingEvent')?.value;
const command = fixtures.find(fixture => fixture.valid && fixture.definition === 'telegramDelivery')?.value;
test('wire boundary rejects unknown fields and a trusted exchange cannot relabel another source', () => {
  expect(() => encodeNotification('billing', { ...event, unexpected: true })).toThrow('invalid_notification');
  expect(() => encodeNotification('materials', event)).toThrow('route_mismatch');
  expect(() => encodeNotification('emailSubscription', command)).toThrow('route_mismatch');
});
test('canonical IDs and sorted keys preserve immutable fingerprints without altering text or opaque refs', () => {
  const upper = { ...event, messageId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' };
  const envelope = encodeNotification('billing', upper);
  expect(envelope.messageId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(encodeNotification('billing', { ...upper, messageId: envelope.messageId }).digest).toBe(envelope.digest);
  expect(encodeNotification('billing', Object.fromEntries(Object.entries(upper).reverse())).payload).toBe(envelope.payload);
  expect(Buffer.byteLength(envelope.payload)).toBeLessThanOrEqual(NOTIFICATION_MESSAGE_MAX_BYTES);
});
test('broker configuration requires separate principals, vhost and production TLS without reflecting secrets', () => {
  const urls = Object.fromEntries(['billing', 'materials', 'notifications', 'email'].map(principal => [principal, `amqps://${principal}:secret@broker/inside-production`]));
  expect(parseNotificationsConfig({ NODE_ENV: 'production', NOTIFICATIONS_BROKER_URLS: JSON.stringify(urls) })).toMatchObject({ prefetch: 4, quarantineCapacity: 1000 });
  expect(() => parseNotificationsConfig({ NOTIFICATIONS_BROKER_URLS: JSON.stringify({ ...urls, email: urls.billing }) })).toThrow('Invalid Notifications broker configuration');
  expect(() => parseNotificationsConfig({ NOTIFICATIONS_BROKER_URLS: JSON.stringify(Object.fromEntries(Object.entries(urls).map(([key, value]) => [key, value.replace('amqps:', 'amqp:')])))})).toThrow('Notifications require AMQPS');
  expect(parseNotificationsConfig({})).toBeUndefined();
});
test('a command window is bounded by one clock reading and disappears once the source deadline is reached', () => {
  const issuedAt = new Date('2026-09-08T12:00:00.000Z');
  const far = commandWindow(issuedAt, new Date(issuedAt.getTime() + 86_400_000));
  // The consumer rejects `notAfter - issuedAt > COMMAND_LIFETIME_MS`, so a second reading of the
  // clock would be enough to lose the command; both ends are derived from the reading passed in.
  expect(far).toEqual({ issuedAt: issuedAt.toISOString(), notAfter: new Date(issuedAt.getTime() + COMMAND_LIFETIME_MS).toISOString() });
  expect(commandWindow(issuedAt, new Date(issuedAt.getTime() + 1_000))).toEqual({ issuedAt: issuedAt.toISOString(), notAfter: new Date(issuedAt.getTime() + 1_000).toISOString() });
  // `issuedAt < notAfter` is the other half of the same clause: an exhausted deadline has no window.
  expect(commandWindow(issuedAt, issuedAt)).toBeNull();
  expect(commandWindow(issuedAt, new Date(issuedAt.getTime() - 1))).toBeNull();
});
