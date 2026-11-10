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
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  asked,
  bankOf,
  clearTrainerData,
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

/** A new person with this Telegram name. */
function person(firstName: string, lastName?: string): number {
  const user = newUser();
  trainer().rename(user, firstName, lastName);
  return user;
}

/** Earns points in a completed round; remaining answers are wrong. */
async function earn(user: number, points: number): Promise<void> {
  const result = await trainer().playRound(user, (question, step) =>
    step <= points ? right(question) : wrong(question),
  );
  expect(result[5]).toBe(points);
}

/** What the bot keeps about showing people in the Rating. */
const storedConsents = () =>
  database
    .selectFrom("trainer_rating_consents")
    .select(["telegram_user_id", "shown", "display_name"])
    .orderBy("telegram_user_id")
    .execute();

// Rating screen: ["l", allTime, shown, rows]; shown is 2 until the person has chosen, then
// 1 (shown) or 0 (not shown). A row is [place, name, points, isViewer].
describe("the Rating", () => {
  it("shows nobody by default: a person with points is in no table and sees the offer to be shown", async () => {
    const { tap, messages } = trainer();
    const [anna, boris] = [person("Анна"), person("Борис")];
    await earn(anna, 2);

    const own = [await tap(anna, "l0"), await tap(anna, "l1")];
    const others = [await tap(boris, "l0"), await tap(boris, "l1")];

    expect(own).toEqual([
      ["l", 0, 2, []],
      ["l", 1, 2, []],
    ]);
    expect(others).toEqual(own);
    // Opening the Rating stores no name and sends no message.
    expect(await storedConsents()).toEqual([]);
    expect(messages.widgets).toEqual([]);
    expect(messages.texts).toEqual([]);
  });

  it("puts a person into both tables when they turn the display on and removes them from both at once when they turn it off", async () => {
    const { tap } = trainer();
    const [anna, boris] = [person("Анна", "Каренина"), person("Борис")];
    await earn(anna, 2);
    await earn(boris, 1);

    const turnedOn = await tap(anna, "v10");
    const allTime = await tap(anna, "l1");
    const seenByOther = [await tap(boris, "l0"), await tap(boris, "l1")];
    const storedWhileShown = await storedConsents();
    const turnedOff = await tap(anna, "v01");
    const week = await tap(anna, "l0");
    const seenByOtherAfter = [await tap(boris, "l0"), await tap(boris, "l1")];

    expect(turnedOn).toEqual(["l", 0, 1, [[1, "Анна Каренина", 2, 1]]]);
    expect(allTime).toEqual(["l", 1, 1, [[1, "Анна Каренина", 2, 1]]]);
    // Another person sees the name, not themselves, and still has the offer.
    expect(seenByOther).toEqual([
      ["l", 0, 2, [[1, "Анна Каренина", 2, 0]]],
      ["l", 1, 2, [[1, "Анна Каренина", 2, 0]]],
    ]);
    expect(storedWhileShown).toEqual([
      {
        telegram_user_id: String(anna),
        shown: true,
        display_name: "Анна Каренина",
      },
    ]);
    // The answer to the switch is the table the person was looking at, already without them.
    expect(turnedOff).toEqual(["l", 1, 0, []]);
    expect(week).toEqual(["l", 0, 0, []]);
    expect(seenByOtherAfter).toEqual([
      ["l", 0, 2, []],
      ["l", 1, 2, []],
    ]);
    // The choice stays, the name does not.
    expect(await storedConsents()).toEqual([
      { telegram_user_id: String(anna), shown: false, display_name: null },
    ]);
  });

  it("keeps the offer away after «не показывать» and lets the person turn the display on later", async () => {
    const { tap } = trainer();
    const anna = person("Анна");
    await earn(anna, 1);

    const declined = await tap(anna, "v00");
    const later = await tap(anna, "l0");
    const turnedOn = await tap(anna, "v11");

    expect(declined).toEqual(["l", 0, 0, []]);
    expect(later).toEqual(["l", 0, 0, []]);
    expect(turnedOn).toEqual(["l", 1, 1, [[1, "Анна", 1, 1]]]);
  });

  it("shows the Telegram name of the person's last request, cut to one line of 24 characters", async () => {
    const { tap } = trainer();
    const [anna, boris] = [person("Анна"), person("Борис")];
    await earn(anna, 1);
    await earn(boris, 1);
    await tap(anna, "v10");

    // Both change their name in Telegram; any next request brings the new one.
    trainer().rename(anna, "Анна-Мария\nАлександра", "фон Гогенцоллерн");
    trainer().rename(boris, "Борис Тайный");
    await tap(anna, "h");
    await tap(boris, "h");
    const table = await tap(boris, "l1");

    expect(table).toEqual(["l", 1, 2, [[1, "Анна-Мария Александра фо", 1, 0]]]);
    // The bot keeps a name only for a person who is shown.
    expect(await storedConsents()).toEqual([
      {
        telegram_user_id: String(anna),
        shown: true,
        display_name: "Анна-Мария Александра фо",
      },
    ]);
  });

  it("counts «Неделя» from Monday 00:00 to Sunday 24:00 of Moscow time and «Всё время» without a border", async () => {
    const { tap } = trainer();
    const [anna, boris] = [person("Анна"), person("Борис")];

    // The week of the fixed instant ends with Sunday 2026-10-11.
    nextPressAt("2026-10-11T23:50:00");
    await tap(anna, "v10");
    await earn(anna, 2);
    const sunday = await tap(anna, "l0");
    // Boris gets his question on Sunday and answers at Monday 00:00:00.
    nextPressAt("2026-10-11T23:59:58");
    const borisRound = asked(await tap(boris, "q"));
    nextPressAt("2026-10-12T00:00:00");
    await tap(boris, right(borisRound));
    for (let step = 1; step < 5; step += 1)
      await tap(boris, wrong(asked(await tap(boris, "n"))));
    const monday = await tap(boris, "v10");
    const mondayOfAnna = await tap(anna, "l0");
    const allTime = await tap(anna, "l1");

    expect(sunday).toEqual(["l", 0, 1, [[1, "Анна", 2, 1]]]);
    expect(monday).toEqual(["l", 0, 1, [[1, "Борис", 1, 1]]]);
    // Anna has no point in the new week: the table of the week has no row of hers.
    expect(mondayOfAnna).toEqual(["l", 0, 1, [[1, "Борис", 1, 0]]]);
    expect(allTime).toEqual([
      "l",
      1,
      1,
      [
        [1, "Анна", 2, 1],
        [2, "Борис", 1, 0],
      ],
    ]);
  });

  it(
    "shows the first 7 rows sorted by points and the person's own row, within 1 024 bytes at the longest names",
    async () => {
      const { tap, messages } = trainer();
      // Nine people; each name is 30 signs of four bytes, the longest a row can cost.
      const faces = [..."😀😁😂🤣😃😄😅😆😉"];
      const people = faces.map((face) => person(face.repeat(30)));
      const shownName = (index: number) => String(faces[index]).repeat(24);
      for (const [index, user] of people.entries()) {
        await tap(user, "v10");
        // The fifth person earns two points, everyone else one.
        await earn(user, index === 4 ? 2 : 1);
      }
      const silent = person("Без очков");
      await tap(silent, "v10");

      const ofLast = await tap(Number(people[8]), "l0");
      const bytes = Buffer.byteLength(String(messages.answers.at(-1)?.data));
      const ofFirst = await tap(Number(people[0]), "l1");
      const ofSilent = await tap(silent, "l0");
      const ofStranger = await tap(newUser(), "l0");

      // More points come first; of equal points, the person who earned them earlier.
      const top = [4, 0, 1, 2, 3, 5, 6].map((index, row) => [
        row + 1,
        shownName(index),
        index === 4 ? 2 : 1,
        0,
      ]);
      expect(ofLast).toEqual(["l", 0, 1, [...top, [9, shownName(8), 1, 1]]]);
      expect(bytes).toBeGreaterThan(8 * 96);
      expect(bytes).toBeLessThanOrEqual(1024);
      expect(ofFirst).toEqual([
        "l",
        1,
        1,
        top.map((row) => (row[0] === 2 ? [2, shownName(0), 1, 1] : row)),
      ]);
      // A shown person without points and a person who is not shown have no row of their own.
      expect(ofSilent).toEqual(["l", 0, 1, top]);
      expect(ofStranger).toEqual(["l", 0, 2, top]);
    },
    LONG_CONVERSATION_MS,
  );

  it(
    "shows the place of the week in the result of a round only to a person who is shown",
    async () => {
      const { tap, playRound } = trainer();
      const [anna, boris, vera] = [
        person("Анна"),
        person("Борис"),
        person("Вера"),
      ];
      await tap(anna, "v10");
      await tap(vera, "v10");

      // Anna answers three of five correctly, Boris and Vera all five. Place: eighth item.
      const ofAnna = await playRound(anna, (question, step) =>
        step > 3 ? wrong(question) : right(question),
      );
      const ofBoris = await playRound(boris);
      const ofVera = await playRound(vera);
      const table = await tap(anna, "l0");

      expect([ofAnna, ofBoris, ofVera].map((result) => result[0])).toEqual([
        "r",
        "r",
        "r",
      ]);
      expect([ofAnna[5], ofAnna[7]]).toEqual([3, 1]);
      // Boris has the most points of the week and is not shown: no place for him.
      expect([ofBoris[5], ofBoris[7]]).toEqual([5, 0]);
      expect([ofVera[5], ofVera[7]]).toEqual([5, 1]);
      expect(table).toEqual([
        "l",
        0,
        1,
        [
          [1, "Вера", 5, 0],
          [2, "Анна", 3, 1],
        ],
      ]);
    },
    LONG_CONVERSATION_MS,
  );
});
