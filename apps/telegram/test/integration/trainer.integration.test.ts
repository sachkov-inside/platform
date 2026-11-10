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
import { COMMUNICATION_TRANSPORT } from "../../src/modules/communications/communication-delivery.js";
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
import { TRAINER_WIDGET_HTML } from "../../src/modules/trainer/widget/trainer-widget-html.generated.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { virtualTestClock } from "../support/fixed-clock.js";
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
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
// The empty home screen: no Series, 0 of 5 for the Daily goal, the Daily question not answered.
const EMPTY_HOME = '["h",0,0,5,0]';
const UPDATE_TELEGRAM =
  "Тренажёр не открылся. Обновите Telegram до последней версии и отправьте /train ещё раз.";
const TOO_OFTEN = '["x","Слишком часто. Повторите через несколько секунд."]';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const config: ApplicationConfig = {
  marketingEnabled: false,
  botIdentity: "inside",
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
  webhookSecret: WEBHOOK_SECRET,
  welcomeText: "Synthetic welcome",
  workersEnabled: false,
};

/** Everything the bot hands to Telegram through the outbound message port. */
class RecordedMessages implements TelegramMessages {
  readonly widgets: TelegramWidgetMessage[] = [];
  readonly answers: TelegramWidgetAnswer[] = [];
  readonly texts: TelegramTextMessage[] = [];
  /** Results of the next widget sends; a send beyond the list is delivered. */
  readonly widgetResults: (TelegramDeliveryResult | Error)[] = [];
  /** Failures of the next answers to widget presses; an answer beyond the list succeeds. */
  readonly answerFailures: Error[] = [];

  sendWidget(message: TelegramWidgetMessage): Promise<TelegramDeliveryResult> {
    this.widgets.push(message);
    const result = this.widgetResults.shift();
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(
      result ?? {
        kind: "delivered",
        providerMessageId: String(7000 + this.widgets.length),
      },
    );
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
    this.widgetResults.length = 0;
    this.answerFailures.length = 0;
  }
}

interface Bot {
  readonly application: NestFastifyApplication;
  readonly messages: RecordedMessages;
  /** Messages of the marketing channel: sequences and broadcasts. */
  readonly marketingMessages: unknown[];
}

const database: Database = createDatabase(databaseUrl);
let bot: Bot;
/** The same application with marketing sequences switched on. */
let marketingBot: Bot;
// The per-user rate limit lives in process memory, so each case uses people of its own.
const started: NestFastifyApplication[] = [];
let nextUserId = 500_000;
let nextUpdateId = 1;
const newUser = () => (nextUserId += 1);
const newUpdate = () => (nextUpdateId += 1);

async function startBot(marketingEnabled: boolean): Promise<Bot> {
  const messages = new RecordedMessages();
  const marketingMessages: unknown[] = [];
  const module = await Test.createTestingModule({
    imports: [AppModule.register({ ...config, marketingEnabled })],
  })
    .overrideProvider(TELEGRAM_MESSAGES)
    .useValue(messages)
    .overrideProvider(COMMUNICATION_TRANSPORT)
    .useValue({
      send: (message: unknown) => {
        marketingMessages.push(message);
        return Promise.resolve({ kind: "delivered", providerMessageId: "1" });
      },
    })
    .compile();
  const application = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  // Registered before init, so afterAll closes an application whose start failed.
  // deterministic-test-allow shared-mutation: afterAll closes every application registered here.
  started.push(application);
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return { application, messages, marketingMessages };
}

beforeAll(async () => {
  await migrateToLatest(database);
  bot = await startBot(false);
  marketingBot = await startBot(true);
});

