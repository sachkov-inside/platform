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
import {
  moscowWeek,
  type TrainerTimeWindow,
} from "../../src/modules/trainer/trainer-days.js";
import {
  trainerPointsByPerson,
  trainerPointsOf,
} from "../../src/modules/trainer/trainer-points.js";
import { TrainerRounds } from "../../src/modules/trainer/trainer-rounds.js";
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
  dontKnow,
  loadBank,
  newUser,
  right,
  startTrainerBot,
  wrong,
  type TrainerBot,
} from "../support/trainer-bot.js";

// Every case starts at the fixed instant 2026-10-07T09:00:00Z: Wednesday, 12:00 in Moscow.
registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

/** A case of more than twenty presses gets more than the default five seconds on a busy machine. */
const LONG_CONVERSATION_MS = 30_000;

const database: Database = createDatabase(databaseUrl);
let bot: TrainerBot | undefined;
const trainer = (): TrainerBot => {
  if (!bot) throw new Error("The bot has not started");
  return bot;
};

beforeAll(async () => {
  await migrateToLatest(database);
  bot = await startTrainerBot(databaseUrl);
});

beforeEach(async () => {
  await clearTrainerData(database);
  trainer().messages.reset();
  // Five topics with one question each: a round of «Проверить себя» asks all of them.
  await loadBank(database, bankOf([1]));
});

afterAll(async () => {
  try {
    if (bot) await closeIfStarted(bot.application);
  } finally {
    await database.destroy();
  }
});

/** Moves the bot's clock so that the next press arrives at this Moscow time. */
function nextPressAt(moscowTime: string): void {
  vi.setSystemTime(Date.parse(`${moscowTime}+03:00`) - 2000);
}

/** Moves the bot's clock so that the next press arrives this many seconds after the last one. */
function nextPressAfter(seconds: number): void {
  // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
  vi.setSystemTime(Date.now() + (seconds - 2) * 1000);
}

