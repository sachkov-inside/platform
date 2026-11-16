// @ts-check
import { execFileSync } from "node:child_process";
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
import { join } from "node:path";
import { z } from "zod";

const ticketSchema = z.strictObject({
  pid: z.number().int().positive(),
  worktree: z.string(),
  command: z.string(),
  enqueuedAt: z.iso.datetime(),
  // When the system started the waiter's process. Absent in tickets of sessions that run the
  // earlier code and when the system could not tell.
  startedAt: z.iso.datetime().optional(),
});
const pollMilliseconds = 1_000;
// Older `ps` builds derive the start time from the uptime, so two readings of one process can
// differ by a second. A reused process ID starts far later than that.
const startTimeToleranceMilliseconds = 2_000;

/**
 * @typedef {z.infer<typeof ticketSchema>} StandQueueTicket
 * @typedef {Omit<StandQueueTicket, "startedAt">} StandQueueEntry
 * @typedef {object} StandTurnOptions
 * @property {string} directory the stand state directory shared by every worktree
 * @property {string} worktree the worktree the operation serves, shown to later waiters
 * @property {string} command the stand command, shown to later waiters
 * @property {() => Promise<() => Promise<void>>} acquire takes the machine-wide lock without waiting;
 *   it rejects with an `ELOCKED` cause while a tool outside the queue holds it
 * @property {(message: string) => void} report receives every change of the waiter's position
 * @property {number} [pid] only tests pass another process ID
 * @property {(pid: number) => boolean} [isAlive]
 * @property {(pid: number) => string | undefined} [startTime] when the system started the process,
 *   as an ISO date-time; `undefined` when it cannot tell
 * @property {() => Promise<void>} [pause]
 */

/**
 * Waits for this operation's turn on the shared stand. Operations queue in arrival order; the
 * first one takes the machine-wide lock as soon as no tool outside the queue holds it. A waiter
 * whose process ended leaves the queue, so a killed session never blocks it, even after the
 * system gave its process ID to another process.
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
  startTime = processStartTime,
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
  const startedAt = startTime(pid);
  /** @type {StandQueueTicket} */
  const ticket = {
    pid,
    worktree,
    command,
    enqueuedAt: new Date().toISOString(),
    ...(startedAt === undefined ? {} : { startedAt }),
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
      const entries = await sweep(queue, isAlive, startTime);
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
  return entries.flatMap((entry) => {
    if (!entry.ticket) return [];
    const { startedAt: _startedAt, ...shown } = entry.ticket;
    return [shown];
  });
}

/**
 * Removes tickets of ended processes and unreadable tickets.
 *
 * @param {string} queue
 * @param {(pid: number) => boolean} isAlive
 * @param {(pid: number) => string | undefined} startTime
 */
async function sweep(queue, isAlive, startTime) {
  /** @type {{ name: string; ticket: StandQueueTicket }[]} */
  const kept = [];
  for (const entry of await readTickets(queue)) {
    if (
      entry.ticket === undefined ||
      !waiterRuns(entry.ticket, isAlive, startTime)
    ) {
      await unlink(join(queue, entry.name)).catch(() => undefined);
      continue;
    }
    kept.push({ name: entry.name, ticket: entry.ticket });
  }
  return kept;
}

/**
 * Whether the process that wrote the ticket still runs. A live process ID is not enough: after the
 * waiter was killed the system may give its ID to another process, which started at another time.
 * A ticket without a start time, or a process whose start time cannot be read, falls back to the
 * process ID alone.
 *
 * @param {StandQueueTicket} ticket
 * @param {(pid: number) => boolean} isAlive
 * @param {(pid: number) => string | undefined} startTime
 */
function waiterRuns(ticket, isAlive, startTime) {
  if (!isAlive(ticket.pid)) return false;
  if (ticket.startedAt === undefined) return true;
  const current = startTime(ticket.pid);
  if (current === undefined) return true;
  return (
    Math.abs(Date.parse(current) - Date.parse(ticket.startedAt)) <=
    startTimeToleranceMilliseconds
  );
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
  /** @type {{ name: string; ticket: StandQueueTicket | undefined }[]} */
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

/**
 * Whether a process of this machine still runs. The stand directory lives in the Git common
 * directory of this machine, so every waiter and instance is a local process.
 * @param {number} pid
 */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * When the system started a process of this machine, as an ISO date-time; `undefined` when the
 * process does not exist or `ps` cannot tell. Together with the process ID it names one process:
 * the system reuses the ID, never the pair.
 * @param {number} pid
 * @returns {string | undefined}
 */
export function processStartTime(pid) {
  let output;
  try {
    // A fixed locale and time zone make sessions with different environments read the same text.
    output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
  } catch {
    return undefined;
  }
  const started = Date.parse(`${output.trim()} UTC`);
  return Number.isNaN(started) ? undefined : new Date(started).toISOString();
}
