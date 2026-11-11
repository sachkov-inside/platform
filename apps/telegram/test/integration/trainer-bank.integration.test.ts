import { sql } from "kysely";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { runTrainerBankImport } from "../../src/operations/trainer-bank-import-command.js";
import { virtualTestClock } from "../support/fixed-clock.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";
import {
  syntheticQuestion,
  syntheticTrainerBank,
} from "../support/synthetic-trainer-bank.js";

registerFixedClock();

let database: Database;
let bank: TrainerBank;

beforeAll(async () => {
  database = createDatabase(required(process.env["DATABASE_URL"]));
  await migrateToLatest(database);
  bank = new TrainerBank(database, virtualTestClock);
});
beforeEach(async () => {
  await sql`truncate trainer_questions, trainer_topics restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await database.destroy();
});

const firstImport = new Date(fixedTestInstant());
const later = new Date(fixedTestInstant() + 24 * 60 * 60 * 1000);

describe("Bank import", () => {
  it("loads topics in the file's order and questions with everything the author wrote", async () => {
    const report = await bank.import(
      syntheticTrainerBank({ topics: 2, questionsPerTopic: 3 }),
      true,
    );

    expect(report).toEqual({
      status: "imported",
      topics: 2,
      questions: {
        added: 6,
        updated: 0,
        unchanged: 0,
        restored: 0,
        withdrawn: 0,
      },
    });
    expect(await bank.topics()).toEqual([
      { code: "t1", name: "Синтетическая тема 1", questions: 3 },
      { code: "t2", name: "Синтетическая тема 2", questions: 3 },
    ]);
    expect(await bank.question("q-t2-3")).toEqual({
      id: "q-t2-3",
      topic: "t2",
      format: "multiple",
      text: "Синтетический вопрос 3 темы t2",
      options: [
        { text: "Вариант А", correct: true, explanation: "Разбор А." },
        { text: "Вариант Б", correct: true, explanation: "Разбор Б." },
        { text: "Вариант В", correct: false, explanation: "Разбор В." },
        { text: "Вариант Г", correct: false, explanation: "Разбор Г." },
      ],
      explanation: "Общий разбор.",
      source: "Синтетический источник",
      checkedAt: "2026-10-01",
      contentRevision: 1,
      addedAt: firstImport,
      withdrawnAt: null,
    });
  });

  it("follows a new topic order and new topic names on the next import", async () => {
    const file = syntheticTrainerBank({ topics: 3, questionsPerTopic: 1 });
    await bank.import(file, true);

    file.topics.reverse();
    if (file.topics[0])
      file.topics[0].name = "Синтетическая тема с новым именем";
    await bank.import(file, true);

    expect((await bank.topics()).map(({ code, name }) => [code, name])).toEqual(
      [
        ["t3", "Синтетическая тема с новым именем"],
        ["t2", "Синтетическая тема 2"],
        ["t1", "Синтетическая тема 1"],
      ],
    );
  });

  it.each([
    [
      "a schema violation",
      (file: ReturnType<typeof syntheticTrainerBank>) => {
        Reflect.deleteProperty(file.questions[1] ?? {}, "explanation");
      },
    ],
    [
      "a repeated identifier",
      (file: ReturnType<typeof syntheticTrainerBank>) => {
        file.questions.push(syntheticQuestion("t1", 2));
      },
    ],
    [
      "a text over the length limit",
      (file: ReturnType<typeof syntheticTrainerBank>) => {
        if (file.questions[1]) file.questions[1].text = "я".repeat(201);
      },
    ],
    [
      "question data over 1 024 bytes",
      (file: ReturnType<typeof syntheticTrainerBank>) => {
        const question = file.questions[1];
        if (!question) return;
        question.text = "€".repeat(160);
        question.options.forEach((option) => {
          option.text = "€".repeat(60);
        });
      },
    ],
    [
      "context data over 1 024 bytes",
      (file: ReturnType<typeof syntheticTrainerBank>) => {
        if (file.questions[1]) file.questions[1].context = "€".repeat(400);
      },
    ],
  ])(
    "rejects the whole file for %s, names the question and leaves the database as it was",
    async (_name, spoil) => {
      await bank.import(
        syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 }),
        true,
      );
      const before = await snapshot();

      // The new file also changes a healthy question and adds one: none of it may land.
      const file = syntheticTrainerBank({ topics: 2, questionsPerTopic: 3 });
      if (file.questions[0])
        file.questions[0].text = "Синтетический вопрос, новый текст";
      spoil(file);
      vi.setSystemTime(later);
      const report = await bank.import(file, true);

      expect(report.status).toBe("rejected");
      if (report.status !== "rejected") return;
      expect(report.errors.map(({ question }) => question)).toEqual(["q-t1-2"]);
      expect(report.errors[0]?.reason).not.toBe("");
      expect(await snapshot()).toEqual(before);
    },
  );

  it("updates the text of a question with the same identifier and keeps the question itself", async () => {
    const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 });
    await bank.import(file, true);

    const [first] = file.questions;
    if (first) {
      first.text = "Синтетический вопрос 1, исправленный текст";
      first.explanation = "Исправленный общий разбор.";
    }
    vi.setSystemTime(later);
    const report = await bank.import(file, true);

    expect(report).toEqual({
      status: "imported",
      topics: 1,
      questions: {
        added: 0,
        updated: 1,
        unchanged: 1,
        restored: 0,
        withdrawn: 0,
      },
    });
    // Answers refer to the question by its identifier: the row stays, only its content moves on.
    expect(await bank.question("q-t1-1")).toMatchObject({
      text: "Синтетический вопрос 1, исправленный текст",
      explanation: "Исправленный общий разбор.",
      contentRevision: 2,
      addedAt: firstImport,
      withdrawnAt: null,
    });
    expect(await bank.question("q-t1-2")).toMatchObject({
      contentRevision: 1,
      addedAt: firstImport,
    });
  });

  it("withdraws a question the new file no longer has and keeps it stored", async () => {
    const file = syntheticTrainerBank({ topics: 2, questionsPerTopic: 2 });
    await bank.import(file, true);

    file.questions = file.questions.filter(({ id }) => id !== "q-t1-2");
    vi.setSystemTime(later);
    const report = await bank.import(file, true);

    expect(report).toMatchObject({
      status: "imported",
      questions: { unchanged: 3, withdrawn: 1 },
    });
    expect(await bank.question("q-t1-2")).toMatchObject({
      id: "q-t1-2",
      text: "Синтетический вопрос 2 темы t1",
      addedAt: firstImport,
      withdrawnAt: later,
    });
    expect(await bank.topics()).toEqual([
      { code: "t1", name: "Синтетическая тема 1", questions: 1 },
      { code: "t2", name: "Синтетическая тема 2", questions: 2 },
    ]);
  });

  it("hides a topic the new file no longer has and keeps its questions stored", async () => {
    const file = syntheticTrainerBank({ topics: 2, questionsPerTopic: 1 });
    await bank.import(file, true);

    await bank.import(
      syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 }),
      true,
    );

    expect((await bank.topics()).map(({ code }) => code)).toEqual(["t1"]);
    expect(await bank.question("q-t2-1")).toMatchObject({ topic: "t2" });
    expect((await bank.question("q-t2-1"))?.withdrawnAt).not.toBeNull();
  });

  it("returns a withdrawn question to the Bank when a later file has it again", async () => {
    const full = syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 });
    await bank.import(full, true);
    await bank.import(
      syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 }),
      true,
    );

    const report = await bank.import(full, true);

    expect(report).toMatchObject({
      questions: { added: 0, restored: 1, unchanged: 1 },
    });
    expect(await bank.question("q-t1-2")).toMatchObject({
      addedAt: firstImport,
      withdrawnAt: null,
    });
  });

  it("previews the same report without changing the database", async () => {
    await bank.import(
      syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 }),
      true,
    );
    const before = await snapshot();

    const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 3 });
    file.questions = file.questions.filter(({ id }) => id !== "q-t1-1");
    if (file.questions[0])
      file.questions[0].text = "Синтетический вопрос, новый текст";
    const report = await bank.import(file, false);

    expect(report).toEqual({
      status: "valid",
      topics: 1,
      questions: {
        added: 1,
        updated: 1,
        unchanged: 0,
        restored: 0,
        withdrawn: 1,
      },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("finds no question by an identifier the Bank never had", async () => {
    expect(await bank.question("q-unknown")).toBeUndefined();
  });

  /** Everything the Bank stores, through its own reads. */
  async function snapshot() {
    return {
      topics: await bank.topics(),
      questions: await Promise.all(
        ["q-t1-1", "q-t1-2", "q-t1-3", "q-t2-1"].map((id) => bank.question(id)),
      ),
    };
  }
});

describe("Bank import command", () => {
  const run = (mode: string | undefined, input: string) =>
    runTrainerBankImport({ mode, input, database, clock: virtualTestClock });

  it("applies a correct file and prints the report as JSON", async () => {
    const result = await run(
      "--apply",
      JSON.stringify(syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 })),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "imported",
      topics: 1,
      questions: {
        added: 2,
        updated: 0,
        unchanged: 0,
        restored: 0,
        withdrawn: 0,
      },
    });
    expect((await bank.topics()).map(({ questions }) => questions)).toEqual([
      2,
    ]);
  });

  it("previews without writing", async () => {
    const result = await run(
      "--preview",
      JSON.stringify(syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 })),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "valid" });
    expect(await bank.topics()).toEqual([]);
  });

  it("reports the question and the reason of a rejected file with exit code 2 and writes nothing", async () => {
    const file = syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 });
    if (file.questions[1]) file.questions[1].text = "я".repeat(201);

    const result = await run("--apply", JSON.stringify(file));

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "rejected",
      errors: [
        {
          question: "q-t1-2",
          field: "text",
          reason: "Текст вопроса: знаков 201, лимит 200.",
        },
      ],
    });
    expect(await bank.topics()).toEqual([]);
  });

  it.each([
    ["an unknown mode", "--force", "{}"],
    ["no mode", undefined, "{}"],
    ["a file that is not JSON", "--apply", "version: 1"],
  ])(
    "refuses %s with exit code 1 and writes nothing",
    async (_name, mode, input) => {
      const result = await run(mode, input);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(await bank.topics()).toEqual([]);
    },
  );
});
