import { spawn } from "node:child_process";
import { once } from "node:events";
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
async function runCli(mode: string, input: Buffer, interrupt = false) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/operations/trainer-bank-import-cli.ts", mode],
    {
      env: { ...process.env, PGAPPNAME: "trainer-bank-import-cli-test" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    },
  );
  const closed = once(child, "close");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  // EPIPE is expected when the old synchronous reader exits before the writer finishes.
  child.stdin.on("error", () => undefined);
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null && child.pid)
      process.kill(-child.pid, "SIGKILL");
  };
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
      child.stdin.write(chunk);
      // deterministic-test-allow duration-wait: model a slow pipe producer at the CLI boundary (#2010).
      await delay(index < 2 ? 500 : 10);
    }
    if (interrupt) child.kill("SIGTERM");
    else child.stdin.end();
    const [code, signal] = await closed;
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    kill();
    child.stdin.destroy();
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
    true,
  );
  expect(result.signal).toBe("SIGTERM");
  expect(await bank.topics()).toEqual([]);
  const sessions = await sql<{
    count: string;
  }>`select count(*) from pg_stat_activity where datname = current_database() and application_name = 'trainer-bank-import-cli-test'`.execute(
    database,
  );
  expect(sessions.rows[0]?.count).toBe("0");
}, 30_000);
