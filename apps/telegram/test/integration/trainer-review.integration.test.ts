import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { hasText } from "../../src/shared/text.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  asked,
  bankOf,
  clearTrainerData,
  loadBank,
  newUser,
  right,
  startTrainerBot,
  type TrainerBot,
} from "../support/trainer-bot.js";
registerFixedClock();
const url = process.env["DATABASE_URL"];
if (!hasText(url)) throw new Error("DATABASE_URL required");
const database = createDatabase(url);
let bot: TrainerBot;
beforeAll(async () => {
  await migrateToLatest(database);
  bot = await startTrainerBot(url);
});
beforeEach(async () => {
  await clearTrainerData(database);
  bot.messages.reset();
  await loadBank(database, bankOf([1, 2], 2));
});
afterAll(async () => {
  try {
    await bot.application.close();
  } finally {
    await database.destroy();
  }
});
describe("round navigation across messages", () => {
  it("continues the named issue's own round after another message answered the Daily question", async () => {
    const user = newUser();
    const first = asked(await bot.tap(user, "q"));
    await bot.tap(user, right(first));
    const daily = asked(await bot.tap(user, "d"));
    await bot.tap(user, right(daily));
    expect((await bot.tap(user, `n${first.issueId}`))[0]).toBe("q");
    const stranger = newUser();
    expect(await bot.tap(stranger, `n${first.issueId}`)).toEqual([
      "h",
      0,
      0,
      5,
      0,
    ]);
  });
  it("skips withdrawn pending questions and counts only completed steps in the result", async () => {
    const user = newUser();
    const first = asked(await bot.tap(user, "q"));
    await bot.tap(user, right(first));
    const bank = bankOf([1, 2], 2);
    bank.questions = bank.questions.filter((q) => q.id === first.questionId);
    bank.topics = bank.topics.filter((t) => t.code === first.topicCode);
    await loadBank(database, bank);
    const result = await bot.tap(user, `n${first.issueId}`);
    expect(result.slice(0, 4)).toEqual(["r", "Проверить себя", 1, 1]);
  });
  it("does not re-show an unanswered Daily question withdrawn by import", async () => {
    const user = newUser();
    const daily = asked(await bot.tap(user, "d"));
    const bank = bankOf([1, 2], 2);
    bank.questions = bank.questions.filter((q) => q.id !== daily.questionId);
    await loadBank(database, bank);
    expect(await bot.tap(user, "d")).toEqual([
      "i",
      "Сегодняшний Вопрос дня снят. Новый появится завтра.",
    ]);
  });
});
