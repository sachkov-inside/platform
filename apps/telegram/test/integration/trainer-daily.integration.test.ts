import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
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
import { z } from "zod";

import { AppModule } from "../../src/app.module.js";
import type { ApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { AuthorDelivery } from "../../src/modules/communications/author-delivery.js";
import { SequenceScheduler } from "../../src/modules/communications/sequence-scheduler.js";
import { StartResponseDeliveryProcessor } from "../../src/modules/outbound/start-response-delivery-processor.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramDeliveryResult,
  type TelegramMessages,
  type TelegramTextMessage,
  type TelegramWidgetAnswer,
  type TelegramWidgetMessage,
} from "../../src/modules/outbound/telegram-messages.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { Trainer } from "../../src/modules/trainer/trainer.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { systemClock } from "../../src/shared/clock.js";
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  privateStartUpdate,
  widgetQueryUpdate,
} from "../support/synthetic-telegram-updates.js";
import {
  syntheticQuestion,
  syntheticTrainerBank,
  type SyntheticBank,
} from "../support/synthetic-trainer-bank.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const WEBHOOK_SECRET = "synthetic_secret";
const BOT = "inside";
const OPTIONS = ["Вариант А", "Вариант Б", "Вариант В", "Вариант Г"];
const NO_QUESTIONS = ["x", "Вопросы скоро появятся."];
const WITHDRAWN_TODAY = [
  "x",
  "Сегодняшний Вопрос дня снят. Новый появится завтра.",
];
const ISSUE_CLOSED = ["x", "Этот вопрос уже закрыт. Начните новый раунд."];

const config: ApplicationConfig = {
  marketingEnabled: false,
  botIdentity: BOT,
  canonicalChatId: "-1000000000000",
  databaseUrl,
  deliveryMode: "disabled",
  evidenceDeliveryMode: "disabled",
  host: "127.0.0.1",
  linkReceiptText: "Synthetic link receipt",
  linkedMemberText: "Synthetic member status",
  linkedNonMemberText: "Synthetic non-member status",
  linkedUnavailableText: "Synthetic unavailable status",
  communityMode: "disabled",
  communityReconciliationCadenceMilliseconds: 60_000,
  communityTexts: {
    invite: "Synthetic community invite",
    preparing: "Synthetic community preparing",
    member: "Synthetic community member",
    unavailable: "Synthetic community unavailable",
    readmission: "Synthetic community readmission",
    welcome: "Synthetic community welcome",
  },
  membershipMode: "disabled",
  membershipCheckRetentionDays: 90,
  salesFunnelEventRetentionDays: 30,
  membershipReconciliationCadenceMilliseconds: 240_000,
  platformIntegrationSecret: "synthetic_platform_secret",
  port: 3002,
  // The cases press many times at one instant; the request limit has its own tests.
  senderRate: { requests: 10_000, windowMs: 10_000 },
  webhookSecret: WEBHOOK_SECRET,
  welcomeText: "Synthetic welcome",
  workersEnabled: false,
};

/** Everything the bot hands to Telegram through the outbound message port. */
class RecordedMessages implements TelegramMessages {
  readonly widgets: TelegramWidgetMessage[] = [];
  readonly answers: TelegramWidgetAnswer[] = [];
  readonly texts: TelegramTextMessage[] = [];
  /** Failures of the next answers to widget presses; an answer beyond the list succeeds. */
  readonly answerFailures: Error[] = [];

  sendWidget(message: TelegramWidgetMessage): Promise<TelegramDeliveryResult> {
    this.widgets.push(message);
    return Promise.resolve({
      kind: "delivered",
      providerMessageId: String(7000 + this.widgets.length),
    });
  }

  answerWidgetQuery(answer: TelegramWidgetAnswer): Promise<void> {
    this.answers.push(answer);
    const failure = this.answerFailures.shift();
    return failure ? Promise.reject(failure) : Promise.resolve();
  }

  sendText(message: TelegramTextMessage): Promise<TelegramDeliveryResult> {
    this.texts.push(message);
    return Promise.resolve({
      kind: "delivered",
      providerMessageId: String(8000 + this.texts.length),
    });
  }

  editText(): Promise<TelegramDeliveryResult> {
    return Promise.reject(new Error("Unexpected message edit"));
  }

  reset(): void {
    this.widgets.length = 0;
    this.answers.length = 0;
    this.texts.length = 0;
    this.answerFailures.length = 0;
  }
}