describe("Points", () => {
  it("gives a point for a correct first answer within 90 seconds and none for a late, wrong or «Не знаю» answer", async () => {
    const user = newUser();
    const { tap } = trainer();

    const first = asked(await tap(user, "q"));
    nextPressAfter(90);
    const onTime = await tap(user, right(first));
    const second = asked(await tap(user, "n"));
    nextPressAfter(91);
    const late = await tap(user, right(second));
    const third = asked(await tap(user, "n"));
    const mistaken = await tap(user, wrong(third));
    const fourth = asked(await tap(user, "n"));
    const skipped = await tap(user, dontKnow(fourth));
    const fifth = asked(await tap(user, "n"));
    const quick = await tap(user, right(fifth));
    const result = await tap(user, "n");

    // Verdict: 2 is correct with a point, 1 correct without one, 0 wrong, 3 «Не знаю».
    expect([onTime, late, mistaken, skipped, quick].map((e) => e[1])).toEqual([
      2, 1, 0, 3, 2,
    ]);
    // Three correct answers of five, two of them with a point.
    expect(result.slice(0, 4)).toEqual(["r", "Проверить себя", 3, 5]);
    expect(result[5]).toBe(2);
  });

  it("gives no point for a correct answer to a question the person has answered before", async () => {
    const user = newUser();
    const { tap, playRound } = trainer();
    await playRound(user, wrong);

    // The same five questions come back: the person has not answered them correctly.
    const verdicts: unknown[] = [];
    const result = await playRound(user, (question) => {
      verdicts.push(question.questionId);
      return right(question);
    });

    expect(verdicts).toHaveLength(5);
    expect(result.slice(2, 6)).toEqual([5, 5, "Все ответы верные.", 0]);
    expect((await tap(user, "p")).slice(0, 2)).toEqual(["p", 0]);
  });

  it("applies one rule in «Проверить себя», Тренировка по теме and Вопрос дня", async () => {
    const user = newUser();
    // Six questions with one correct option in every topic.
    await loadBank(database, bankOf([1, 2, 4, 5, 7, 8]));
    await trainer().say(user, "/train");
    const person = { botIdentity: "inside", telegramUserId: String(user) };
    const rounds = new TrainerRounds(database);
    const shownAt = new Date(fixedTestInstant());
    const points: boolean[] = [];

    for (const [index, mode] of (
      ["check", "topic", "daily"] as const
    ).entries()) {
      const question = await rounds.start(person, {
        mode,
        ...(mode === "topic" ? { topicCode: `t${String(index + 1)}` } : {}),
        count: 1,
        updateId: String(77_000 + index),
        at: shownAt,
      });
      if (question.kind !== "question") throw new Error("No question to ask");
      const onTime = await rounds.answer(
        person,
        question.issueId,
        1,
        new Date(shownAt.getTime() + 90_000),
      );
      points.push(onTime?.point === true);

      const lateQuestion = await rounds.start(person, {
        mode,
        ...(mode === "topic" ? { topicCode: `t${String(index + 1)}` } : {}),
        count: 1,
        updateId: String(78_000 + index),
        at: shownAt,
      });
      if (lateQuestion.kind !== "question") throw new Error("No question");
      const late = await rounds.answer(
        person,
        lateQuestion.issueId,
        1,
        new Date(shownAt.getTime() + 90_001),
      );
      points.push(late?.point === true);
    }

    expect(points).toEqual([true, false, true, false, true, false]);
    expect(await trainerPointsOf(database, person)).toBe(3);
  });

  it("counts a person's points inside a time window and lists only people who have points", async () => {
    const { tap } = trainer();
    const [sunday, monday, none] = [newUser(), newUser(), newUser()];
    /** The person gets a question and answers it at this Moscow time. */
    const answerAt = async (user: number, moscowTime: string, how = right) => {
      nextPressAt(moscowTime);
      // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
      vi.setSystemTime(Date.now() - 2000);
      const question = asked(await tap(user, "q"));
      return tap(user, how(question));
    };
    // The week of the fixed instant ends on Sunday 2026-10-11; Monday 00:00 starts the next.
    await answerAt(sunday, "2026-10-11T23:59:50");
    await answerAt(monday, "2026-10-11T23:59:57");
    await answerAt(monday, "2026-10-12T00:00:00");
    await answerAt(none, "2026-10-12T00:00:10", wrong);
    const nextWeek = moscowWeek(new Date("2026-10-14T09:00:00Z"));

    const rows = (window?: TrainerTimeWindow) =>
      trainerPointsByPerson(database, "inside", window)
        .orderBy("issue.telegram_user_id")
        .execute();

    expect(nextWeek).toEqual({
      from: new Date("2026-10-11T21:00:00Z"),
      until: new Date("2026-10-18T21:00:00Z"),
    });
    expect(await rows()).toEqual([
      { telegram_user_id: String(sunday), points: 1 },
      { telegram_user_id: String(monday), points: 2 },
    ]);
    expect(await rows(nextWeek)).toEqual([
      { telegram_user_id: String(monday), points: 1 },
    ]);
    expect(await rows(moscowWeek(new Date(fixedTestInstant())))).toEqual([
      { telegram_user_id: String(sunday), points: 1 },
      { telegram_user_id: String(monday), points: 1 },
    ]);
  });
});

/** One answered question: a new round of «Проверить себя» and an answer to its first question. */
async function answerOne(user: number, how = dontKnow): Promise<void> {
  const { tap } = trainer();
  const explanation = await tap(user, how(asked(await tap(user, "q"))));
  expect(explanation[0]).toBe("e");
}

describe("the Series", () => {
  it("grows by a day with an answer, waits through today and drops to zero after a missed day", async () => {
    const user = newUser();
    const { tap } = trainer();
    const home = () => tap(user, "h");

    const before = await home();
    await answerOne(user);
    const firstDay = await home();
    nextPressAt("2026-10-08T09:00:00");
    const secondDayBefore = await home();
    await answerOne(user, wrong);
    const secondDay = await home();
    // 2026-10-09 passes without an answer.
    nextPressAt("2026-10-10T09:00:00");
    const afterMissedDay = await home();
    await answerOne(user, right);
    const restarted = await home();

    // The Series is the second number of the home screen.
    expect(
      [
        before,
        firstDay,
        secondDayBefore,
        secondDay,
        afterMissedDay,
        restarted,
      ].map((screen) => screen[1]),
    ).toEqual([0, 1, 1, 2, 0, 1]);
  });

  it("puts an answer at 23:59:59 and an answer at 00:00:00 of Moscow time into different days", async () => {
    const user = newUser();
    const { tap } = trainer();

    nextPressAt("2026-10-07T23:59:57");
    const last = asked(await tap(user, "q"));
    nextPressAt("2026-10-07T23:59:59");
    await tap(user, dontKnow(last));
    nextPressAt("2026-10-08T00:00:00");
    const atMidnight = await tap(user, "h");
    const first = asked(await tap(user, "q"));
    // The round started on the new day: its first answer belongs to that day too.
    await tap(user, dontKnow(first));
    const afterAnswer = await tap(user, "h");

    expect(atMidnight).toEqual(["h", 1, 0, 5, 0]);
    expect(afterAnswer).toEqual(["h", 2, 1, 5, 0]);
  });

  it("is shown with the points in the result of a round", async () => {
    const user = newUser();
    await answerOne(user);
    nextPressAt("2026-10-08T09:00:00");

    const result = await trainer().playRound(user);

    // Four questions were left to answer correctly; the Series is two days long.
    expect(result).toEqual([
      "r",
      "Проверить себя",
      5,
      5,
      "Все ответы верные.",
      4,
      2,
      0,
      0,
    ]);
  });
});

