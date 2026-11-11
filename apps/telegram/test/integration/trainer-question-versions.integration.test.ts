import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { TrainerDaily } from "../../src/modules/trainer/trainer-daily.js";
import { TrainerRounds } from "../../src/modules/trainer/trainer-rounds.js";
import { required } from "../support/required.js";
import {
  fixedTestInstant,
  registerFixedClock,
  virtualTestClock,
} from "../support/fixed-clock.js";
import { clearTrainerData } from "../support/trainer-bot.js";
import { syntheticTrainerBank } from "../support/synthetic-trainer-bank.js";

registerFixedClock();

const database = createDatabase(required(process.env["DATABASE_URL"]));
const bank = new TrainerBank(database, virtualTestClock);
const daily = new TrainerDaily(database);
const rounds = new TrainerRounds(database);
const person = { botIdentity: "inside", telegramUserId: "1999001" };
const at = new Date(fixedTestInstant());

beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  await clearTrainerData(database);
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
});
afterAll(async () => {
  await database.destroy();
});

it("explains the option the person saw before a Bank import reordered the options", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  expect(issued.options[0]).toBe("Вариант А");

  const question = required(file.questions[0]);
  question.text = "Синтетический вопрос после редакторской правки";
  question.options.reverse();
  question.explanation = "Новая редакция разбора.";
  expect((await bank.import(file, true)).status).toBe("imported");

  const outcome = await rounds.answer(person, issued.issueId, 1, at);
  expect(outcome?.correct).toBe(true);
  expect(outcome?.explanation).toBe("Разбор А. Общий разбор.");
});

it("reopens an answered Daily question with its original text and option order", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  await rounds.answer(person, issued.issueId, 1, at);

  const question = required(file.questions[0]);
  question.text = "Синтетический вопрос после редакторской правки";
  question.options.reverse();
  expect((await bank.import(file, true)).status).toBe("imported");

  const review = await daily.open(person, { updateId: "2", at });
  if (review.kind !== "review") throw new Error("Expected the stored answer");
  expect(review.question.text).toBe("Синтетический вопрос 1 темы t1");
  expect(review.question.options).toEqual([
    "Вариант А",
    "Вариант Б",
    "Вариант В",
    "Вариант Г",
  ]);
  expect(review.pickedMask).toBe(1);
});

it("keeps an unanswered issue stable when the person reopens it after an edit", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  const question = required(file.questions[0]);
  question.text = "Синтетический вопрос после редакторской правки";
  question.options.reverse();
  expect((await bank.import(file, true)).status).toBe("imported");

  const reopened = await daily.open(person, { updateId: "2", at });
  if (reopened.kind !== "question")
    throw new Error("Expected the pending question");
  expect(reopened.text).toBe("Синтетический вопрос 1 темы t1");
  expect(reopened.options[0]).toBe("Вариант А");
  expect((await rounds.answer(person, issued.issueId, 1, at))?.correct).toBe(
    true,
  );
});

it("does not replace an unavailable legacy Daily revision with a different question", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  await rounds.answer(person, issued.issueId, 1, at);
  required(file.questions[0]).text =
    "Синтетический вопрос после редакторской правки";
  expect((await bank.import(file, true)).status).toBe("imported");
  // Simulates a revision overwritten before the application started retaining history.
  await database
    .deleteFrom("trainer_question_versions")
    .where("content_revision", "=", 1)
    .execute();

  expect(await daily.open(person, { updateId: "2", at })).toEqual({
    kind: "version_unavailable",
  });
});

it("uses a fresh revision for a new round while the old issue remains answerable", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  const question = required(file.questions[0]);
  question.text = "Синтетический вопрос после редакторской правки";
  question.options.reverse();
  expect((await bank.import(file, true)).status).toBe("imported");

  const fresh = await rounds.start(person, {
    mode: "check",
    count: 1,
    updateId: "2",
    at,
  });
  if (fresh.kind !== "question")
    throw new Error("Expected a new question issue");
  expect(fresh.text).toBe("Синтетический вопрос после редакторской правки");
  expect(fresh.options[0]).toBe("Вариант Г");
  expect((await rounds.answer(person, issued.issueId, 1, at))?.correct).toBe(
    true,
  );
  expect((await rounds.answer(person, fresh.issueId, 8, at))?.correct).toBe(
    true,
  );
});

it("retains the current Bank revision when upgrading a database that already has questions", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  // The downgrade removes the new history table while keeping the legacy Bank and issue.
  await migrateTo(database, "052-trainer-question-reactions");
  await migrateToLatest(database);

  const question = required(file.questions[0]);
  question.options.reverse();
  question.explanation = "Новая редакция разбора.";
  expect((await bank.import(file, true)).status).toBe("imported");
  expect(
    (await rounds.answer(person, issued.issueId, 1, at))?.explanation,
  ).toBe("Разбор А. Общий разбор.");
});

it("shows an edited step with its new key when that step has not yet been issued", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const first = await rounds.start(person, {
    mode: "check",
    count: 2,
    updateId: "1",
    at,
  });
  if (first.kind !== "question") throw new Error("Expected an issued question");
  const pending = required(
    file.questions.find((question) => question.id !== first.questionId),
  );
  pending.text = "Синтетический вопрос с новым множественным выбором";
  pending.format = "multiple";
  required(pending.options[1]).correct = true;
  expect((await bank.import(file, true)).status).toBe("imported");
  await rounds.answer(person, first.issueId, 1, at);

  const next = await rounds.next(person, at, first.issueId);
  if (next?.kind !== "question") throw new Error("Expected the next step");
  expect(next.text).toBe("Синтетический вопрос с новым множественным выбором");
  expect(next.severalCorrect).toBe(true);
  expect((await rounds.answer(person, next.issueId, 3, at))?.correct).toBe(
    true,
  );
});

it("keeps an answer and explanation on the issued revision during a concurrent import", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  const question = required(file.questions[0]);
  question.options.reverse();
  question.explanation = "Новая редакция разбора.";

  const [outcome, report] = await Promise.all([
    rounds.answer(person, issued.issueId, 1, at),
    bank.import(file, true),
  ]);
  expect(report.status).toBe("imported");
  expect(outcome?.correct).toBe(true);
  expect(outcome?.explanation).toBe("Разбор А. Общий разбор.");
  expect(
    (await rounds.answer(person, issued.issueId, 8, at))?.explanation,
  ).toBe("Разбор А. Общий разбор.");
});

it("refuses to drop history that cannot be reconstructed from the current Bank", async () => {
  const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  expect((await bank.import(file, true)).status).toBe("imported");
  const issued = await daily.open(person, { updateId: "1", at });
  if (issued.kind !== "question")
    throw new Error("Expected an issued question");
  required(file.questions[0]).explanation = "Новая редакция разбора.";
  expect((await bank.import(file, true)).status).toBe("imported");
  try {
    await expect(
      migrateTo(database, "052-trainer-question-reactions"),
    ).rejects.toMatchObject({
      cause: {
        message:
          "Trainer question history cannot be discarded; restore the pre-migration backup to roll back",
      },
    });
    expect(
      (await rounds.answer(person, issued.issueId, 1, at))?.explanation,
    ).toBe("Разбор А. Общий разбор.");
  } finally {
    await migrateToLatest(database);
  }
});
