import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "kysely";

import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { TrainerDaily } from "../../src/modules/trainer/trainer-daily.js";
import { TrainerRounds } from "../../src/modules/trainer/trainer-rounds.js";
import { createTrainerCaseDatabase } from "../support/trainer-case-database.js";
import { clearTrainerData } from "../support/trainer-bot.js";
import { syntheticTrainerBank } from "../support/synthetic-trainer-bank.js";
import { required } from "../support/required.js";
import {
  fixedTestInstant,
  registerFixedClock,
  virtualTestClock,
} from "../support/fixed-clock.js";

registerFixedClock();
const url = required(process.env["DATABASE_URL"]);
const applicationName = `trainer_case_${randomUUID()}`;
const fixture = createTrainerCaseDatabase(url, applicationName);
const owner = createDatabase(url);
const { database } = fixture;
const daily = new TrainerDaily(database);
const person = { botIdentity: "inside", telegramUserId: "1999001" };
const at = new Date(fixedTestInstant());

beforeAll(async () => {
  await migrateToLatest(owner);
  await clearTrainerData(owner);
});
afterAll(async () => {
  await fixture.finish();
  await fixture.destroy();
  await owner.destroy();
});

it("joins cancelled legacy Daily SQL before the following Trainer reset", async () => {
  await database
    .insertInto("bot_contacts")
    .values({
      bot_identity: person.botIdentity,
      telegram_user_id: person.telegramUserId,
      private_chat_id: person.telegramUserId,
      contactability: "reachable",
      first_started_at: at,
      last_started_at: at,
      updated_at: at,
    })
    .execute();
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  const bank = new TrainerBank(database, virtualTestClock);
  await bank.import(file, true);
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  await new TrainerRounds(database).answer(person, issued.issueId, 1, at);
  required(file.questions[0]).text =
    "Синтетический вопрос после редакторской правки";
  await bank.import(file, true);
  await database
    .deleteFrom("trainer_question_versions")
    .where("content_revision", "=", 1)
    .execute();

  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = owner.transaction().execute(async (tx) => {
    await tx.selectFrom("trainer_rounds").select("id").forUpdate().execute();
    locked();
    await released;
  });
  let operation: Promise<unknown> | undefined;
  try {
    await acquired;
    const abort = new AbortController();
    operation = fixture.run(abort.signal, () =>
      daily.open(person, { updateId: "2", at }),
    );
    await expect
      .poll(
        async () => {
          const result = await sql<{
            count: string;
          }>`select count(*) from pg_stat_activity
        where application_name = ${applicationName} and wait_event_type = 'Lock'`.execute(
            owner,
          );
          return required(result.rows[0]).count;
        },
        { timeout: 1_000 },
      )
      .toBe("1");

    abort.abort(new Error("synthetic case timeout"));
    await expect
      .poll(
        async () => {
          const result = await sql<{
            count: string;
          }>`select count(*) from pg_stat_activity
        where application_name = ${applicationName} and state <> 'idle'`.execute(
            owner,
          );
          return required(result.rows[0]).count;
        },
        { timeout: 1_000 },
      )
      .toBe("0");
    await fixture.finish();
    await expect(operation).rejects.toBeDefined();

    release();
    await blocker;
    await clearTrainerData(database);
    expect(await bank.import(file, true)).toMatchObject({ status: "imported" });
    expect(await bank.question("q-t1-1")).toMatchObject({ contentRevision: 1 });
  } finally {
    release();
    await blocker;
    await Promise.allSettled(operation ? [operation] : []);
    await fixture.finish();
  }
});

it("rejects SQL when cancelled case work resumes between database operations", async () => {
  const abort = new AbortController();
  const reason = new Error("synthetic case timeout between queries");
  let reached!: () => void;
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let resume!: () => void;
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const operation = fixture.run(abort.signal, async () => {
    await sql`select 1`.execute(database);
    reached();
    await resumed;
    await sql`select 2`.execute(database);
  });
  try {
    await ready;
    abort.abort(reason);
    resume();
    await expect(operation).rejects.toBe(reason);
    await fixture.finish();
    await fixture.run(new AbortController().signal, async () => {
      expect(
        (await sql<{ value: number }>`select 3 as value`.execute(database))
          .rows,
      ).toEqual([{ value: 3 }]);
    });
  } finally {
    resume();
    await Promise.allSettled([operation]);
    await fixture.finish();
  }
});
