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
import { TRAINER_WIDGET_HTML } from "../../src/modules/trainer/widget/trainer-widget-html.generated.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
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

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const WEBHOOK_SECRET = "synthetic_secret";
// The empty home screen: no Series, 0 of 5 for the Daily goal, the Daily question not answered.
const EMPTY_HOME = '["h",0,0,5,0]';
const CAPTION =
  "Тренажёр Inside. Если вместо него пустое сообщение, обновите Telegram.";
const UPDATE_TELEGRAM =
  "Тренажёр не открылся. Обновите Telegram до последней версии и отправьте /train ещё раз.";
const NOT_OPEN_YET = '["x","Этот раздел скоро откроется."]';
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
    return Promise.resolve();
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
});

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
        caption: CAPTION,
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

  it.each(["q", "d", "t", "tabc", "p", "l0", "l1", "v11", "n", "aq1:3"])(
    "answers the request %s with a screen that the section is not open yet",
    async (data) => {
      await press(newUser(), data);

      expect(bot.messages.answers.map((answer) => answer.data)).toEqual([
        NOT_OPEN_YET,
      ]);
    },
  );

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
