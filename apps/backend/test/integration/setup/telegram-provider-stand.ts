import { randomUUID } from "node:crypto";

import type { ChannelModel } from "amqplib";
import type { Pool } from "pg";
import { z } from "zod";

import {
  connectNotificationBroker,
  consumeNotificationLane,
  publishNotification,
} from "../../../src/infrastructure/notification-transport/rabbitmq.js";
import {
  encodeNotification,
  type NotificationEnvelope,
} from "../../../src/infrastructure/notification-transport/wire.js";

/**
 * Синтетический провайдер Telegram, верный принятому контракту. Он стоит на месте приложения
 * `inside-telegram`, код которого сюда импортировать нельзя: соседний checkout не является
 * допустимой runtime-зависимостью Platform. Собственная часть приложения проверена у себя
 * (inside-telegram #56); здесь проверяется общий провод и обязанности Platform перед провайдером.
 *
 * Провайдер делает ровно то, что требует протокол: разбирает команду правилами провода, просит у
 * Platform свежее разрешение на каждую попытку, фиксирует начатую попытку в собственной базе до
 * всякого ввода-вывода и возвращает результат своей лентой. Физической отправки нет.
 */

/** Что провайдер сделает со следующей командой; по умолчанию отправка удаётся. */
export type ProviderOutcome =
  | { readonly state: "sent" }
  | { readonly state: "retrying"; readonly reason: "rate_limited"; readonly retryAfterMs: number };

const commandSchema = z.object({
  operationId: z.uuid(),
  deliveryRef: z.uuid(),
  commandRevision: z.number().int().positive(),
  content: z.object({ category: z.enum(["material", "subscription"]) }),
  text: z.string().min(1),
  notAfter: z.iso.datetime({ offset: true }),
  binding: z.object({
    channel: z.literal("telegram"),
    // Провайдер видит principal своего приложения, а не Account платформы.
    accountRef: z.string().min(1).max(128),
    telegramIdentityRef: z.string().min(1).max(128),
  }),
});
export type ProviderCommand = z.infer<typeof commandSchema>;

const allowed = z.object({ status: z.literal("allowed") });
const refused = z.object({ status: z.enum(["denied", "error"]), reason: z.string().optional(), code: z.string().optional() });

export interface ProviderRefusal {
  readonly deliveryRef: string;
  readonly outcome: string;
}

/** Протокол разрешает провайдеру не больше трёх собственных повторов одной команды. */
const MAX_PROVIDER_ATTEMPTS = 3;

export interface ProviderStand {
  /** Политика следующих попыток: провайдер спрашивает её после каждого разрешения Platform. */
  policy(decide: (command: ProviderCommand, attempt: number) => ProviderOutcome): void;
  /** Отказы Platform на preflight: провайдер не отправляет и не возвращает результат. */
  readonly refusals: readonly ProviderRefusal[];
  /** Сбои самого провайдера: молчащий стенд не должен выглядеть исправным. */
  readonly failures: readonly string[];
  /** Задержать разбор команд, чтобы сценарий успел изменить состояние до preflight. */
  pause(): void;
  resume(): void;
  /** Собственный журнал попыток одной доставки, из собственной базы провайдера. */
  attempts(deliveryRef: string): Promise<{ attemptRef: string; state: string; category: string }[]>;
  stop(): Promise<void>;
}

