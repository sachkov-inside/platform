import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { notificationBrokerDefinitions } from "../../src/infrastructure/notification-transport/broker-definitions.js";

const password = (user: string) => `${user}-synthetic-broker-password`;
const url = (user: string, options: { vhost?: string; protocol?: string; secret?: string } = {}) =>
  `${options.protocol ?? "amqps"}://${user}:${options.secret ?? password(user)}@rabbitmq:5671/${options.vhost ?? "inside-production"}?heartbeat=5`;
const environment = (overrides: Record<string, string> = {}, telegram = url("telegram")) => ({
  NODE_ENV: "production",
  NOTIFICATIONS_BROKER_URLS: JSON.stringify({
    billing: url("platform-billing", { secret: "with%2Fslash%40and-at-000000" }), materials: url("platform-materials"),
    notifications: url("platform-notifications"), email: url("platform-email"), ...overrides,
  }),
  NOTIFICATIONS_TELEGRAM_BROKER_URL: telegram,
});
/** RabbitMQ `rabbit_password_hashing_sha256`: base64 от 4 байт соли и SHA-256(соль + пароль). */
function hashMatches(passwordHash: string, candidate: string): boolean {
  const raw = Buffer.from(passwordHash, "base64");
  return raw.length === 36 && createHash("sha256").update(raw.subarray(0, 4)).update(candidate).digest().equals(raw.subarray(4));
}

describe("production notification broker definitions", () => {
  it("imports one environment vhost with five scoped principals and no plaintext credential", () => {
    const definitions = notificationBrokerDefinitions(environment());
    expect(definitions.vhosts).toEqual([{ name: "inside-production" }]);
    const users = new Map(definitions.users.map(user => [user.name, user.password_hash]));
    expect([...users.keys()].sort()).toEqual(["platform-billing", "platform-email", "platform-materials", "platform-notifications", "telegram"]);
    // Пароль в URL закодирован; брокер сверяет его раскодированным.
    expect(hashMatches(users.get("platform-billing") ?? "", "with/slash@and-at-000000")).toBe(true);
    for (const user of ["platform-materials", "platform-notifications", "platform-email", "telegram"]) {
      expect(hashMatches(users.get(user) ?? "", password(user))).toBe(true);
    }
    expect(JSON.stringify(definitions)).not.toMatch(/synthetic-broker-password|with%2Fslash|and-at-000000/u);
    expect(definitions.permissions.find(permission => permission.user === "telegram")).toEqual({
      user: "telegram", vhost: "inside-production", configure: "^$",
      write: "^(?:inside\\.results\\.telegram\\.v1)$",
      read: "^(?:telegram\\.notifications\\.subscription\\.v1|telegram\\.notifications\\.material\\.v1)$",
    });
    expect(definitions.queues).toHaveLength(8);
    expect(definitions.queues.every(queue => queue.vhost === "inside-production" && queue.arguments["x-queue-type"] === "quorum")).toBe(true);
    // Соль новая при каждом выпуске определений: одинаковые пароли не дают одинаковых хэшей.
    expect(notificationBrokerDefinitions(environment()).users[0]?.password_hash).not.toBe(definitions.users[0]?.password_hash);
  });

  it("refuses a shared principal, another vhost, plaintext AMQP or a missing Telegram principal without echoing credentials", () => {
    const refusals = [
      environment({}, url("platform-billing")),
      environment({}, url("telegram", { vhost: "inside-other" })),
      environment({ email: url("platform-email", { protocol: "amqp" }) }),
      { ...environment(), NOTIFICATIONS_TELEGRAM_BROKER_URL: undefined },
      { ...environment(), NOTIFICATIONS_BROKER_URLS: undefined },
    ];
    for (const refused of refusals) {
      let message = "";
      try { notificationBrokerDefinitions(refused); } catch (error) { message = error instanceof Error ? error.message : String(error); }
      expect(message).toMatch(/^Invalid notification broker/u);
      expect(message).not.toMatch(/synthetic-broker-password|amqps?:\/\//u);
    }
  });
});
