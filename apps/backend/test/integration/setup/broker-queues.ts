import { z } from "zod";

const queues = z.array(z.object({ name: z.string(), messages: z.number() }));

/**
 * Ready plus unacknowledged messages, so a depth of zero proves a publish was consumed and
 * acknowledged. `admin` runs `rabbitmqctl` in the broker container and returns its output.
 */
export async function queueDepth(
  admin: (args: string[]) => Promise<string>,
  vhost: string,
  queue: string,
): Promise<number | undefined> {
  const listed = await admin(["list_queues", "-p", vhost, "name", "messages", "--formatter", "json"]);
  return queues.parse(JSON.parse(listed)).find((row) => row.name === queue)?.messages;
}
