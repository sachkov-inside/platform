import { expect, test } from 'vitest';
import { renderNotification } from '../../src/modules/notifications/domain/templates.js';
import type { NotificationSource } from '../../src/modules/notifications/ports/notification-sources.js';

const event = {
  contractVersion: 'inside.notification-event.v1' as const, messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  occurrenceRef: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sourceRef: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  sourceRevision: 1, occurredAt: '2026-09-12T12:00:00.000Z', notAfter: '2026-09-13T12:00:00.000Z',
  eventType: 'billing.notice-ready' as const, accountRef: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kind: 'payment_succeeded' as const,
};
const source: Extract<NotificationSource, { status: 'current' }> = {
  status: 'current', event, content: { category: 'subscription', kind: 'payment_succeeded' },
  accountId: event.accountRef, title: 'Руководство', readerPath: '/account/purchases',
};

test('ссылка читателя ведёт только на сам Platform и только под TLS или по петле', () => {
  expect(renderNotification(source, 'https://inside.example.test').text).toContain('https://inside.example.test/account/purchases');
  // Стенд отвечает по петле и сертификата не имеет: письмо на нём должно оставаться проверяемым.
  for (const origin of ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000']) {
    expect(renderNotification(source, origin).text).toContain(`${origin}/account/purchases`);
  }
  // Любой другой узел без TLS — отказ, а не письмо с небезопасной ссылкой.
  expect(() => renderNotification(source, 'http://inside.example.test')).toThrow('notification_link_invalid');
  expect(() => renderNotification(source, 'https://user:secret@inside.example.test')).toThrow('notification_link_invalid');
  expect(() => renderNotification({ ...source, readerPath: 'https://evil.example/path' }, 'https://inside.example.test')).toThrow('notification_link_invalid');
  expect(() => renderNotification({ ...source, readerPath: '//evil.example/path' }, 'https://inside.example.test')).toThrow('notification_link_invalid');
});
