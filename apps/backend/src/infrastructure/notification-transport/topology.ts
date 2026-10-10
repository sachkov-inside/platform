import { createHash } from "node:crypto";
import { lanes, type NotificationPrincipal } from "./wire.js";

export const NOTIFICATION_BROKER_IMAGE =
  "public.ecr.aws/docker/library/rabbitmq:4.2.4-management-alpine@sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef";
/** Ёмкость каждой очереди окружения: сообщения; байты — по 16 KiB на сообщение. Одна для стенда и production. */
export const NOTIFICATION_QUEUE_CAPACITY = 1_000;
export const LOCAL_NOTIFICATION_BROKER_CREDENTIALS = {
  password: "inside-local-only",
  usernames: {
    billing: "local-billing",
    materials: "local-materials",
    notifications: "local-notifications",
    email: "local-email",
    telegram: "local-telegram",
  },
} as const;
const exact = (names: string[]) =>
  names.length > 0
    ? `^(?:${[...new Set(names)].map((name) => name.replaceAll(".", "\\.")).join("|")})$`
    : "^$";
// Deployment-only declarations. Runtime identities have no configure permission.
export function notificationTopology(input: {
  vhost: string;
  queueCapacity: number;
  principals: Record<
    NotificationPrincipal,
    { username: string; passwordHash: string }
  >;
}) {
  const routes = Object.values(lanes);
  return {
    vhosts: [{ name: input.vhost }],
    users: Object.values(input.principals).map((principal) => ({
      name: principal.username,
      password_hash: principal.passwordHash,
      hashing_algorithm: "rabbit_password_hashing_sha256",
      tags: [],
    })),
    permissions: Object.entries(input.principals).map(([scope, principal]) => ({
      user: principal.username,
      vhost: input.vhost,
      configure: "^$",
      write: exact(
        routes
          .filter((route) => route.publisher === scope)
          .map((route) => route.exchange),
      ),
      read: exact(
        routes
          .filter((route) => route.consumer === scope)
          .map((route) => route.queue),
      ),
    })),
    exchanges: [...new Set(routes.map((route) => route.exchange))].map(
      (name) => ({
        name,
        vhost: input.vhost,
        type: "topic",
        durable: true,
        auto_delete: false,
        internal: false,
        arguments: {},
      }),
    ),
    queues: routes.map((route) => ({
      name: route.queue,
      vhost: input.vhost,
      durable: true,
      auto_delete: false,
      arguments: {
        "x-queue-type": "quorum",
        "x-max-length": input.queueCapacity,
        "x-max-length-bytes": input.queueCapacity * 16 * 1024,
        "x-overflow": "reject-publish",
        "x-delivery-limit": -1,
      },
    })),
    bindings: routes.map((route) => ({
      source: route.exchange,
      vhost: input.vhost,
      destination: route.queue,
      destination_type: "queue",
      routing_key: route.key,
      arguments: {},
    })),
  };
}
// Fixed salt/password are explicitly disposable local configuration, never production credentials.
export function localNotificationTopology(
  vhost = "inside-local",
  queueCapacity = NOTIFICATION_QUEUE_CAPACITY,
) {
  const salt = Buffer.from("local-development-only");
  const passwordHash = Buffer.concat([
    salt.subarray(0, 4),
    createHash("sha256")
      .update(salt.subarray(0, 4))
      .update(LOCAL_NOTIFICATION_BROKER_CREDENTIALS.password)
      .digest(),
  ]).toString("base64");
  return notificationTopology({
    vhost,
    queueCapacity,
    principals: {
      billing: {
        username: LOCAL_NOTIFICATION_BROKER_CREDENTIALS.usernames.billing,
        passwordHash,
      },
      materials: {
        username: LOCAL_NOTIFICATION_BROKER_CREDENTIALS.usernames.materials,
        passwordHash,
      },
      notifications: {
        username: LOCAL_NOTIFICATION_BROKER_CREDENTIALS.usernames.notifications,
        passwordHash,
      },
      email: {
        username: LOCAL_NOTIFICATION_BROKER_CREDENTIALS.usernames.email,
        passwordHash,
      },
      telegram: {
        username: LOCAL_NOTIFICATION_BROKER_CREDENTIALS.usernames.telegram,
        passwordHash,
      },
    },
  });
}