const database: Database = createDatabase(databaseUrl);
const messages = new RecordedMessages();
let application: NestFastifyApplication | undefined;
let nextUserId = 900_000;
let nextUpdateId = 5_000_000;
const newUser = () => (nextUserId += 1);
const newUpdate = () => (nextUpdateId += 1);

function bot(): NestFastifyApplication {
  if (!application) throw new Error("The bot has not started");
  return application;
}

beforeAll(async () => {
  await migrateToLatest(database);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(TELEGRAM_MESSAGES)
    .useValue(messages)
    .compile();
  application = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  await sql`
    truncate table
      trainer_daily_questions,
      trainer_issues,
      trainer_rounds,
      trainer_questions,
      trainer_topics,
      trainer_openings,
      start_response_delivery_attempts,
      start_response_deliveries,
      bot_contact_events,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
  messages.reset();
  await loadBank(syntheticTrainerBank({ topics: 3, questionsPerTopic: 2 }));
});

afterAll(async () => {
  try {
    if (application) await closeIfStarted(application);
  } finally {
    await database.destroy();
  }
});

/** The owner's import makes the stored Bank follow this synthetic file. */
async function loadBank(bank: SyntheticBank): Promise<void> {
  const report = await new TrainerBank(database, systemClock).import(
    bank,
    true,
  );
  expect(report.status).toBe("imported");
}

/** One topic with the synthetic questions of these numbers; number 3 has two correct options. */
function bankOf(numbers: readonly number[]): SyntheticBank {
  const bank = syntheticTrainerBank({ topics: 1, questionsPerTopic: 0 });
  bank.questions = numbers.map((number) =>
    syntheticQuestion("t1", number, number % 3 === 0 ? "multiple" : "single"),
  );
  return bank;
}

/** Telegram delivers the update; the bot stores it and one worker pass handles it. */
async function receive(payload: unknown): Promise<void> {
  const response = await bot()
    .getHttpAdapter()
    .getInstance()
    .inject({
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      method: "POST",
      payload: JSON.stringify(payload),
      url: "/webhooks/telegram",
    });
  expect(response.statusCode).toBe(202);
  await bot().get(TelegramUpdateProcessor).processAvailable();
}

type Screen = readonly unknown[];
const screenOf = (data: string): Screen =>
  z.array(z.unknown()).parse(JSON.parse(data));

/** A press inside the widget and the screen the bot answers with. */
async function tap(userId: number, data: string): Promise<Screen> {
  const before = messages.answers.length;
  await receive(widgetQueryUpdate(newUpdate(), userId, data));
  expect(messages.answers).toHaveLength(before + 1);
  return screenOf(messages.answers.at(-1)?.data ?? "");
}

/** The home screen in the widget message the bot sends on `/train`. */
async function openTrainer(userId: number): Promise<Screen> {
  await receive(privateStartUpdate(newUpdate(), userId, { text: "/train" }));
  return screenOf(messages.widgets.at(-1)?.chatData ?? "");
}

/** Moscow is three hours ahead of UTC all year. */
const moscow = (date: string, time: string) =>
  vi.setSystemTime(new Date(`${date}T${time}+03:00`));

interface DailyQuestion {
  readonly issueId: string;
  /** Identifier in the synthetic Bank, e.g. `q-t2-3`. */
  readonly questionId: string;
  /** The synthetic Bank marks the first option correct, or the first two when several are. */
  readonly correctMask: 1 | 3;
  /** Present when the person has already answered: the options the person picked. */
  readonly reviewMask: unknown;
}

/** Reads a Daily question screen of the synthetic Bank: a round of one step. */
function daily(screen: Screen): DailyQuestion {
  const [kind, issueId, , text, options, several, marks, total, reviewMask] =
    screen;
  expect([kind, options, total]).toEqual(["q", OPTIONS, 1]);
  const question = /^Синтетический вопрос (\d+) темы (t\d+)$/.exec(
    String(text),
  );
  if (!question || typeof issueId !== "string")
    throw new Error(`Not a synthetic question: ${JSON.stringify(screen)}`);
  const severalCorrect = Number(question[1]) % 3 === 0;
  expect(several).toBe(severalCorrect ? 1 : 0);
  // A question not answered yet carries no steps and no picked options.
  expect(marks === "" ? screen.length : 9).toBe(screen.length);
  return {
    issueId,
    questionId: `q-${String(question[2])}-${String(question[1])}`,
    correctMask: severalCorrect ? 3 : 1,
    reviewMask,
  };
}

const openDaily = async (user: number) => daily(await tap(user, "d"));
const right = (question: DailyQuestion) =>
  `a${question.issueId}:${String(question.correctMask)}`;
/** Option «Г» alone is wrong in every synthetic question. */
const wrong = (question: DailyQuestion) => `a${question.issueId}:8`;
const dontKnow = (question: DailyQuestion) => `a${question.issueId}:0`;

describe("the Daily question", () => {
  it("is the same for every person within one Moscow day", async () => {
    moscow("2026-10-07", "00:00:00");
    const early = await openDaily(newUser());
    moscow("2026-10-07", "12:00:00");
    const midday = await openDaily(newUser());
    moscow("2026-10-07", "23:59:59");
    const late = await openDaily(newUser());

    expect([midday.questionId, late.questionId]).toEqual([
      early.questionId,
      early.questionId,
    ]);
    // Each person answers an issue of their own.
    expect(new Set([early.issueId, midday.issueId, late.issueId]).size).toBe(3);
    // The question arrives as the answer to the press: the bot sends no message.
    expect(messages.widgets).toEqual([]);
    expect(messages.texts).toEqual([]);
  });

  it("changes at Moscow midnight", async () => {
    moscow("2026-10-07", "23:59:59");
    const before = await openDaily(newUser());
    moscow("2026-10-08", "00:00:00");
    const after = await openDaily(newUser());
    moscow("2026-10-08", "23:59:59");
    const sameDay = await openDaily(newUser());

    expect(after.questionId).not.toBe(before.questionId);
    expect(sameDay.questionId).toBe(after.questionId);
  });

  it("goes through every question of the Bank before one repeats, then starts over", async () => {
    await loadBank(bankOf([1, 2, 3, 4]));

    const asked: string[] = [];
    for (let day = 1; day <= 12; day += 1) {
      moscow(`2026-11-${String(day).padStart(2, "0")}`, "10:00:00");
      asked.push((await openDaily(newUser())).questionId);
    }

    const bank = ["q-t1-1", "q-t1-2", "q-t1-3", "q-t1-4"];
    for (const cycle of [asked.slice(0, 4), asked.slice(4, 8), asked.slice(8)])
      expect(cycle.toSorted()).toEqual(bank);
  });

  it("is chosen only from the questions the Bank shows, a new question included", async () => {
    await loadBank(bankOf([1, 2, 3]));
    moscow("2026-11-01", "10:00:00");
    const first = (await openDaily(newUser())).questionId;
    const [kept, withdrawn] = [1, 2, 3].filter(
      (number) => `q-t1-${String(number)}` !== first,
    );
    if (kept === undefined || withdrawn === undefined)
      throw new Error(`The first Daily question is not of the Bank: ${first}`);
    // The import withdraws one question that has not had its day and adds question 5.
    await loadBank(bankOf([Number(first.slice(-1)), kept, 5]));

    const next: string[] = [];
    for (const day of ["02", "03"]) {
      moscow(`2026-11-${day}`, "10:00:00");
      next.push((await openDaily(newUser())).questionId);
    }

    expect(next.toSorted()).toEqual([`q-t1-${String(kept)}`, "q-t1-5"]);
  });

  it("is one question when the first requests of a day arrive together", async () => {
    await loadBank(syntheticTrainerBank({ topics: 5, questionsPerTopic: 3 }));
    const people = Array.from({ length: 12 }, newUser);
    // Each person becomes a BotContact before the day starts.
    for (const person of people) await openTrainer(person);
    moscow("2026-10-08", "09:00:00");
    messages.reset();
    const trainer = bot().get(Trainer);

    await Promise.all(
      people.map((person) =>
        trainer.answer({
          contact: {
            botIdentity: BOT,
            // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
            observedAt: new Date(),
            privateChatId: String(person),
            telegramUserId: String(person),
            updateId: String(newUpdate()),
          },
          queryId: `query-${String(person)}`,
          data: "d",
        }),
      ),
    );

    const questions = messages.answers.map(
      (answer) => daily(screenOf(answer.data)).questionId,
    );
    expect(questions).toHaveLength(12);
    expect(new Set(questions).size).toBe(1);
  });

  it("says that questions are coming when the Bank is empty", async () => {
    await sql`truncate table trainer_questions, trainer_topics cascade`.execute(
      database,
    );

    expect(await tap(newUser(), "d")).toEqual(NO_QUESTIONS);
  });
});

describe("an answer to the Daily question", () => {
  it("shows the share of correct answers and the number of people who answered that day", async () => {
    // One question in the Bank: every round of every mode asks it.
    await loadBank(bankOf([1]));
    const explanation = (verdict: number, picked: number, stat: string) => [
      "e",
      verdict,
      1,
      picked,
      picked === 0
        ? "Общий разбор."
        : `Разбор ${picked === 1 ? "А" : "Г"}. Общий разбор.`,
      picked === 1 ? "1" : "0",
      1,
      stat,
    ];

    const stranger = await tap(newUser(), right(await openDaily(newUser())));
    const [alice, boris, vera, gleb] = [
      newUser(),
      newUser(),
      newUser(),
      newUser(),
    ];
    const afterRight = await tap(alice, right(await openDaily(alice)));
    const afterWrong = await tap(boris, wrong(await openDaily(boris)));
    const afterDontKnow = await tap(vera, dontKnow(await openDaily(vera)));
    // An answer to the same question in «Проверить себя» is not an answer to the Daily question.
    const check = await tap(gleb, "q");
    const afterCheck = await tap(gleb, `a${String(check[1])}:8`);
    const afterAll = await tap(gleb, right(await openDaily(gleb)));
    moscow("2026-10-08", "09:00:00");
    const nextDay = await tap(alice, wrong(await openDaily(alice)));

    // A press that names another person's issue is refused and counts nobody.
    expect(stranger).toEqual(ISSUE_CLOSED);
    // Verdict 2: a correct first answer in time earns a point in this mode too.
    expect(afterRight).toEqual(
      explanation(2, 1, "Верно ответили 100% из 1 человека"),
    );
    expect(afterWrong).toEqual(
      explanation(0, 8, "Верно ответили 50% из 2 человек"),
    );
    expect(afterDontKnow).toEqual(
      explanation(3, 0, "Верно ответили 33% из 3 человек"),
    );
    expect(afterCheck).toEqual([
      "e",
      0,
      1,
      8,
      "Разбор Г. Общий разбор.",
      "0",
      1,
      0,
    ]);
    // Verdict 1: correct without a point, the person answered this question before.
    expect(afterAll).toEqual(
      explanation(1, 1, "Верно ответили 50% из 4 человек"),
    );
    expect(nextDay).toEqual(
      explanation(0, 8, "Верно ответили 0% из 1 человека"),
    );
  });

  it("is accepted after midnight for the question the person was shown before it", async () => {
    const user = newUser();
    moscow("2026-10-07", "23:59:59");
    const question = await openDaily(user);
    moscow("2026-10-08", "00:00:10");

    const explanation = await tap(user, right(question));
    const home = await tap(user, "h");
    const today = await openDaily(user);

    expect(explanation.slice(0, 2)).toEqual(["e", 2]);
    expect(explanation.at(-1)).toBe("Верно ответили 100% из 1 человека");
    // The answer belongs to yesterday's question; today's is still new. The Series and the
    // Daily goal count the answer on the day it was given.
    expect(home).toEqual(["h", 1, 1, 5, 0]);
    expect(today.questionId).not.toBe(question.questionId);
    expect(today.reviewMask).toBeUndefined();
  });
});

describe("opening the Daily question again on the same day", () => {
  it("shows the earlier answer and its explanation and takes no second answer", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));
    const question = await openDaily(user);
    const answered = await tap(user, wrong(question));
    moscow("2026-10-07", "23:00:00");

    const reopened = await tap(user, "d");
    const second = await tap(user, right(question));
    const again = await openDaily(user);

    expect(reopened).toEqual([
      "q",
      question.issueId,
      "Синтетическая тема 1",
      "Синтетический вопрос 1 темы t1",
      OPTIONS,
      0,
      "0",
      1,
      // Option «Г», the one the person picked.
      8,
    ]);
    expect(answered).toEqual([
      "e",
      0,
      1,
      8,
      "Разбор Г. Общий разбор.",
      "0",
      1,
      "Верно ответили 0% из 1 человека",
    ]);
    // The correct pick of the second request changes nothing: the stored answer comes back.
    expect(second).toEqual(answered);
    expect(again.reviewMask).toBe(8);
    expect(await storedAnswers(user)).toEqual([
      { mode: "daily", picked_mask: 8, correct: false },
    ]);
  });

  it("shows «Не знаю» as an answer with no picked option", async () => {
    const user = newUser();
    const question = await openDaily(user);
    await tap(user, dontKnow(question));

    const reopened = await openDaily(user);

    expect(reopened.issueId).toBe(question.issueId);
    expect(reopened.reviewMask).toBe(0);
  });

  it("shows the same unanswered question, issued once", async () => {
    const user = newUser();

    const first = await openDaily(user);
    moscow("2026-10-07", "18:00:00");
    const second = await openDaily(user);

    expect(second).toEqual(first);
    expect(first.reviewMask).toBeUndefined();
  });

  it("shows the same question when the inbox runs the press twice", async () => {
    const user = newUser();
    messages.answerFailures.push(new Error("Synthetic lost answer"));

    // Telegram did not take the answer, so the inbox runs the same update again later.
    const first = await openDaily(user);
    // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
    vi.setSystemTime(Date.now() + 60_000);
    await bot().get(TelegramUpdateProcessor).processAvailable();

    expect(messages.answers).toHaveLength(2);
    expect(daily(screenOf(messages.answers.at(-1)?.data ?? ""))).toEqual(first);
  });
});

describe("the home screen", () => {
  it("marks the Daily question new until the person answers it, and new again the next day", async () => {
    const user = newUser();
    const other = newUser();
    const done = (screen: Screen) => {
      expect(screen).toHaveLength(5);
      return [screen[0], screen[4]];
    };

    const atFirst = await openTrainer(user);
    const question = await openDaily(user);
    const opened = await tap(user, "h");
    await tap(user, right(question));
    const answered = await tap(user, "h");
    const inNewWidget = await openTrainer(user);
    const ofOther = await tap(other, "h");
    moscow("2026-10-08", "00:00:00");
    const nextDay = await tap(user, "h");

    expect([atFirst, opened, ofOther, nextDay].map(done)).toEqual(
      Array.from({ length: 4 }, () => ["h", 0]),
    );
    expect([answered, inNewWidget].map(done)).toEqual([
      ["h", 1],
      ["h", 1],
    ]);
  });
});

describe("a Daily question the Bank withdrew during its day", () => {
  it("is not asked any more, and stays open for review to a person who answered it", async () => {
    await loadBank(bankOf([1]));
    const answered = newUser();
    await tap(answered, wrong(await openDaily(answered)));
    await loadBank(bankOf([2]));

    const late = await tap(newUser(), "d");
    const review = await tap(answered, "d");
    moscow("2026-10-08", "09:00:00");
    const nextDay = await openDaily(newUser());

    expect(late).toEqual(WITHDRAWN_TODAY);
    expect(review.slice(3, 4)).toEqual(["Синтетический вопрос 1 темы t1"]);
    expect(review.at(8)).toBe(8);
    expect(nextDay.questionId).toBe("q-t1-2");
  });
});

describe("without a person's action", () => {
  it("the bot sends no Daily question and no reminder of it on any later day", async () => {
    const answered = newUser();
    const leftOpen = newUser();
    const onlyHome = newUser();
    moscow("2026-10-07", "23:50:00");
    for (const person of [answered, leftOpen, onlyHome])
      await openTrainer(person);
    await tap(answered, right(await openDaily(answered)));
    await openDaily(leftOpen);
    const chosenDays = async () => {
      const { rows } = await sql<{ days: number }>`
        select count(*)::integer as days from trainer_daily_questions
      `.execute(database);
      return rows[0]?.days;
    };
    expect(await chosenDays()).toBe(1);
    messages.reset();

    // Midnight, the next morning, two days, a week, a month and a quarter later.
    const dayMs = 24 * 60 * 60 * 1000;
    // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
    const start = Date.now();
    for (const days of [10 / 1440, 0.5, 2, 7, 31, 92]) {
      vi.setSystemTime(start + days * dayMs);
      await bot().get(TelegramUpdateProcessor).processAvailable();
      await bot().get(StartResponseDeliveryProcessor).processAvailable();
      await bot().get(SequenceScheduler).processAvailable();
      await bot().get(AuthorDelivery).processAvailable();
    }

    expect(messages.widgets).toEqual([]);
    expect(messages.answers).toEqual([]);
    expect(messages.texts).toEqual([]);
    const planned = await database
      .selectFrom("start_response_deliveries")
      .select("message_text")
      .execute();
    expect(planned).toEqual([]);
    // No question was chosen for the days nobody asked on.
    expect(await chosenDays()).toBe(1);
  });
});

/** The answers the bot has stored for a person. */
function storedAnswers(user: number) {
  return database
    .selectFrom("trainer_issues as issue")
    .innerJoin("trainer_rounds as round", "round.id", "issue.round_id")
    .select(["round.mode", "issue.picked_mask", "issue.correct"])
    .where("issue.telegram_user_id", "=", String(user))
    .where("issue.answered_at", "is not", null)
    .orderBy("issue.id")
    .execute();
}