beforeEach(async () => {
  await sql`
    truncate table
      trainer_issues,
      trainer_rounds,
      trainer_questions,
      trainer_topics,
      trainer_openings,
      communication_entries,
      communication_contacts,
      platform_links,
      start_response_delivery_attempts,
      start_response_deliveries,
      bot_contact_events,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
  for (const each of [bot, marketingBot]) {
    each.messages.reset();
    each.marketingMessages.length = 0;
  }
  await loadBank(syntheticTrainerBank({ topics: 6, questionsPerTopic: 3 }));
});

/** The owner's import makes the stored Bank follow this synthetic file. */
async function loadBank(bank: SyntheticBank): Promise<void> {
  const report = await new TrainerBank(database, virtualTestClock).import(
    bank,
    true,
  );
  expect(report.status).toBe("imported");
}

afterAll(async () => {
  try {
    for (const application of started) await closeIfStarted(application);
  } finally {
    await database.destroy();
  }
});

/** Telegram delivers the update; the bot stores it and one worker pass handles it. */
async function receive(payload: unknown, target: Bot = bot): Promise<void> {
  const response = await target.application
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
  await target.application.get(TelegramUpdateProcessor).processAvailable();
}

const say = (userId: number, text: string, target: Bot = bot) =>
  receive(privateStartUpdate(newUpdate(), userId, { text }), target);

const press = (userId: number, data: string, target: Bot = bot) =>
  receive(widgetQueryUpdate(newUpdate(), userId, data), target);

function openings() {
  return database
    .selectFrom("trainer_openings")
    .select(["telegram_user_id", "entry", "source_code", "delivery"])
    .orderBy("update_id")
    .execute();
}

async function plannedTexts(): Promise<string[]> {
  const rows = await database
    .selectFrom("start_response_deliveries")
    .select("message_text")
    .orderBy("id")
    .execute();
  return rows.map((row) => row.message_text);
}

describe("opening the Trainer", () => {
  it.each([
    ["the /train command", "/train", "command"],
    ["the «Тренажёр» menu text", "Тренажёр", "menu"],
    ["a Trainer link", "/start train", "link"],
  ])("sends one home-screen widget on %s", async (_name, text, entry) => {
    const user = newUser();

    await say(user, text);

    expect(bot.messages.widgets).toEqual([
      {
        chatId: String(user),
        html: TRAINER_WIDGET_HTML,
        chatData: EMPTY_HOME,
        height: 0,
      },
    ]);
    expect(bot.messages.texts).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toEqual([
      {
        telegram_user_id: String(user),
        entry,
        source_code: null,
        delivery: "delivered",
      },
    ]);
  });

  it("serves a person the bot has never seen, with no Platform link", async () => {
    const user = newUser();

    await say(user, "/start train");

    expect(bot.messages.widgets).toHaveLength(1);
    const contacts = await database
      .selectFrom("bot_contacts")
      .select(["telegram_user_id", "contactability"])
      .execute();
    expect(contacts).toEqual([
      { telegram_user_id: String(user), contactability: "reachable" },
    ]);
    const links = await database
      .selectFrom("platform_links")
      .select("telegram_user_id")
      .execute();
    expect(links).toEqual([]);
  });

  it("records every opening with the source label of its link", async () => {
    const user = newUser();
    const other = newUser();

    await say(user, "/start train_autumn-mail");
    await say(user, "/start train");
    await say(other, "/start train_autumn-mail");
    await say(other, "/train");

    expect(bot.messages.widgets).toHaveLength(4);
    expect(await openings()).toEqual([
      {
        telegram_user_id: String(user),
        entry: "link",
        source_code: "autumn-mail",
        delivery: "delivered",
      },
      {
        telegram_user_id: String(user),
        entry: "link",
        source_code: null,
        delivery: "delivered",
      },
      {
        telegram_user_id: String(other),
        entry: "link",
        source_code: "autumn-mail",
        delivery: "delivered",
      },
      {
        telegram_user_id: String(other),
        entry: "command",
        source_code: null,
        delivery: "delivered",
      },
    ]);
  });

  it("keeps a Trainer link out of the marketing entry flow", async () => {
    const user = newUser();

    await say(user, "/start train_autumn-mail", marketingBot);

    expect(marketingBot.messages.widgets).toHaveLength(1);
    expect(marketingBot.messages.texts).toEqual([]);
    expect(marketingBot.marketingMessages).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
    const entries = await database
      .selectFrom("communication_entries")
      .select("source_code")
      .execute();
    expect(entries).toEqual([]);
  });

  it("opens for a person who switched marketing messages off", async () => {
    const user = newUser();
    await say(user, "/stop", marketingBot);
    const preference = await database
      .selectFrom("communication_contacts")
      .select("marketing_enabled")
      .where("telegram_user_id", "=", String(user))
      .executeTakeFirstOrThrow();
    expect(preference.marketing_enabled).toBe(false);
    const textsBefore = await plannedTexts();

    await say(user, "/train", marketingBot);
    await say(user, "/start train_autumn-mail", marketingBot);

    expect(
      marketingBot.messages.widgets.map((widget) => widget.chatData),
    ).toEqual([EMPTY_HOME, EMPTY_HOME]);
    expect(await plannedTexts()).toEqual(textsBefore);
    expect(marketingBot.marketingMessages).toEqual([]);
  });

  it.each([
    ["/train in a group", { text: "/train", chatType: "supergroup" }],
    ["«Тренажёр» in a group", { text: "Тренажёр", chatType: "group" }],
    ["a Trainer link in a group", { text: "/start train", chatType: "group" }],
    ["/train in a channel", { text: "/train", chatType: "channel" }],
    ["/train from a bot", { text: "/train", isBot: true }],
  ])("sends nothing on %s", async (_name, options) => {
    await receive(privateStartUpdate(newUpdate(), newUser(), options));

    expect(bot.messages.widgets).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toEqual([]);
  });

  it("sends nothing on a channel post with the command", async () => {
    await receive({
      update_id: newUpdate(),
      channel_post: {
        chat: { id: -1_000_000_000_777, type: "channel" },
        message_id: 1,
        text: "/train",
      },
    });

    expect(bot.messages.widgets).toEqual([]);
    expect(await openings()).toEqual([]);
  });

  it("sends one widget when Telegram repeats the same update", async () => {
    const update = privateStartUpdate(newUpdate(), newUser(), {
      text: "/train",
    });

    await receive(update);
    await receive(update);

    expect(bot.messages.widgets).toHaveLength(1);
    expect(await openings()).toHaveLength(1);
  });
});

describe("a widget Telegram does not deliver", () => {
  it("asks to update Telegram with one text when Telegram rejects the widget", async () => {
    const user = newUser();
    bot.messages.widgetResults.push({
      kind: "api_rejected",
      providerErrorCode: 400,
    });

    await say(user, "/train");

    expect(bot.messages.widgets).toHaveLength(1);
    expect(await plannedTexts()).toEqual([UPDATE_TELEGRAM]);
    expect(await openings()).toMatchObject([{ delivery: "rejected" }]);

    await bot.application
      .get(StartResponseDeliveryProcessor)
      .processAvailable();
    expect(bot.messages.texts).toEqual([
      { chatId: String(user), text: UPDATE_TELEGRAM },
    ]);
  });

  it("sends the widget again after Telegram asked to retry later", async () => {
    const user = newUser();
    bot.messages.widgetResults.push({
      kind: "api_retryable",
      providerErrorCode: 429,
      retryAfterSeconds: 1,
    });

    await say(user, "/train");

    expect(bot.messages.widgets).toHaveLength(1);
    expect(await openings()).toMatchObject([{ delivery: "retry" }]);

    // The inbox offers the failed update again after its backoff.
    vi.setSystemTime(fixedTestInstant() + 60_000);
    await bot.application.get(TelegramUpdateProcessor).processAvailable();

    expect(bot.messages.widgets).toHaveLength(2);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toMatchObject([{ delivery: "delivered" }]);
  });

  it("never sends a second widget for one request whose delivery is unknown", async () => {
    const user = newUser();
    bot.messages.widgetResults.push({ kind: "transport_unknown" });

    await say(user, "/train");
    vi.setSystemTime(fixedTestInstant() + 60_000);
    await bot.application.get(TelegramUpdateProcessor).processAvailable();

    expect(bot.messages.widgets).toHaveLength(1);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toMatchObject([{ delivery: "unknown" }]);
    const update = await database
      .selectFrom("telegram_updates")
      .select("state")
      .executeTakeFirstOrThrow();
    expect(update.state).toBe("processed");
  });
});

describe("a send that broke off with no result", () => {
  it("is not repeated when the inbox runs the request again", async () => {
    const user = newUser();
    bot.messages.widgetResults.push(new Error("Synthetic broken send"));

    await say(user, "/train");
    expect(await openings()).toMatchObject([{ delivery: "sending" }]);
    vi.setSystemTime(fixedTestInstant() + 60_000);
    await bot.application.get(TelegramUpdateProcessor).processAvailable();

    expect(bot.messages.widgets).toHaveLength(1);
    expect(await plannedTexts()).toEqual([]);
    const update = await database
      .selectFrom("telegram_updates")
      .select("state")
      .executeTakeFirstOrThrow();
    expect(update.state).toBe("processed");
  });
});

describe("a press inside the widget", () => {
  it("runs in the lane of the person who pressed", async () => {
    const user = newUser();
    const update = widgetQueryUpdate(newUpdate(), user, "h");

    await receive(update);

    const stored = await database
      .selectFrom("telegram_updates")
      .select(["lane_key", "state"])
      .where("update_id", "=", String(update.update_id))
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ lane_key: String(user), state: "processed" });
  });

  it("answers the home request with the home screen and sends no message", async () => {
    const user = newUser();
    const update = widgetQueryUpdate(newUpdate(), user, "h");

    await receive(update);

    expect(bot.messages.answers).toEqual([
      { queryId: update.widget_query.id, data: EMPTY_HOME },
    ]);
    expect(bot.messages.widgets).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
  });

  it.each(["zzz", "a:1", "h ", "ж"])(
    "answers the unknown request %j with the failure screen",
    async (data) => {
      await press(newUser(), data);

      expect(bot.messages.answers.map((answer) => answer.data)).toEqual([
        '["x"]',
      ]);
    },
  );

  it("answers presses over the per-user limit with a retry-later screen and no chat text", async () => {
    const user = newUser();
    const other = newUser();

    // The limit is 10 requests of one person in 10 seconds; all presses share one instant.
    for (let index = 0; index < 12; index += 1) await press(user, "h");
    await press(other, "h");

    expect(bot.messages.answers.map((answer) => answer.data)).toEqual([
      ...Array.from({ length: 10 }, () => EMPTY_HOME),
      TOO_OFTEN,
      TOO_OFTEN,
      EMPTY_HOME,
    ]);
    expect(await plannedTexts()).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
  });

  it("counts the opening and the presses of one person together", async () => {
    const user = newUser();

    for (let index = 0; index < 10; index += 1) await say(user, "/train");
    await press(user, "h");

    expect(bot.messages.widgets).toHaveLength(10);
    expect(bot.messages.answers.map((answer) => answer.data)).toEqual([
      TOO_OFTEN,
    ]);
  });
});

describe("without a person's action", () => {
  it("sends nothing on any later day, whatever the person did before", async () => {
    const user = newUser();
    const optedOut = newUser();
    for (const target of [bot, marketingBot]) {
      await say(user, "/train", target);
      await say(user, "/start train_autumn-mail", target);
      await press(user, "h", target);
      await press(user, "q", target);
      await press(user, "d", target);
    }
    await say(optedOut, "/stop", marketingBot);
    await say(optedOut, "/train", marketingBot);
    // Replies the people asked for (the /stop receipt) leave before the quiet period starts.
    for (const target of [bot, marketingBot])
      await target.application
        .get(StartResponseDeliveryProcessor)
        .processAvailable();
    const openingsBefore = await openings();
    const textsBefore = await plannedTexts();
    for (const target of [bot, marketingBot]) target.messages.reset();

    // The next minute, the next day, two days, a week, a month and a quarter later.
    for (const days of [1 / 1440, 1, 2, 7, 31, 92]) {
      vi.setSystemTime(fixedTestInstant() + days * ONE_DAY_MS);
      for (const target of [bot, marketingBot]) {
        const { application } = target;
        await application.get(TelegramUpdateProcessor).processAvailable();
        await application
          .get(StartResponseDeliveryProcessor)
          .processAvailable();
        await application.get(SequenceScheduler).processAvailable();
        await application.get(AuthorDelivery).processAvailable();
      }
    }

    for (const target of [bot, marketingBot]) {
      expect(target.messages.widgets).toEqual([]);
      expect(target.messages.answers).toEqual([]);
      expect(target.messages.texts).toEqual([]);
      expect(target.marketingMessages).toEqual([]);
    }
    expect(await openings()).toEqual(openingsBefore);
    expect(await plannedTexts()).toEqual(textsBefore);
  });
});

type Screen = readonly unknown[];
const screenOf = (data: string): Screen =>
  z.array(z.unknown()).parse(JSON.parse(data));

/** A press that waits its turn: two seconds apart, a person stays under the request limit. */
async function tap(userId: number, data: string): Promise<Screen> {
  // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
  vi.setSystemTime(Date.now() + 2000);
  await press(userId, data);
  const answer = bot.messages.answers.at(-1);
  if (!answer) throw new Error(`The bot did not answer the press ${data}`);
  return screenOf(answer.data);
}

interface AskedQuestion {
  readonly issueId: string;
  /** Identifier in the synthetic Bank, e.g. `q-t2-3`. */
  readonly questionId: string;
  readonly topicCode: string;
  /** The synthetic Bank marks the first option correct, or the first two when several are. */
  readonly correctMask: 1 | 3;
  readonly marks: unknown;
  readonly total: unknown;
}

/** Reads a question screen of the synthetic Bank. */
function asked(screen: Screen): AskedQuestion {
  expect(screen).toHaveLength(8);
  const [kind, issueId, topicName, text, options, several, marks, total] =
    screen;
  expect(kind).toBe("q");
  expect(options).toEqual(["Вариант А", "Вариант Б", "Вариант В", "Вариант Г"]);
  const topic = /^Синтетическая тема (\d+)$/.exec(String(topicName));
  const question = /^Синтетический вопрос (\d+) темы (t\d+)$/.exec(
    String(text),
  );
  if (!topic || !question || typeof issueId !== "string")
    throw new Error(`Not a synthetic question: ${JSON.stringify(screen)}`);
  expect(question[2]).toBe(`t${String(topic[1])}`);
  // Every third question of a synthetic topic has several correct options.
  const severalCorrect = Number(question[1]) % 3 === 0;
  expect(several).toBe(severalCorrect ? 1 : 0);
  return {
    issueId,
    questionId: `q-${String(question[2])}-${String(question[1])}`,
    topicCode: String(question[2]),
    correctMask: severalCorrect ? 3 : 1,
    marks,
    total,
  };
}

const right = (question: AskedQuestion) =>
  `a${question.issueId}:${String(question.correctMask)}`;
/** Option «Г» alone is wrong in every synthetic question. */
const wrong = (question: AskedQuestion) => `a${question.issueId}:8`;
const dontKnow = (question: AskedQuestion) => `a${question.issueId}:0`;

/**
 * Starts a round with the request `start` («Проверить себя» unless given) and answers every
 * question the way `answer` chooses.
 */
async function playRound(
  user: number,
  answer: (question: AskedQuestion, step: number) => string = right,
  start = "q",
): Promise<{ questions: AskedQuestion[]; result: Screen }> {
  const questions: AskedQuestion[] = [];
  let screen = await tap(user, start);
  while (screen[0] === "q") {
    const question = asked(screen);
    questions.push(question);
    const explanation = await tap(user, answer(question, questions.length));
    expect(explanation[0]).toBe("e");
    screen = await tap(user, "n");
  }
  return { questions, result: screen };
}

const ISSUE_CLOSED = ["x", "Этот вопрос уже закрыт. Начните новый раунд."];
const secondsIn = (seconds: number) =>
  new Date(fixedTestInstant() + seconds * 1000);

/** Topics t1…t5, each with the synthetic questions of these numbers; number 3 has two correct options. */
function bankOf(numbers: readonly number[]): SyntheticBank {
  const bank = syntheticTrainerBank({ topics: 5, questionsPerTopic: 0 });
  bank.questions = bank.topics.flatMap(({ code }) =>
    numbers.map((number) =>
      syntheticQuestion(code, number, number % 3 === 0 ? "multiple" : "single"),
    ),
  );
  return bank;
}

/** The answers the bot has stored for a person, in the order the questions were issued. */
function storedAnswers(user: number) {
  return database
    .selectFrom("trainer_issues as issue")
    .innerJoin("trainer_rounds as round", "round.id", "issue.round_id")
    .select([
      "round.mode",
      "round.topic_code",
      "issue.position",
      "issue.question_id",
      "issue.issued_at",
      "issue.answered_at",
      "issue.picked_mask",
      "issue.correct",
      "issue.first_answer",
    ])
    .where("issue.telegram_user_id", "=", String(user))
    .where("issue.answered_at", "is not", null)
    .orderBy("issue.id")
    .execute();
}

describe("«Проверить себя»", () => {
  it("asks 5 questions of different topics, one at a time, without the answers", async () => {
    const user = newUser();

    const { questions, result } = await playRound(user);

    expect(questions).toHaveLength(5);
    expect(new Set(questions.map((question) => question.topicCode)).size).toBe(
      5,
    );
    expect(questions.map((question) => question.marks)).toEqual([
      "",
      "1",
      "11",
      "111",
      "1111",
    ]);
    expect(questions.map((question) => question.total)).toEqual([
      5, 5, 5, 5, 5,
    ]);
    expect(result[0]).toBe("r");
    // A question screen names no correct option and carries no piece of an explanation.
    const sent = bot.messages.answers.map((answer) => answer.data);
    for (const data of sent.filter((text) => text.startsWith('["q"')))
      expect(data).not.toMatch(/азбор|correct|true|сточник/);
    // The round lives in answers to the person's presses: no message leaves the bot.
    expect(bot.messages.widgets).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
  });

  it("shows the verdict, the correct options and the explanation, and stores each answer with its times", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));

    const first = asked(await tap(user, "q"));
    vi.setSystemTime(fixedTestInstant() + 42_000);
    const afterRight = await tap(user, right(first));
    const second = asked(await tap(user, "n"));
    const afterWrong = await tap(user, wrong(second));
    const third = asked(await tap(user, "n"));
    const afterDontKnow = await tap(user, dontKnow(third));

    // Verdict, correct options, picked options, explanation, round steps, round size, no line.
    // The verdict 2 is a correct answer with a point: the first one, 42 seconds after the question.
    expect(afterRight).toEqual([
      "e",
      1,
      1,
      1,
      "Разбор А. Общий разбор.",
      "1",
      5,
      0,
    ]);
    expect(afterWrong).toEqual([
      "e",
      0,
      1,
      8,
      "Разбор Г. Общий разбор.",
      "10",
      5,
      0,
    ]);
    expect(afterDontKnow).toEqual(["e", 3, 1, 0, "Общий разбор.", "100", 5, 0]);
    expect([second.marks, third.marks]).toEqual(["1", "10"]);
    const check = { mode: "check", topic_code: null, first_answer: true };
    expect(await storedAnswers(user)).toEqual([
      {
        ...check,
        position: 1,
        question_id: first.questionId,
        issued_at: secondsIn(2),
        answered_at: secondsIn(44),
        picked_mask: 1,
        correct: true,
      },
      {
        ...check,
        position: 2,
        question_id: second.questionId,
        issued_at: secondsIn(46),
        answered_at: secondsIn(48),
        picked_mask: 8,
        correct: false,
      },
      {
        ...check,
        position: 3,
        question_id: third.questionId,
        issued_at: secondsIn(50),
        answered_at: secondsIn(52),
        picked_mask: 0,
        correct: false,
      },
    ]);
  });

  it("counts a question with several correct options only when exactly those are picked", async () => {
    const user = newUser();
    // Question 3 of every synthetic topic has two correct options, «А» and «Б».
    await loadBank(bankOf([3]));

    const first = asked(await tap(user, "q"));
    const exact = await tap(user, `a${first.issueId}:3`);
    const second = asked(await tap(user, "n"));
    const partial = await tap(user, `a${second.issueId}:1`);
    const third = asked(await tap(user, "n"));
    const extra = await tap(user, `a${third.issueId}:7`);

    expect(exact).toEqual([
      "e",
      1,
      3,
      3,
      "Разбор А. Разбор Б. Общий разбор.",
      "1",
      5,
      0,
    ]);
    expect(partial).toEqual([
      "e",
      0,
      3,
      1,
      "Разбор А. Общий разбор.",
      "10",
      5,
      0,
    ]);
    expect(extra).toEqual([
      "e",
      0,
      3,
      7,
      "Разбор А. Разбор Б. Разбор В. Общий разбор.",
      "100",
      5,
      0,
    ]);
  });

  it.each([
    [5, "Все ответы верные."],
    [3, "Хороший результат. Разборы помогут закрыть пробелы."],
    [1, "Есть что повторить. Попробуйте ещё раунд."],
  ])(
    "ends with the result %i of 5 and offers another round or the home screen",
    async (correct, comment) => {
      const user = newUser();

      const { result } = await playRound(user, (question, step) =>
        step <= correct ? right(question) : dontKnow(question),
      );

      // Title, correct, total, comment, then a point for every correct answer and a Series
      // of one day; the week place is not counted yet.
      expect(result).toEqual([
        "r",
        "Проверить себя",
        correct,
        5,
        comment,
        correct,
        1,
        0,
        0,
      ]);
      // The result screen is measured with a comment of at most 60 characters.
      expect(comment.length).toBeLessThanOrEqual(60);
      // A repeated request after a lost answer draws the same result.
      expect(await tap(user, "n")).toEqual(result);
      // «На главный» and «Ещё раунд».
      expect(await tap(user, "h")).toEqual(["h", 1, 5, 5, 0]);
      const again = asked(await tap(user, "q"));
      expect([again.marks, again.total]).toEqual(["", 5]);
    },
  );

  it("keeps the answers of a round closed in the middle", async () => {
    const user = newUser();
    const first = asked(await tap(user, "q"));
    await tap(user, right(first));
    const second = asked(await tap(user, "n"));
    await tap(user, wrong(second));
    asked(await tap(user, "n"));

    // The person closes the round on the third question. Answers stay stored without credit.
    expect(await tap(user, "h")).toEqual(["h", 0, 0, 5, 0]);
    const { questions } = await playRound(user);

    expect(questions.map((question) => question.marks)).toEqual([
      "",
      "1",
      "11",
      "111",
      "1111",
    ]);
    const stored = await storedAnswers(user);
    expect(stored).toHaveLength(7);
    expect(stored.slice(0, 2)).toMatchObject([
      {
        position: 1,
        question_id: first.questionId,
        picked_mask: first.correctMask,
        correct: true,
      },
      {
        position: 2,
        question_id: second.questionId,
        picked_mask: 8,
        correct: false,
      },
    ]);
  });

  it("returns home on a request for the next step from a person who has answered nothing", async () => {
    expect(await tap(newUser(), "n")).toEqual(JSON.parse(EMPTY_HOME));
  });
});

/** Six topics of 3 questions; `code` gets the synthetic questions 1…`count` instead. */
function bankWithTopicOf(code: string, count: number): SyntheticBank {
  const bank = syntheticTrainerBank({ topics: 6, questionsPerTopic: 3 });
  bank.questions = [
    ...bank.questions.filter((question) => question.topic !== code),
    ...Array.from({ length: count }, (_, index) =>
      syntheticQuestion(
        code,
        index + 1,
        (index + 1) % 3 === 0 ? "multiple" : "single",
      ),
    ),
  ];
  return bank;
}

/** The owner can reach every topic through the bot's pages. */
async function allTopics(user: number) {
  const first = await tap(user, "t");
  const rows = [...z.array(z.unknown()).parse(first[1])];
  for (let page = 1; page < Number(first[3] ?? 1); page += 1) {
    const screen = await tap(user, `t:${String(page)}`);
    rows.push(...z.array(z.unknown()).parse(screen[1]));
  }
  return ["t", rows];
}

describe("«Тренировка по теме»", () => {
  it("lists every topic of the Bank under the Bank's name with 0 answered questions for a new person", async () => {
    const bank = bankWithTopicOf("t2", 12);
    bank.topics = bank.topics.map((topic, index) => ({
      ...topic,
      name: `Название из Банка ${String(index + 1)}`,
    }));
    await loadBank(bank);

    expect(await allTopics(newUser())).toEqual([
      "t",
      [
        ["t1", "Название из Банка 1", 0, 3],
        ["t2", "Название из Банка 2", 0, 12],
        ["t3", "Название из Банка 3", 0, 3],
        ["t4", "Название из Банка 4", 0, 3],
        ["t5", "Название из Банка 5", 0, 3],
        ["t6", "Название из Банка 6", 0, 3],
      ],
    ]);
    expect(bot.messages.widgets).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
  });

  it("counts for each topic the questions this person answered, whatever the answer and the mode", async () => {
    const user = newUser();
    const other = newUser();
    // One question of each of five topics: correct, wrong, «Не знаю», correct, wrong.
    const check = await playRound(user, (question, step) =>
      step % 3 === 1
        ? right(question)
        : step % 3 === 2
          ? wrong(question)
          : dontKnow(question),
    );
    const topic = await playRound(user, right, "tt1");

    const answered = new Map<string, Set<string>>();
    for (const { topicCode, questionId } of [
      ...check.questions,
      ...topic.questions,
    ])
      answered.set(
        topicCode,
        (answered.get(topicCode) ?? new Set()).add(questionId),
      );
    expect(await allTopics(user)).toEqual([
      "t",
      ["t1", "t2", "t3", "t4", "t5", "t6"].map((code, index) => [
        code,
        `Синтетическая тема ${String(index + 1)}`,
        answered.get(code)?.size ?? 0,
        3,
      ]),
    ]);
    // The check round took one question in 5 of 6 topics and the topic round finished t1.
    expect(answered.get("t1")?.size).toBe(3);
    expect(answered.size).toBeGreaterThanOrEqual(5);
    // Another person's answers do not count.
    expect(await allTopics(other)).toEqual([
      "t",
      ["t1", "t2", "t3", "t4", "t5", "t6"].map((code, index) => [
        code,
        `Синтетическая тема ${String(index + 1)}`,
        0,
        3,
      ]),
    ]);
  });

  it("does not count a question shown but not answered", async () => {
    const user = newUser();
    asked(await tap(user, "tt3"));

    const [, topics] = await tap(user, "t");

    expect(topics).toContainEqual(["t3", "Синтетическая тема 3", 0, 3]);
  });

  it("counts only questions the Bank still shows and drops a topic the Bank dropped", async () => {
    const user = newUser();
    await playRound(user, right, "tt1");
    await playRound(user, right, "tt6");
    // The next import keeps questions 2 and 4 in topics t1…t5 and drops topic t6.
    await loadBank(bankOf([2, 4]));

    expect(await allTopics(user)).toEqual([
      "t",
      [
        ["t1", "Синтетическая тема 1", 1, 2],
        ["t2", "Синтетическая тема 2", 0, 2],
        ["t3", "Синтетическая тема 3", 0, 2],
        ["t4", "Синтетическая тема 4", 0, 2],
        ["t5", "Синтетическая тема 5", 0, 2],
      ],
    ]);
  });

  it("asks 10 questions of the chosen topic and names the topic in the result", async () => {
    const user = newUser();
    await loadBank(bankWithTopicOf("t2", 12));

    const { questions, result } = await playRound(
      user,
      (question, step) => (step <= 7 ? right(question) : wrong(question)),
      "tt2",
    );

    expect(questions).toHaveLength(10);
    expect(new Set(questions.map((question) => question.questionId)).size).toBe(
      10,
    );
    expect(questions.map((question) => question.topicCode)).toEqual(
      Array.from({ length: 10 }, () => "t2"),
    );
    expect(questions.map((question) => question.total)).toEqual(
      Array.from({ length: 10 }, () => 10),
    );
    expect(questions.at(-1)?.marks).toBe("111111100");
    // The title is the topic, 7 of 10, a point for each of the 7 correct first answers, a
    // Series of one day, no week place, and the last flag offers «Другая тема».
    expect(result).toEqual([
      "r",
      "Синтетическая тема 2",
      7,
      10,
      "Хороший результат. Разборы помогут закрыть пробелы.",
      7,
      1,
      0,
      1,
    ]);
    expect(await storedAnswers(user)).toHaveLength(10);
    expect(
      (await storedAnswers(user)).map(({ mode, topic_code }) => [
        mode,
        topic_code,
      ]),
    ).toEqual(Array.from({ length: 10 }, () => ["topic", "t2"]));
    const [, topics] = await tap(user, "t");
    expect(topics).toContainEqual(["t2", "Синтетическая тема 2", 10, 12]);
    expect(bot.messages.widgets).toEqual([]);
    expect(bot.messages.texts).toEqual([]);
  });

  it("asks a shorter round when the topic has fewer than 10 questions", async () => {
    const user = newUser();

    const { questions, result } = await playRound(user, right, "tt4");

    expect(questions.map((question) => question.questionId).sort()).toEqual([
      "q-t4-1",
      "q-t4-2",
      "q-t4-3",
    ]);
    expect(questions.map((question) => question.total)).toEqual([3, 3, 3]);
    expect(result).toEqual([
      "r",
      "Синтетическая тема 4",
      3,
      3,
      "Все ответы верные.",
      3,
      1,
      0,
      1,
    ]);
  });

  it("asks the unseen questions of the topic first, then the ones answered wrong, and rests the correct ones", async () => {
    const user = newUser();
    await loadBank(bankWithTopicOf("t2", 12));
    // Of the first 10 questions the person answers steps 1…7 correctly and 8…10 wrong.
    const first = await playRound(
      user,
      (question, step) => (step <= 7 ? right(question) : wrong(question)),
      "tt2",
    );
    const seen = first.questions.map((question) => question.questionId);

    const second = await playRound(user, right, "tt2");

    const again = second.questions.map((question) => question.questionId);
    expect(again).toHaveLength(5);
    expect(again.slice(0, 2).every((id) => !seen.includes(id))).toBe(true);
    expect(again.slice(2).sort()).toEqual(seen.slice(7).sort());
    // Every question of the topic is now answered correctly and rests for 30 days.
    expect(await tap(user, "tt2")).toEqual([
      "i",
      "Вы верно ответили на все вопросы. Они вернутся через 30 дней после ответа.",
    ]);
  });

  it.each(["tnone", "tt6"])(
    "answers the request %s for a topic the Bank does not show with the current topic list and starts no round",
    async (data) => {
      const user = newUser();
      // The import drops topic t6; `none` never was a topic.
      await loadBank(bankOf([1, 2, 3]));

      const screen = await tap(user, data);

      expect(screen).toEqual([
        "t",
        ["t1", "t2", "t3"].map((code, index) => [
          code,
          `Синтетическая тема ${String(index + 1)}`,
          0,
          3,
        ]),
        0,
        2,
      ]);
      const rounds = await database
        .selectFrom("trainer_rounds")
        .select("id")
        .execute();
      expect(rounds).toEqual([]);
    },
  );
});

describe("the choice of questions", () => {
  it("asks questions the person has not seen before the ones answered wrong", async () => {
    const user = newUser();
    await loadBank(bankOf([1, 2]));

    const first = await playRound(user, wrong);
    const second = await playRound(user, wrong);
    const third = await playRound(user, wrong);

    const ids = (round: { questions: AskedQuestion[] }) =>
      round.questions.map((question) => question.questionId);
    // Ten questions in five topics: the second round is exactly the five not seen yet.
    expect([...ids(first), ...ids(second)].sort()).toEqual(
      ["t1", "t2", "t3", "t4", "t5"]
        .flatMap((topic) => [`q-${topic}-1`, `q-${topic}-2`])
        .sort(),
    );
    for (const round of [first, second, third]) {
      expect(round.questions).toHaveLength(5);
      expect(
        new Set(round.questions.map((question) => question.topicCode)).size,
      ).toBe(5);
    }
  });

  it("does not ask a correctly answered question again for 30 days", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));
    const ids = (round: { questions: AskedQuestion[] }) =>
      round.questions.map((question) => question.questionId).sort();

    const first = await playRound(user, (question, step) =>
      step <= 3 ? right(question) : wrong(question),
    );
    // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
    const lastCorrectAnswerAt = Date.now();
    const known = ids({ questions: first.questions.slice(0, 3) });
    const unknown = ids({ questions: first.questions.slice(3) });

    const sameDay = await playRound(user, wrong);
    vi.setSystemTime(lastCorrectAnswerAt + 30 * ONE_DAY_MS - 60_000);
    const beforeThirtyDays = await playRound(user, wrong);
    vi.setSystemTime(lastCorrectAnswerAt + 30 * ONE_DAY_MS + 60_000);
    const afterThirtyDays = await playRound(user);

    expect(ids(sameDay)).toEqual(unknown);
    expect(sameDay.questions.map((question) => question.total)).toEqual([2, 2]);
    expect(sameDay.result.slice(0, 4)).toEqual(["r", "Проверить себя", 0, 2]);
    expect(ids(beforeThirtyDays)).toEqual(unknown);
    // The questions answered wrong come before the ones whose rest has ended.
    expect(ids(afterThirtyDays)).toEqual([...known, ...unknown].sort());
    expect(ids({ questions: afterThirtyDays.questions.slice(0, 2) })).toEqual(
      unknown,
    );
    // Everything is answered correctly now, so there is nothing to ask.
    expect(await tap(user, "q")).toEqual([
      "i",
      "Вы верно ответили на все вопросы. Они вернутся через 30 дней после ответа.",
    ]);
  });

  it("asks only questions the Bank still shows", async () => {
    const user = newUser();
    // The Bank had 18 questions; the next import keeps one question in each of five topics.
    await loadBank(bankOf([2]));

    const { questions } = await playRound(user);

    expect(questions.map((question) => question.questionId).sort()).toEqual([
      "q-t1-2",
      "q-t2-2",
      "q-t3-2",
      "q-t4-2",
      "q-t5-2",
    ]);
  });

  it("says that questions are coming when the Bank is empty", async () => {
    await sql`truncate table trainer_questions, trainer_topics cascade`.execute(
      database,
    );

    expect(await tap(newUser(), "q")).toEqual(["i", "Вопросы скоро появятся."]);
  });
});

describe("a request the bot does not trust", () => {
  it("refuses an answer to a question issued to another person", async () => {
    const owner = newUser();
    const stranger = newUser();
    const question = asked(await tap(owner, "q"));

    expect(await tap(stranger, right(question))).toEqual(ISSUE_CLOSED);

    expect(await storedAnswers(stranger)).toEqual([]);
    expect(await storedAnswers(owner)).toEqual([]);
    // The owner's question is still open.
    expect((await tap(owner, right(question)))[0]).toBe("e");
  });

  it("refuses an answer to a question of the round that was not shown yet", async () => {
    const user = newUser();
    const first = asked(await tap(user, "q"));
    // Issues of one round are numbered in a row, so the widget could guess the next one.
    const next = (parseInt(first.issueId, 36) + 1).toString(36);

    expect(await tap(user, `a${next}:1`)).toEqual(ISSUE_CLOSED);

    expect(await storedAnswers(user)).toEqual([]);
  });

  it.each(["azzzz:1", `a${"z".repeat(16)}:1`, "a0:0"])(
    "refuses the answer %s to a question that does not exist",
    async (data) => {
      const user = newUser();
      asked(await tap(user, "q"));

      expect(await tap(user, data)).toEqual(ISSUE_CLOSED);

      expect(await storedAnswers(user)).toEqual([]);
    },
  );

  it("refuses two options for a question with one correct option and stores nothing", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));
    const question = asked(await tap(user, "q"));

    expect(await tap(user, `a${question.issueId}:3`)).toEqual(ISSUE_CLOSED);

    expect(await storedAnswers(user)).toEqual([]);
    expect(await tap(user, right(question))).toEqual([
      "e",
      1,
      1,
      1,
      "Разбор А. Общий разбор.",
      "1",
      5,
      0,
    ]);
  });

  it("refuses an option the question does not have", async () => {
    const user = newUser();
    const bank = bankOf([1]);
    for (const question of bank.questions)
      question.options = question.options.slice(0, 2);
    await loadBank(bank);
    const screen = await tap(user, "q");
    expect(screen[4]).toEqual(["Вариант А", "Вариант Б"]);
    const issueId = String(screen[1]);

    // «В» is the third option; the question has two.
    expect(await tap(user, `a${issueId}:4`)).toEqual(ISSUE_CLOSED);

    expect(await storedAnswers(user)).toEqual([]);
    expect(await tap(user, `a${issueId}:2`)).toEqual([
      "e",
      0,
      1,
      2,
      "Разбор Б. Общий разбор.",
      "0",
      5,
      0,
    ]);
  });

  it("keeps the first answer when a second one comes for the same question", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));
    const question = asked(await tap(user, "q"));
    const first = await tap(user, wrong(question));

    const second = await tap(user, right(question));

    // The widget gets the explanation of the stored answer, not of the new one.
    expect(first).toEqual(["e", 0, 1, 8, "Разбор Г. Общий разбор.", "0", 5, 0]);
    expect(second).toEqual(first);
    expect(await storedAnswers(user)).toMatchObject([
      {
        position: 1,
        picked_mask: 8,
        correct: false,
        answered_at: secondsIn(4),
      },
    ]);
  });

  it("answers a press over the request limit with a retry-later screen and accepts the same answer later", async () => {
    const user = newUser();
    const question = asked(await tap(user, "q"));
    // Nine more presses at the same instant use up the limit of 10 requests in 10 seconds.
    for (let index = 0; index < 9; index += 1) await press(user, "h");

    await press(user, right(question));

    expect(bot.messages.answers.at(-1)?.data).toBe(TOO_OFTEN);
    expect(await storedAnswers(user)).toEqual([]);
    vi.setSystemTime(fixedTestInstant() + 20_000);
    expect((await tap(user, right(question)))[0]).toBe("e");
    expect(await storedAnswers(user)).toHaveLength(1);
  });
});

describe("a press the inbox runs twice", () => {
  /** Telegram did not take the answer, so the inbox runs the same update again later. */
  async function rerun(): Promise<Screen> {
    // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
    vi.setSystemTime(Date.now() + 60_000);
    await bot.application.get(TelegramUpdateProcessor).processAvailable();
    const answer = bot.messages.answers.at(-1);
    if (!answer) throw new Error("The bot did not answer the repeated press");
    return screenOf(answer.data);
  }

  it("starts one round and shows the same question", async () => {
    const user = newUser();
    bot.messages.answerFailures.push(new Error("Synthetic lost answer"));

    const first = asked(await tap(user, "q"));
    const repeated = asked(await rerun());

    expect(bot.messages.answers).toHaveLength(2);
    expect(repeated).toEqual(first);
    const rounds = await database
      .selectFrom("trainer_rounds")
      .select(["mode", "size", "started_at"])
      .execute();
    expect(rounds).toEqual([
      { mode: "check", size: 5, started_at: secondsIn(2) },
    ]);
    // The question keeps the time it was first shown at.
    await tap(user, right(repeated));
    expect(await storedAnswers(user)).toMatchObject([
      { position: 1, issued_at: secondsIn(2) },
    ]);
  });

  it("stores one answer and repeats its explanation", async () => {
    const user = newUser();
    const question = asked(await tap(user, "q"));
    bot.messages.answerFailures.push(new Error("Synthetic lost answer"));

    const first = await tap(user, right(question));
    const repeated = await rerun();

    expect(first[0]).toBe("e");
    expect(repeated).toEqual(first);
    expect(await storedAnswers(user)).toMatchObject([
      {
        position: 1,
        picked_mask: question.correctMask,
        correct: true,
        first_answer: true,
        answered_at: secondsIn(4),
      },
    ]);
  });
});

describe("a Bank import between answers", () => {
  it("keeps earlier answers when the same questions are imported again with new texts", async () => {
    const user = newUser();
    await loadBank(bankOf([1, 2]));
    const first = asked(await tap(user, "q"));
    await tap(user, right(first));
    const second = asked(await tap(user, "n"));
    await tap(user, wrong(second));
    const before = await storedAnswers(user);

    const corrected = bankOf([1, 2]);
    for (const question of corrected.questions)
      question.explanation = "Исправленный общий разбор.";
    await loadBank(corrected);

    expect(before).toHaveLength(2);
    expect(await storedAnswers(user)).toEqual(before);
    // The history still steers the choice: the correctly answered question does not return,
    // and new answers get the corrected text.
    const third = asked(await tap(user, "n"));
    expect(await tap(user, right(third))).toEqual([
      "e",
      1,
      1,
      1,
      "Разбор А. Исправленный общий разбор.",
      "101",
      5,
      0,
    ]);
    const later = [await playRound(user, wrong), await playRound(user, wrong)];
    const asks = later.flatMap((round) =>
      round.questions.map((question) => question.questionId),
    );
    // The first round is unfinished: its stored answers do not suppress later questions.
    expect(asks).toHaveLength(10);
    expect(await storedAnswers(user)).toHaveLength(13);
  });

  it("keeps the answers to a question the import withdrew", async () => {
    const user = newUser();
    await loadBank(bankOf([1, 2]));
    const { questions } = await playRound(user);
    const before = await storedAnswers(user);

    // The next file has none of the questions the person answered.
    const others = bankOf([1, 2]);
    const answered = new Set(questions.map((question) => question.questionId));
    others.questions = others.questions.filter(({ id }) => !answered.has(id));
    await loadBank(others);

    expect(before).toHaveLength(5);
    expect(await storedAnswers(user)).toEqual(before);
    const next = await playRound(user);
    expect(
      next.questions.filter((question) => answered.has(question.questionId)),
    ).toEqual([]);
  });

  it("judges an answer against the question as the person saw it", async () => {
    const user = newUser();
    await loadBank(bankOf([1]));
    const first = asked(await tap(user, "q"));

    // The author moves the correct option from «А» to «Б» while the first question is open.
    const corrected = bankOf([1]);
    for (const { options } of corrected.questions)
      options.forEach((option, index) => {
        option.correct = index === 1;
      });
    await loadBank(corrected);
    const afterFirst = await tap(user, `a${first.issueId}:1`);
    const second = asked(await tap(user, "n"));
    const afterSecond = await tap(user, `a${second.issueId}:1`);

    // The first question was shown before the import, the second after it.
    expect(afterFirst.slice(0, 4)).toEqual(["e", 1, 1, 1]);
    expect(afterSecond.slice(0, 4)).toEqual(["e", 0, 2, 1]);
  });
});
