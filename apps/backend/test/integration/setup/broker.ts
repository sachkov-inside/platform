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
