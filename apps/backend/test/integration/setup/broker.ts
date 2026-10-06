import type { StartedTestContainer } from "testcontainers";
import { expect } from "vitest";
import { z } from "zod";

/** Runs `rabbitmqctl` inside the broker container and fails the test on a non-zero exit. */
export function brokerAdmin(broker: StartedTestContainer) {
  return async (args: string[]) => {
    const result = await broker.exec(["rabbitmqctl", ...args]);
    expect(result.exitCode, result.output).toBe(0);
    return result.output;
  };
}

/** Failure evidence, including a stopped/unreachable broker; never replaces the original failure. */
export async function brokerDiagnostics(
  broker: StartedTestContainer,
  vhost: string,
): Promise<string> {
  const commands = [
    [
      "list_queues",
      "name",
      "messages_ready",
      "messages_unacknowledged",
      "consumers",
      "state",
    ],
    ["list_consumers"],
  ];
  const results = await Promise.all(
    commands.map(async ([command, ...columns]) => {
      try {
        // Bound CLI startup too: rabbitmqctl's own timeout starts after Erlang has loaded.
        const result = await broker.exec([
          "timeout",
          "5",
          "rabbitmqctl",
          "--timeout",
          "5",
          command ?? "list_queues",
          "-p",
          vhost,
          ...columns,
          "--formatter",
          "json",
        ]);
        return `${String(command)} (exit ${String(result.exitCode)}): ${result.output.replace(/\s+/gu, " ")}`;
      } catch (error) {
        return `${String(command)} unavailable: ${String(error)}`;
      }
    }),
  );
  return results.join(" | ");
}

const queues = z.array(z.object({ name: z.string(), messages: z.number() }));
const queueConsumerCounts = z.array(
  z.object({ name: z.string(), consumers: z.number() }),
);
/**
 * `rabbitmqctl` печатает аргументы очереди списком троек `[имя, тип, значение]`, а не объектом.
 * Разбираем ровно эту форму: подставленный объект прошёл бы молча и вернул бы `undefined`.
 */
const queueArguments = z.array(
  z.object({
    name: z.string(),
    arguments: z.array(z.tuple([z.string(), z.string(), z.unknown()])),
  }),
);

/**
 * Ready plus unacknowledged messages, so a depth of zero proves a publish was consumed and
 * acknowledged. `admin` is a runner from `brokerAdmin`.
 */
export async function queueDepth(
  admin: (args: string[]) => Promise<string>,
  vhost: string,
  queue: string,
): Promise<number | undefined> {
  const listed = await admin([
    "list_queues",
    "-p",
    vhost,
    "name",
    "messages",
    "--formatter",
    "json",
  ]);
  return queues.parse(JSON.parse(listed)).find((row) => row.name === queue)
    ?.messages;
}

/**
 * Объявленный предел очереди. Применение определений брокером асинхронно: очередь появляется
 * раньше, чем получает свои аргументы, и до этого принимает всё. Проверка переполнения обязана
 * дождаться самого предела, иначе она утверждает то, чего в этот момент не существует.
 */
export async function queueLimit(
  admin: (args: string[]) => Promise<string>,
  vhost: string,
  queue: string,
): Promise<number | undefined> {
  const listed = await admin([
    "list_queues",
    "-p",
    vhost,
    "name",
    "arguments",
    "--formatter",
    "json",
  ]);
  const declared = queueArguments
    .parse(JSON.parse(listed))
    .find((row) => row.name === queue);
  const limit = declared?.arguments.find(
    ([name]) => name === "x-max-length",
  )?.[2];
  return typeof limit === "number" ? limit : undefined;
}

/**
 * Сколько потребителей брокер всё ещё держит на очереди, или `undefined`, если очереди нет.
 * Убитый процесс не отписывается сам: брокер снимает подписку, лишь заметив смерть соединения, и
 * до этого момента продолжает отдавать сообщения мёртвому потребителю. Отсутствие очереди — не
 * «ноль потребителей»: смешав их, ожидание закончилось бы мгновенно на факте, которого нет.
 */
export async function queueConsumers(
  admin: (args: string[]) => Promise<string>,
  vhost: string,
  queue: string,
): Promise<number | undefined> {
  const listed = await admin([
    "list_queues",
    "-p",
    vhost,
    "name",
    "consumers",
    "--formatter",
    "json",
  ]);
  return queueConsumerCounts
    .parse(JSON.parse(listed))
    .find((row) => row.name === queue)?.consumers;
}
