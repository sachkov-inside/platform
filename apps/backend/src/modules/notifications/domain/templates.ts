import type { NotificationSource } from '../ports/notification-sources.js';
const subjects = {
  material_published: 'Новый материал в Inside', renewal_reminder: 'Скоро продление подписки Inside',
  payment_succeeded: 'Оплата Inside подтверждена', payment_failed: 'Оплата Inside не прошла',
  renewal_cancelled: 'Продление Inside отменено', access_expired: 'Доступ Inside закончился', refund_resolved: 'Результат возврата Inside',
} as const;
/** Петля не выходит наружу, поэтому стенд читается по http; любой другой узел обязан быть под TLS. */
function readerLinkAllowed(base: URL): boolean {
  return base.protocol === 'https:' ||
    (base.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(base.hostname));
}
export function renderNotification(source: Extract<NotificationSource, { status: 'current' }>, origin: string) {
  const base = new URL(origin);
  const url = new URL(source.readerPath, base);
  if (!readerLinkAllowed(base) || base.username || base.password || url.origin !== base.origin || url.username || url.password || !source.readerPath.startsWith('/') || source.readerPath.startsWith('//')) throw new Error('notification_link_invalid');
  const subject = subjects[source.content.kind];
  const amount = source.amountMinor === undefined ? '' : `\nСумма: ${(source.amountMinor / 100).toFixed(2)} ₽.`;
  if (source.amountMinor !== undefined && (!Number.isSafeInteger(source.amountMinor) || source.amountMinor < 0)) throw new Error('notification_amount_invalid');
  const date = source.dueAt === undefined ? '' : `\nДата: ${new Date(source.dueAt).toISOString()}.`;
  const title = source.title.replaceAll(/[\r\n]+/gu, ' ').trim();
  if (!title || title.length > 1_500) throw new Error('notification_title_invalid');
  return { templateRef: `inside.${source.content.kind}`, templateRevision: 1, subject,
    text: `${subject}\n\n${title}${amount}${date}\n\n${url.href}` };
}
