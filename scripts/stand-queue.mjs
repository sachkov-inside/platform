// @ts-check
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const ticketSchema = z.strictObject({
  pid: z.number().int().positive(),
  host: z.string(),
  worktree: z.string(),
  command: z.string(),
  enqueuedAt: z.iso.datetime(),
});
const pollMilliseconds = 1_000;

/**
 * @typedef {z.infer<typeof ticketSchema>} StandQueueEntry
 * @typedef {object} StandTurnOptions
 * @property {string} directory the stand state directory shared by every worktree
 * @property {string} worktree the worktree the operation serves, shown to later waiters
 * @property {string} command the stand command, shown to later waiters
 * @property {() => Promise<() => Promise<void>>} acquire takes the machine-wide lock without waiting;
 *   it rejects with an `ELOCKED` cause while a tool outside the queue holds it
 * @property {(message: string) => void} report receives every change of the waiter's position
 * @property {number} [pid] only tests pass another process ID
 * @property {(pid: number) => boolean} [isAlive]
 * @property {() => Promise<void>} [pause]
 */

/**
 * Waits for this operation's turn on the shared stand. Operations queue in arrival order; the
 * first one takes the machine-wide lock as soon as no tool outside the queue holds it. A waiter
 * whose process ended on this machine leaves the queue, so a killed session never blocks it.
 *
 * @param {StandTurnOptions} options
 * @returns {Promise<() => Promise<void>>} release of the lock and of the queue place
 */
export async function waitForStandTurn({
  directory,
  worktree,
  command,
  acquire,
  report,
  pid = process.pid,
  isAlive = processAlive,
  pause = () =>
    new Promise((resolve) => {
      setTimeout(resolve, pollMilliseconds);
    }),
}) {
  const queue = join(directory, "queue");
  await mkdir(queue, { recursive: true, mode: 0o700 });
  // The file name orders the queue: arrival time in microseconds, comparable across processes,
  // then a random tie-breaker.
  const arrival = Math.round(
    (performance.timeOrigin + performance.now()) * 1_000,
  );
  const name = `${String(arrival).padStart(18, "0")}-${randomUUID()}.json`;
  const path = join(queue, name);
  /** @type {StandQueueEntry} */
  const ticket = {
    pid,
    host: hostname(),
    worktree,
    command,
    enqueuedAt: new Date().toISOString(),
  };
  const temporary = join(queue, `.${name}.tmp`);
  await writeFile(temporary, JSON.stringify(ticket), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
  const leave = () => {
    try {
      unlinkSync(path);
    } catch {
      // Already removed.
    }
  };
  process.once("exit", leave);
  let reported = "";
  try {
    for (;;) {
      const entries = await sweep(queue, isAlive);
      const position = entries.findIndex((entry) => entry.name === name) + 1;
      if (position === 0)
        throw new Error(
          "The stand queue ticket was removed by another session; rerun the command",
        );
      let message;
      if (position === 1) {
        try {
          const release = await acquire();
          return async () => {
            try {
              await release();
            } finally {
              process.removeListener("exit", leave);
              await unlink(path).catch(() => undefined);
            }
          };
        } catch (error) {
          if (!lockedElsewhere(error)) throw error;
        }
        message =
          "Stand queue: first in line, waiting for another local setup operation to finish";
      } else {
        const ahead = entries[0]?.ticket;
        message =
          `Stand queue: position ${String(position)} of ${String(entries.length)}; running: ${ahead?.worktree ?? "unknown"} ${ahead?.command ?? ""}`.trimEnd();
      }
      if (message !== reported) {
        report(message);
        reported = message;
      }
      await pause();
    }
  } catch (error) {
    process.removeListener("exit", leave);
    leave();
    throw error;
  }
}

/**
 * The waiting and running stand operations in queue order.
 *
 * @param {string} directory the stand state directory
 * @returns {Promise<StandQueueEntry[]>}
 */
export async function readStandQueue(directory) {
  const entries = await readTickets(join(directory, "queue"));
  return entries.flatMap((entry) => (entry.ticket ? [entry.ticket] : []));
}

/**
 * Removes tickets of ended processes on this machine and unreadable tickets.
 *
 * @param {string} queue
 * @param {(pid: number) => boolean} isAlive
 */
async function sweep(queue, isAlive) {
  const host = hostname();
  /** @type {{ name: string; ticket: StandQueueEntry }[]} */
  const kept = [];
  for (const entry of await readTickets(queue)) {
    if (
      entry.ticket === undefined ||
      (entry.ticket.host === host && !isAlive(entry.ticket.pid))
    ) {
      await unlink(join(queue, entry.name)).catch(() => undefined);
      continue;
    }
    kept.push({ name: entry.name, ticket: entry.ticket });
  }
  return kept;
}

/** @param {string} queue */
async function readTickets(queue) {
  let names;
  try {
    names = await readdir(queue);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  /** @type {{ name: string; ticket: StandQueueEntry | undefined }[]} */
  const entries = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    try {
      const ticket = ticketSchema.parse(
        JSON.parse(await readFile(join(queue, name), "utf8")),
      );
      entries.push({ name, ticket });
    } catch (error) {
      // A waiter that just finished removed its ticket between listing and reading.
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      entries.push({ name, ticket: undefined });
    }
  }
  return entries;
}

/** @param {unknown} error */
function lockedElsewhere(error) {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && "code" in cause && cause.code === "ELOCKED";
}

/** @param {number} pid */
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
