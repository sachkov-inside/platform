import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "kysely";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import {
  virtualTestClock,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";
import { syntheticTrainerBank } from "../support/synthetic-trainer-bank.js";

registerFixedClock();
const database = createDatabase(required(process.env["DATABASE_URL"]));
const bank = new TrainerBank(database, virtualTestClock);
const processBudgetMs = 15_000;
beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  await sql`truncate trainer_questions, trainer_topics restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await database.destroy();
});

/** Real CLI and pipe. The timer bounds a stuck child; finally joins its exit even on failure. */
async function runCli(
  mode: string,
  input: Buffer,
  interrupt: false | "input" | "database" | "database-error" = false,
) {
  // deterministic-test-allow process-cleanup: runCli owns a detached process group, kills on timeout/failure and joins close in finally.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./test/support/trainer-bank-cli-read-probe.ts",
      "src/operations/trainer-bank-import-cli.ts",
      mode,
    ],
    {
      env: {
        ...process.env,
        PGAPPNAME: "trainer-bank-import-cli-test",
        ...(interrupt === "database-error"
          ? { PGOPTIONS: "-c default_transaction_read_only=on" }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: true,
    },
  );
  const closed = new Promise<[number | null, NodeJS.Signals | null]>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve([code, signal]));
    },
  );
  let stdout = "";
  let stderr = "";
  required(child.stdout)
    .setEncoding("utf8")
    .on("data", (chunk: string) => {
      stdout += chunk;
    });
  required(child.stderr)
    .setEncoding("utf8")
    .on("data", (chunk: string) => {
      stderr += chunk;
    });
  // EPIPE is expected when the old synchronous reader exits before the writer finishes.
  required(child.stdin).on("error", () => undefined);
  const kill = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw error;
    }
  };
  let readBytes = 0;
  let readBarrier: (() => void) | undefined;
  child.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "readBytes" in message &&
      typeof message.readBytes === "number"
    ) {
      readBytes += message.readBytes;
      readBarrier?.();
    }
  });
  // deterministic-test-allow duration-wait: bound failure of the real CLI process; finally clears the timer.
  const timeout = setTimeout(kill, processBudgetMs);
  try {
    // Feed one byte at a time through the first Cyrillic character, then delayed large chunks.
    // This also keeps stdin open long enough for the old synchronous reader to hit EAGAIN.
    const split = input.findIndex((byte) => byte >= 0xc0) + 1;
    const chunks = [input.subarray(0, split), input.subarray(split, split + 1)];
    for (let offset = split + 1; offset < input.length; offset += 8192)
      chunks.push(input.subarray(offset, offset + 8192));
    for (const [index, chunk] of chunks.entries()) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      required(child.stdin).write(chunk);
      if (index === 0 && split > 0) {
        await Promise.race([
          new Promise<void>((resolve) => {
            readBarrier = () => {
              if (readBytes >= split) resolve();
            };
            readBarrier();
          }),
          closed.then(() => undefined),
        ]);
      }
      // deterministic-test-allow duration-wait: model a slow pipe producer at the CLI boundary (#2010).
      await delay(10);
    }
    if (interrupt === "input") child.kill("SIGTERM");
    else {
      required(child.stdin).end();
      if (interrupt === "database") {
        while (child.exitCode === null && child.signalCode === null) {
          const waiting =
            await sql`select 1 from pg_stat_activity where application_name = 'trainer-bank-import-cli-test' and wait_event_type = 'Lock'`.execute(
              database,
            );
          if (waiting.rows.length > 0) {
            child.kill("SIGTERM");
            break;
          }
          // deterministic-test-allow duration-wait: poll the child's observed database lock wait, bounded by processBudgetMs.
          await delay(10);
        }
      }
    }
    const [code, signal] = await closed;
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    kill();
    required(child.stdin).destroy();
    await closed;
  }
}

it("previews and applies a large slow UTF-8 pipe without corrupting Cyrillic, then reports unchanged", async () => {
  const file = syntheticTrainerBank({ topics: 5, questionsPerTopic: 300 });
  const input = Buffer.from(JSON.stringify(file));
  expect(input.length).toBeGreaterThan(727_071);
  const preview = await runCli("--preview", input);
  expect(preview.stderr).toBe("");
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({
    status: "valid",
    questions: { added: 1500 },
  });
  expect(await bank.topics()).toEqual([]);
  const applied = await runCli("--apply", input);
  expect(applied.code).toBe(0);
  expect(JSON.parse(applied.stdout)).toMatchObject({
    status: "imported",
    questions: { added: 1500 },
  });
  expect(await bank.topics()).toEqual(
    file.topics.map((topic) => ({ ...topic, questions: 300 })),
  );
  expect(await bank.question("q-t1-1")).toMatchObject({
    text: "Синтетический вопрос 1 темы t1",
    explanation: "Общий разбор.",
  });
  const repeated = await runCli("--preview", input);
  expect(repeated.code).toBe(0);
  expect(JSON.parse(repeated.stdout)).toMatchObject({
    status: "valid",
    questions: { added: 0, unchanged: 1500 },
  });
}, 30_000);

it("exits on malformed, rejected and wrong-mode input without writing", async () => {
  const malformed = await runCli("--apply", Buffer.from('{"text":"я"'));
  expect(malformed.code).toBe(1);
  expect(malformed.stderr).toBe(
    "The Bank file is not JSON; nothing was changed.\n",
  );
  const rejected = await runCli("--apply", Buffer.from("{}"));
  expect(rejected.code).toBe(2);
  expect(JSON.parse(rejected.stdout)).toMatchObject({ status: "rejected" });
  expect((await runCli("--wrong", Buffer.from("{}"))).code).toBe(1);
  expect(await bank.topics()).toEqual([]);
}, 30_000);

it("terminates an incomplete import without leaving writes or database sessions", async () => {
  const result = await runCli(
    "--apply",
    Buffer.from(
      JSON.stringify(
        syntheticTrainerBank({ topics: 5, questionsPerTopic: 300 }),
      ),
    ),
    "input",
  );
  expect(result.signal).toBe("SIGTERM");
  expect(await bank.topics()).toEqual([]);
  await expectClosedSessions();
}, 30_000);

it("interrupts an import with an open database connection and releases it without writes", async () => {
  await database.transaction().execute(async (transaction) => {
    await sql`lock table trainer_topics in access exclusive mode`.execute(
      transaction,
    );
    const result = await runCli(
      "--apply",
      Buffer.from(JSON.stringify(syntheticTrainerBank())),
      "database",
    );
    expect(result.signal).toBe("SIGTERM");
  });
  expect(await bank.topics()).toEqual([]);
  await expectClosedSessions();
}, 30_000);

it("closes an open connection after a database write error and leaves the Bank unchanged", async () => {
  const result = await runCli(
    "--apply",
    Buffer.from(JSON.stringify(syntheticTrainerBank())),
    "database-error",
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("Bank import failed; nothing was changed.\n");
  expect(await bank.topics()).toEqual([]);
  await expectClosedSessions();
}, 30_000);

async function expectClosedSessions() {
  const deadline = performance.now() + 5_000;
  for (;;) {
    const sessions = await sql<{
      count: string;
    }>`select count(*) from pg_stat_activity where application_name = 'trainer-bank-import-cli-test'`.execute(
      database,
    );
    if (sessions.rows[0]?.count === "0") return;
    if (performance.now() >= deadline)
      throw new Error("CLI database session did not close");
    // deterministic-test-allow duration-wait: observe PostgreSQL removing the closed child's backend, bounded by a monotonic deadline.
    await delay(10);
  }
}
