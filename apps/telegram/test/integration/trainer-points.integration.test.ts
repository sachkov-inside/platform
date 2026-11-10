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
import { migrateDown, migrateToLatest } from "../../src/database/migrator.js";
import {
  moscowWeekWindow,
  type TrainerTimeWindow,
} from "../../src/modules/trainer/trainer-days.js";
import {
  trainerPointsByPerson,
  trainerPointsOf,
} from "../../src/modules/trainer/trainer-points.js";
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
  it(
    "credits every statistic only after the whole round is answered",
    async () => {
      const user = newUser();
      const { tap } = trainer();
      await tap(user, "v10");
      const first = asked(await tap(user, "q"));
      await tap(user, right(first));
      expect((await tap(user, "h")).slice(1, 3)).toEqual([0, 0]);
      const pending = await tap(user, "p");
      expect(pending.slice(1, 4)).toEqual([0, 0, 0]);
      expect(await tap(user, "l0")).toEqual(["l", 0, 1, []]);
      for (let index = 1; index < 5; index += 1) {
        const question = asked(await tap(user, "n"));
        await tap(user, right(question));
      }
      expect((await tap(user, "h")).slice(1, 3)).toEqual([1, 5]);
      expect((await tap(user, "p")).slice(1, 4)).toEqual([5, 1, 5]);
      expect((await tap(user, "l0"))[3]).toHaveLength(1);
    },
    LONG_CONVERSATION_MS,
  );

  it("lets a completed round earn first-answer credit after an abandoned wrong attempt", async () => {
    const user = newUser();
    const { tap, playRound } = trainer();
    await tap(user, wrong(asked(await tap(user, "q"))));
    const result = await playRound(user);
    expect(result[5]).toBe(5);
    expect((await tap(user, "p")).slice(1, 4)).toEqual([5, 1, 5]);
  });

  it("credits the whole round to its completion day and week, once across retries", async () => {
    const user = newUser();
    const { tap } = trainer();
    nextPressAt("2026-10-11T23:59:40");
    await tap(user, right(asked(await tap(user, "q"))));
    nextPressAt("2026-10-12T00:00:01");
    let last;
    for (let step = 1; step < 5; step += 1) {
      last = asked(await tap(user, "n"));
      await tap(user, right(last));
    }
    expect((await tap(user, "h")).slice(1, 3)).toEqual([1, 5]);
    const person = { botIdentity: "inside", telegramUserId: String(user) };
    expect(
      await trainerPointsOf(
        database,
        person,
        moscowWeekWindow(new Date("2026-10-11T12:00:00Z")),
      ),
    ).toBe(0);
    expect(
      await trainerPointsOf(
        database,
        person,
        moscowWeekWindow(new Date("2026-10-12T12:00:00Z")),
      ),
    ).toBe(5);
    nextPressAt("2026-10-13T09:00:00");
    if (!last) throw new Error("Round had no last question");
    await tap(user, right(last));
    expect((await tap(user, "h")).slice(1, 3)).toEqual([1, 0]);
    expect((await tap(user, "p")).slice(1, 4)).toEqual([5, 1, 5]);
  });

  it("upgrades historical rounds without crediting unfinished attempts", async () => {
    const [finished, pending] = [newUser(), newUser()];
    await trainer().playRound(finished);
    await trainer().tap(
      pending,
      right(asked(await trainer().tap(pending, "q"))),
    );
    // A prior deployment has the same answers but no durable completion field.
    await migrateDown(database);
    await migrateToLatest(database);
    expect((await trainer().tap(finished, "p")).slice(1, 4)).toEqual([5, 1, 5]);
    expect((await trainer().tap(pending, "p")).slice(1, 4)).toEqual([0, 0, 0]);
  });

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
      1, 1, 0, 3, 2,
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

  it.each([
    ["«Проверить себя»", "q"],
    ["Тренировка по теме", "tt1"],
    ["Вопрос дня", "d"],
  ])(
    "gives a point in %s for an answer 90 seconds after the question and none a second later",
    async (_mode, start) => {
      const { tap } = trainer();
      /** The verdict a new person gets for a correct answer this long after the question. */
      const verdictAfter = async (seconds: number) => {
        const user = newUser();
        if (start === "q") await loadBank(database, bankOf([1], 1));
        const question = asked(await tap(user, start));
        nextPressAfter(seconds);
        const explanation = await tap(user, right(question));
        // The person's points are the second number of the Progress screen.
        return [explanation[1], (await tap(user, "p"))[1]];
      };

      // Verdict 2 is correct with a point, verdict 1 is correct without one.
      expect(await verdictAfter(90)).toEqual([2, 1]);
      expect(await verdictAfter(91)).toEqual([1, 0]);
    },
  );

  it("counts a person's points inside a time window and lists only people who have points", async () => {
    const { tap } = trainer();
    const [sunday, monday, none] = [newUser(), newUser(), newUser()];
    /** The person gets a question and answers it at this Moscow time. */
    const answerAt = async (user: number, moscowTime: string, how = right) => {
      nextPressAt(moscowTime);
      // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
      vi.setSystemTime(Date.now() - 2000);
      const question = asked(
        await tap(
          user,
          user === monday && moscowTime.includes("12T") ? "tt2" : "tt1",
        ),
      );
      return tap(user, how(question));
    };
    // The week of the fixed instant ends on Sunday 2026-10-11; Monday 00:00 starts the next.
    await answerAt(sunday, "2026-10-11T23:59:50");
    await answerAt(monday, "2026-10-11T23:59:57");
    await answerAt(monday, "2026-10-12T00:00:00");
    await answerAt(none, "2026-10-12T00:00:10", wrong);
    const nextWeek = moscowWeekWindow(new Date("2026-10-14T09:00:00Z"));

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
    expect(await rows(moscowWeekWindow(new Date(fixedTestInstant())))).toEqual([
      { telegram_user_id: String(sunday), points: 1 },
      { telegram_user_id: String(monday), points: 1 },
    ]);
    const person = { botIdentity: "inside", telegramUserId: String(monday) };
    expect(await trainerPointsOf(database, person, nextWeek)).toBe(1);
    expect(await trainerPointsOf(database, person)).toBe(2);
    expect(
      await trainerPointsOf(database, { ...person, botIdentity: "other" }),
    ).toBe(0);
  });
});