export async function providerStand(input: {
  readonly url: string;
  readonly pool: Pool;
  readonly authorize: (request: unknown) => Promise<unknown>;
}): Promise<ProviderStand> {
  const connection: ChannelModel = await connectNotificationBroker({ url: input.url });
  const refusals: ProviderRefusal[] = [];
  const failures: string[] = [];
  const revisions = new Map<string, number>();
  let gate: { readonly wait: Promise<void>; readonly open: () => void } | undefined;
  let decide: (command: ProviderCommand, attempt: number) => ProviderOutcome = () => ({ state: "sent" });

  async function handle(envelope: NotificationEnvelope): Promise<void> {
    if (gate) await gate.wait;
    const command = commandSchema.parse(JSON.parse(envelope.payload));
    // Отложенная отправка — обязанность самого провайдера: Platform не выдаёт новую команду в
    // ответ на общий предел канала, поэтому следующая попытка берёт своё разрешение сама.
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const outcome = await attemptOnce(command, envelope, attempt);
      if (outcome?.state !== "retrying") return;
    }
  }

  async function attemptOnce(
    command: ProviderCommand,
    envelope: NotificationEnvelope,
    attempt: number,
  ): Promise<ProviderOutcome | undefined> {
    const payloadDigest = envelope.digest.slice("sha256:".length);
    const attemptRef = randomUUID();
    const response = await input.authorize({
      contractVersion: "inside.notification-dispatch.v1",
      operationId: randomUUID(),
      deliveryOperationId: command.operationId,
      deliveryRef: command.deliveryRef,
      commandRevision: command.commandRevision,
      payloadDigest,
      attemptRef,
    });
    if (!allowed.safeParse(response).success) {
      const refusal = refused.parse(response);
      // Отказ Platform закрывает попытку целиком: ни отправки, ни результата.
      refusals.push({ deliveryRef: command.deliveryRef, outcome: refusal.reason ?? refusal.code ?? refusal.status });
      return undefined;
    }
    const outcome = decide(command, attempt);
    // Начатая попытка фиксируется до всякого ввода-вывода и в собственной базе провайдера.
    // Номер попытки хранится сам: два соседних мгновения могут совпасть, и порядок по времени
    // тогда отвечает произвольной строкой.
    await input.pool.query(
      `insert into provider_effects (delivery_ref, attempt_ref, attempt, command_revision, category, state, recorded_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [command.deliveryRef, attemptRef, attempt, command.commandRevision, command.content.category, outcome.state],
    );
    const revision = (revisions.get(command.deliveryRef) ?? 0) + 1;
    revisions.set(command.deliveryRef, revision);
    const recordedAt = new Date().toISOString();
    const result = {
      contractVersion: "inside.notification-result.v1",
      messageId: randomUUID(),
      operationId: command.operationId,
      deliveryRef: command.deliveryRef,
      commandRevision: command.commandRevision,
      payloadDigest,
      resultRevision: revision,
      channel: "telegram" as const,
      recordedAt,
      attemptRef,
      ...(outcome.state === "sent"
        ? { state: "sent" as const, receiptRef: randomUUID() }
        : { state: "retrying" as const, reason: outcome.reason,
            nextAttemptAt: new Date(Date.parse(recordedAt) + outcome.retryAfterMs).toISOString() }),
    };
    await publishNotification(connection, encodeNotification("telegramResult", result));
    return outcome;
  }

  const consumers = await Promise.all(
    (["telegramSubscription", "telegramMaterial"] as const).map((lane) =>
      consumeNotificationLane(connection, lane, {
        accept: async (envelope) => {
          try { await handle(envelope); } catch (error) {
            failures.push(`${lane}: ${error instanceof Error ? error.message : String(error)}`);
          }
          return "accepted" as const;
        },
        quarantine: (rejected, _bytes, reason) => { failures.push(`${rejected}: ${reason}`); return Promise.resolve(); },
      }, 4),
    ),
  );

  for (const consumer of consumers) {
    void consumer.failed.catch((error: unknown) => {
      failures.push(error instanceof Error ? error.message : String(error));
    });
  }

  return {
    policy(next) { decide = next; },
    refusals,
    failures,
    pause() {
      let open!: () => void;
      const wait = new Promise<void>((resolve) => { open = resolve; });
      gate = { wait, open };
    },
    resume() { gate?.open(); gate = undefined; },
    async attempts(deliveryRef) {
      const rows = await input.pool.query<{ attempt_ref: string; state: string; category: string }>(
        `select attempt_ref, state, category from provider_effects where delivery_ref = $1 order by attempt`,
        [deliveryRef],
      );
      return rows.rows.map((row) => ({
        attemptRef: row.attempt_ref, state: row.state, category: row.category,
      }));
    },
    async stop() {
      gate?.open();
      gate = undefined;
      await Promise.allSettled(consumers.map((consumer) => consumer.stop()));
      await connection.close().catch(() => undefined);
    },
  };
}
