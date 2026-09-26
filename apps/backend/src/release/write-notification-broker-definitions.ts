import { notificationBrokerDefinitions } from "../infrastructure/notification-transport/broker-definitions.js";

/**
 * Печатает определения RabbitMQ окружения в stdout. Учётные данные читаются из окружения процесса:
 * `NOTIFICATIONS_BROKER_URLS` из notifications-worker.env и `NOTIFICATIONS_TELEGRAM_BROKER_URL`
 * Telegram-principal. Файл определений содержит только хэши и остаётся server-owned.
 */
try {
  process.stdout.write(
    `${JSON.stringify(notificationBrokerDefinitions(process.env), null, 2)}\n`,
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Notification broker definitions failed",
  );
  process.exitCode = 1;
}