/** One answered question: a new round of «Проверить себя» and an answer to its first question. */
async function answerOne(user: number, how = dontKnow): Promise<void> {
  const { tap } = trainer();
  const explanation = await tap(user, how(asked(await tap(user, "tt1"))));
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
    const last = asked(await tap(user, "tt1"));
    nextPressAt("2026-10-07T23:59:59");
    await tap(user, dontKnow(last));
    nextPressAt("2026-10-08T00:00:00");
    const atMidnight = await tap(user, "h");
    const first = asked(await tap(user, "tt1"));
    // The round started on the new day: its first answer belongs to that day too.
    await tap(user, dontKnow(first));
    const afterAnswer = await tap(user, "h");

    expect(atMidnight).toEqual(["h", 1, 0, 5, 0]);
    expect(afterAnswer).toEqual(["h", 2, 1, 5, 0]);
  });

  it("is shown with the points in the result of a round", async () => {
    const user = newUser();
    await trainer().playRound(user, dontKnow);
    nextPressAt("2026-10-08T09:00:00");

    const result = await trainer().playRound(user);

    // The completed first round consumes the first credited attempts; the Series is two days long.
    expect(result).toEqual([
      "r",
      "Проверить себя",
      5,
      5,
      "Все ответы верные.",
      0,
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
      for (const how of [dontKnow, wrong, dontKnow, wrong, dontKnow, wrong]) {
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
  it("pages a growing Bank in topics and Progress and clamps old page links", async () => {
    await loadBank(database, bankOf([1], 64));
    const user = newUser();
    const first = await trainer().tap(user, "t");
    expect(first.slice(2)).toEqual([0, 22]);
    expect(first[1]).toHaveLength(3);
    const last = await trainer().tap(user, "t:999");
    expect(last).toEqual([
      "t",
      [["t64", "Синтетическая тема 64", 0, 1]],
      21,
      22,
    ]);
    const progress = await trainer().tap(user, "p:999");
    expect(progress).toEqual([
      "p",
      0,
      0,
      0,
      [["Синтетическая тема 64", 0, 1, -1]],
      21,
      22,
    ]);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(1024);
  });

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
