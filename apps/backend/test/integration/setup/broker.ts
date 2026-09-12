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

const queues = z.array(z.object({ name: z.string(), messages: z.number() }));
const queueConsumerCounts = z.array(z.object({ name: z.string(), consumers: z.number() }));
/**
 * `rabbitmqctl` печатает аргументы очереди списком троек `[имя, тип, значение]`, а не объектом.
 * Разбираем ровно эту форму: подставленный объект прошёл бы молча и вернул бы `undefined`.
 */
const queueArguments = z.array(z.object({
  name: z.string(),
  arguments: z.array(z.tuple([z.string(), z.string(), z.unknown()])),
}));

/**
 * Ready plus unacknowledged messages, so a depth of zero proves a publish was consumed and
 * acknowledged. `admin` is a runner from `brokerAdmin`.
 */
export async function queueDepth(
  admin: (args: string[]) => Promise<string>,
  vhost: string,
  queue: string,
): Promise<number | undefined> {
  const listed = await admin(["list_queues", "-p", vhost, "name", "messages", "--formatter", "json"]);
  return queues.parse(JSON.parse(listed)).find((row) => row.name === queue)?.messages;
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
  const listed = await admin(["list_queues", "-p", vhost, "name", "arguments", "--formatter", "json"]);
  const declared = queueArguments.parse(JSON.parse(listed)).find((row) => row.name === queue);
  const limit = declared?.arguments.find(([name]) => name === "x-max-length")?.[2];
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
  const listed = await admin(["list_queues", "-p", vhost, "name", "consumers", "--formatter", "json"]);
  return queueConsumerCounts.parse(JSON.parse(listed)).find((row) => row.name === queue)?.consumers;
}