describe("the Daily goal", () => {
  it(
    "shows the answers of the Moscow day out of 5, blocks nothing and starts again at midnight",
    async () => {
      const user = newUser();
      const { tap, say, messages } = trainer();
      const shown: unknown[] = [];

      nextPressAt("2026-10-07T23:00:00");
      for (const how of [dontKnow, wrong, right, wrong, dontKnow, wrong]) {
        await answerOne(user, how);
        shown.push((await tap(user, "h"))[2]);
      }
      await say(user, "/train");
      nextPressAt("2026-10-08T00:00:00");
      const nextDay = await tap(user, "h");

      // The sixth answer is accepted like the first five; the goal stays complete at 5 of 5.
      expect(shown).toEqual([1, 2, 3, 4, 5, 5]);
      expect((await tap(user, "p"))[3]).toBe(6);
      // A new widget message opens with the same numbers.
      expect(messages.widgets.map((widget) => widget.chatData)).toEqual([
        '["h",1,5,5,0]',
      ]);
      expect(nextDay).toEqual(["h", 1, 0, 5, 0]);
    },
    LONG_CONVERSATION_MS,
  );
});

describe("the Progress screen", () => {
  it("shows a person who has answered nothing every topic as not started", async () => {
    await loadBank(database, bankOf([1, 2], 3));

    expect(await trainer().tap(newUser(), "p")).toEqual([
      "p",
      0,
      0,
      0,
      [
        ["Синтетическая тема 1", 0, 2, -1],
        ["Синтетическая тема 2", 0, 2, -1],
        ["Синтетическая тема 3", 0, 2, -1],
      ],
    ]);
  });

  it(
    "shows points, the Series, the answers and for each topic the passed questions with the share of correct first answers",
    async () => {
      const user = newUser();
      const { tap, playRound } = trainer();
      await loadBank(database, bankOf([1, 2], 3));
      /** The first answer to each question: true when it was correct. */
      const firstAnswers = new Map<string, boolean>();
      let answers = 0;

      // Day one: question 1 of a topic is answered correctly, question 2 wrong.
      await playRound(user, (question) => {
        answers += 1;
        const correct = question.questionId.endsWith("-1");
        firstAnswers.set(question.questionId, correct);
        return correct ? right(question) : wrong(question);
      });
      // Day two: the question not seen yet and the wrong ones again, all answered correctly.
      nextPressAt("2026-10-08T09:00:00");
      await playRound(user, (question) => {
        answers += 1;
        if (!firstAnswers.has(question.questionId))
          firstAnswers.set(question.questionId, true);
        return right(question);
      });
      const progress = await tap(user, "p");
      // The owner's next import withdraws question 2 of every topic.
      await loadBank(database, bankOf([1], 3));
      const afterImport = await tap(user, "p");

      expect([...firstAnswers.keys()].sort()).toEqual([
        "q-t1-1",
        "q-t1-2",
        "q-t2-1",
        "q-t2-2",
        "q-t3-1",
        "q-t3-2",
      ]);
      // Every correct first answer came in time, so each of them is a point.
      const points = [...firstAnswers.values()].filter(Boolean).length;
      expect(progress).toEqual([
        "p",
        points,
        2,
        answers,
        ["t1", "t2", "t3"].map((topic, index) => [
          `Синтетическая тема ${String(index + 1)}`,
          2,
          2,
          firstAnswers.get(`q-${topic}-2`) === true ? 100 : 50,
        ]),
      ]);
      // Points and answers stay; the topics count only the questions the Bank still shows.
      expect(afterImport).toEqual([
        "p",
        points,
        2,
        answers,
        [
          ["Синтетическая тема 1", 1, 1, 100],
          ["Синтетическая тема 2", 1, 1, 100],
          ["Синтетическая тема 3", 1, 1, 100],
        ],
      ]);
    },
    LONG_CONVERSATION_MS,
  );
});
