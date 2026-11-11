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
import { migrateToLatest } from "../../src/database/migrator.js";
import { TrainerReports } from "../../src/modules/trainer/trainer-reports.js";
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import {
  asked,
  bankOf,
  clearTrainerData,
  loadBank,
  newUser,
  startTrainerBot,
  wrong,
  type TrainerBot,
} from "../support/trainer-bot.js";

registerFixedClock();
const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) throw new Error("DATABASE_URL is required");
const database = createDatabase(databaseUrl);
let bot: TrainerBot | undefined;
const trainer = () => {
  if (!bot) throw new Error("Bot not started");
  return bot;
};
beforeAll(async () => {
  await migrateToLatest(database);
  bot = await startTrainerBot(databaseUrl);
});
beforeEach(async () => {
  await clearTrainerData(database);
  trainer().messages.reset();
  await loadBank(database, bankOf([1], 1));
});
afterAll(async () => {
  try {
    if (bot) await closeIfStarted(bot.application);
  } finally {
    await database.destroy();
  }
});

describe("question reactions", () => {
  it("counts quality feedback immediately while an unfinished round still has no learning credit", async () => {
    await loadBank(database, bankOf([1, 2], 1));
    const { tap } = trainer();
    const user = newUser();
    const question = asked(await tap(user, "q"));
    await tap(user, wrong(question));
    await tap(user, `f${question.issueId}:1`);
    const row = (await new TrainerReports(database).questions()).find(
      (line) => line.question === question.questionId,
    );
    expect(row).toMatchObject({ answers: 0, likes: 1, dislikes: 0 });
    expect((await tap(user, "p")).slice(1, 4)).toEqual([0, 0, 0]);
  });

  it("does not resurrect a cleared vote when an earlier request arrives late", async () => {
    const { tap } = trainer();
    const user = newUser();
    const question = asked(await tap(user, "q"));
    await tap(user, wrong(question));
    await tap(user, `f${question.issueId}:1`);
    await tap(user, `f${question.issueId}:0`);
    vi.setSystemTime(fixedTestInstant() + 3000);
    expect(await tap(user, `f${question.issueId}:2`)).toEqual([
      "u",
      question.issueId,
      0,
    ]);
    expect((await new TrainerReports(database).questions())[0]).toMatchObject({
      likes: 0,
      dislikes: 0,
    });
  });

  it.each(["q", "d", "tt1"])(
    "stores one editable reaction after answering in %s without changing learning statistics",
    async (mode) => {
      const { tap } = trainer();
      const user = newUser();
      const question = asked(await tap(user, mode));
      await tap(user, wrong(question));
      const before = await tap(user, "p");
      expect(await tap(user, `f${question.issueId}:1`)).toEqual([
        "u",
        question.issueId,
        1,
      ]);
      expect(await tap(user, `f${question.issueId}:1`)).toEqual([
        "u",
        question.issueId,
        1,
      ]);
      expect((await new TrainerReports(database).questions())[0]).toMatchObject(
        { likes: 1, dislikes: 0 },
      );
      expect(await tap(user, `f${question.issueId}:2`)).toEqual([
        "u",
        question.issueId,
        2,
      ]);
      expect((await new TrainerReports(database).questions())[0]).toMatchObject(
        { likes: 0, dislikes: 1 },
      );
      expect(await tap(user, `f${question.issueId}:0`)).toEqual([
        "u",
        question.issueId,
        0,
      ]);
      expect((await new TrainerReports(database).questions())[0]).toMatchObject(
        { likes: 0, dislikes: 0 },
      );
      expect(await tap(user, "p")).toEqual(before);
    },
  );

  it("rejects reactions to another person's issue and to an unanswered question without answering it", async () => {
    const { tap } = trainer();
    const user = newUser();
    const other = newUser();
    const question = asked(await tap(user, "q"));
    expect((await tap(user, `f${question.issueId}:1`))[0]).toBe("x");
    await tap(user, wrong(question));
    expect((await tap(other, `f${question.issueId}:1`))[0]).toBe("x");
    expect((await new TrainerReports(database).questions())[0]).toMatchObject({
      answers: 1,
      likes: 0,
      dislikes: 0,
    });
  });

  it("remembers a reaction on the same question in another round", async () => {
    const { tap } = trainer();
    const user = newUser();
    const first = asked(await tap(user, "q"));
    await tap(user, wrong(first));
    await tap(user, `f${first.issueId}:2`);
    const next = asked(await tap(user, "tt1"));
    expect((await tap(user, wrong(next)))[8]).toBe(2);
  });
});
