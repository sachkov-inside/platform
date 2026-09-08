import { z } from 'zod';

const brokerUrl = z.url().refine(value => {
  const url = new URL(value);
  return ['amqp:', 'amqps:'].includes(url.protocol) && url.username.length > 0 && url.password.length > 0 &&
    url.pathname.length > 1 && !['/', '/%2f'].includes(url.pathname.toLowerCase()) && !url.hash;
}, 'Notifications broker requires credentials and a non-default environment vhost');
export const notificationsConfigSchema = z.object({
  urls: z.object({ billing: brokerUrl, materials: brokerUrl, notifications: brokerUrl, email: brokerUrl }).strict(),
  caFile: z.string().min(1).optional(),
  prefetch: z.coerce.number().int().min(1).max(32).default(4),
  quarantineCapacity: z.coerce.number().int().min(1).max(100_000).default(1_000),
}).refine(value => {
  const urls = Object.values(value.urls).map(url => new URL(url));
  return new Set(urls.map(url => url.username)).size === urls.length &&
    new Set(urls.map(url => `${url.protocol}//${url.host}${url.pathname}`)).size === 1;
}, 'Notifications principals must be distinct on one environment vhost');
export type NotificationsConfig = z.infer<typeof notificationsConfigSchema>;
export function parseNotificationsConfig(environment: NodeJS.ProcessEnv): NotificationsConfig | undefined {
  if (!environment.NOTIFICATIONS_BROKER_URLS) return undefined;
  let urls: unknown;
  try { urls = JSON.parse(environment.NOTIFICATIONS_BROKER_URLS); } catch { throw new Error('Invalid NOTIFICATIONS_BROKER_URLS JSON'); }
  const parsed = notificationsConfigSchema.safeParse({ urls, caFile: environment.NOTIFICATIONS_BROKER_CA_FILE, prefetch: environment.NOTIFICATIONS_PREFETCH, quarantineCapacity: environment.NOTIFICATIONS_QUARANTINE_CAPACITY });
  // Avoid Zod errors reflecting credential-bearing URLs.
  if (!parsed.success) throw new Error('Invalid Notifications broker configuration');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test' &&
    Object.values(parsed.data.urls).some(url => new URL(url).protocol !== 'amqps:')) throw new Error('Notifications require AMQPS in production');
  return parsed.data;
}
