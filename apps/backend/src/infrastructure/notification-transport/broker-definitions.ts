import { createHash, randomBytes } from "node:crypto";
import {
  brokerUrlSchema,
  oneBrokerEnvironment,
  parseNotificationsConfig,
} from "../../config/notifications-config.js";
import {
  NOTIFICATION_QUEUE_CAPACITY,
  notificationTopology,
} from "./topology.js";

const refusal = () =>
  new Error(
    "Invalid notification broker credentials for deployment definitions",
  );

/** RabbitMQ `rabbit_password_hashing_sha256`: base64 от 4 байт случайной соли и SHA-256(соль + пароль). */
function rabbitPasswordHash(password: string): string {
  const salt = randomBytes(4);
  return Buffer.concat([
    salt,
    createHash("sha256").update(salt).update(password).digest(),
  ]).toString("base64");
}

function principal(value: string) {
  const url = new URL(value);
  return {
    username: decodeURIComponent(url.username),
    passwordHash: rabbitPasswordHash(decodeURIComponent(url.password)),
  };
}

/**
 * Определения брокера окружения для импорта при его запуске. Источник учётных данных один: те же
 * URL, с которыми подключаются notifications-worker и Telegram, поэтому пароль в определениях не
 * расходится с паролем процесса. Приложение не объявляет топологию само, а в определения попадают
 * только хэши с солью. Тексты ошибок не содержат URL.
 */
export function notificationBrokerDefinitions(environment: NodeJS.ProcessEnv) {
  let platform: ReturnType<typeof parseNotificationsConfig>;
  try {
    platform = parseNotificationsConfig(environment);
  } catch {
    throw refusal();
  }
  const telegram = brokerUrlSchema.safeParse(
    environment.NOTIFICATIONS_TELEGRAM_BROKER_URL,
  );
  if (platform === undefined || !telegram.success) throw refusal();
  const { billing, materials, notifications, email } = platform.urls;
  if (
    !oneBrokerEnvironment([
      billing,
      materials,
      notifications,
      email,
      telegram.data,
    ])
  )
    throw refusal();
  return notificationTopology({
    vhost: decodeURIComponent(new URL(billing).pathname.slice(1)),
    queueCapacity: NOTIFICATION_QUEUE_CAPACITY,
    principals: {
      billing: principal(billing),
      materials: principal(materials),
      notifications: principal(notifications),
      email: principal(email),
      telegram: principal(telegram.data),
    },
  });
}
