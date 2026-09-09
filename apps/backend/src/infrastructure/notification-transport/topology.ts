import { createHash } from 'node:crypto';
import { lanes, type NotificationPrincipal } from './wire.js';

export const NOTIFICATION_BROKER_IMAGE = 'rabbitmq:4.2.4-management-alpine';
const exact = (names: string[]) => names.length ? `^(?:${[...new Set(names)].map(name => name.replaceAll('.', '\\.')).join('|')})$` : '^$';
// Deployment-only declarations. Runtime identities have no configure permission.
export function notificationTopology(input: {
  vhost: string; queueCapacity: number;
  principals: Record<NotificationPrincipal, { username: string; passwordHash: string }>;
}) {
  const routes = Object.values(lanes);
  return {
    vhosts: [{ name: input.vhost }],
    users: Object.values(input.principals).map(principal => ({ name: principal.username, password_hash: principal.passwordHash, hashing_algorithm: 'rabbit_password_hashing_sha256', tags: [] })),
    permissions: Object.entries(input.principals).map(([scope, principal]) => ({
      user: principal.username, vhost: input.vhost, configure: '^$',
      write: exact(routes.filter(route => route.publisher === scope).map(route => route.exchange)),
      read: exact(routes.filter(route => route.consumer === scope).map(route => route.queue)),
    })),
    exchanges: [...new Set(routes.map(route => route.exchange))].map(name => ({ name, vhost: input.vhost, type: 'topic', durable: true, auto_delete: false, internal: false, arguments: {} })),
    queues: routes.map(route => ({ name: route.queue, vhost: input.vhost, durable: true, auto_delete: false, arguments: {
      'x-queue-type': 'quorum', 'x-max-length': input.queueCapacity,
      'x-max-length-bytes': input.queueCapacity * 16 * 1024,
      'x-overflow': 'reject-publish', 'x-delivery-limit': -1,
    } })),
    bindings: routes.map(route => ({ source: route.exchange, vhost: input.vhost, destination: route.queue, destination_type: 'queue', routing_key: route.key, arguments: {} })),
  };
}
// Fixed salt/password are explicitly disposable local configuration, never production credentials.
export function localNotificationTopology(vhost = 'inside-local', queueCapacity = 1_000) {
  const salt = Buffer.from('local-development-only');
  const passwordHash = Buffer.concat([salt.subarray(0, 4), createHash('sha256').update(salt.subarray(0, 4)).update('inside-local-only').digest()]).toString('base64');
  return notificationTopology({ vhost, queueCapacity, principals: {
    billing: { username: 'local-billing', passwordHash }, materials: { username: 'local-materials', passwordHash },
    notifications: { username: 'local-notifications', passwordHash }, email: { username: 'local-email', passwordHash }, telegram: { username: 'local-telegram', passwordHash },
  } });
}
