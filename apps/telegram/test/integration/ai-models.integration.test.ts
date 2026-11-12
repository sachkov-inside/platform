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
import { AI_MODELS_WIDGET_HTML } from "../../src/modules/ai-models/widget/ai-models-widget-html.generated.js";
import { StartResponseDeliveryProcessor } from "../../src/modules/outbound/start-response-delivery-processor.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import {
  fixedTestInstant,
  registerFixedClock,
  virtualTestClock,
} from "../support/fixed-clock.js";
import {
  privateStartUpdate,
  widgetQueryUpdate,
} from "../support/synthetic-telegram-updates.js";
import {
  newUpdateId,
  newUser,
  startTrainerBot,
  type TrainerBot,
} from "../support/trainer-bot.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

/** The first page of «Мощные» without its rows: the widget asks the bot for it. */
const FIRST_PAGE = '["l","p",0]';
const COMING_SOON = "Раздел «ИИ-модели» скоро откроется.";
const UPDATE_TELEGRAM =
  "Раздел «ИИ-модели» не открылся. Обновите Telegram до последней версии и отправьте /models ещё раз.";
const COMING_SOON_SCREEN = '["x","Скоро здесь будет список моделей"]';
const TOO_OFTEN = '["x","Слишком часто. Повторите через несколько секунд."]';
// The empty Trainer home: no Series, 0 of 5 for the Daily goal, the Daily question not answered.
const TRAINER_EMPTY_HOME = '["h",0,0,5,0]';

const database: Database = createDatabase(databaseUrl);
let bot: TrainerBot | undefined;

beforeAll(async () => {
  await migrateToLatest(database);
  bot = await startTrainerBot(databaseUrl);
});

afterAll(async () => {
  try {
    await closeIfStarted(bot?.application);
  } finally {
    await database.destroy();
  }
});

beforeEach(async () => {
  await sql`
    truncate table
      ai_models_card_views,
      ai_models_references,
      ai_models_openings,
      start_response_delivery_attempts,
      start_response_deliveries,
      bot_contact_events,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
  running().messages.reset();
});

function running(): TrainerBot {
  if (!bot) throw new Error("The bot did not start");
  return bot;
}

/** Stands in for the owner's import, which comes with its own command. */
async function loadReference(): Promise<void> {
  await database
    .insertInto("ai_models_references")
    .values({
      revision: 1,
      checked_on: "2026-11-12",
      facts: JSON.stringify({ models: [] }),
      author: JSON.stringify({ groups: [] }),
      content_sha256: "a".repeat(64),
      imported_at: virtualTestClock.now(),
    })
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

function openings() {
  return database
    .selectFrom("ai_models_openings")
    .select(["telegram_user_id", "entry", "source_code", "delivery"])
    .orderBy("update_id")
    .execute();
}

describe("opening ИИ-модели", () => {
  beforeEach(loadReference);

  it("sends one widget on /models and records the opening", async () => {
    const user = newUser();

    await running().say(user, "/models");

    expect(running().messages.widgets).toEqual([
      {
        chatId: String(user),
        html: AI_MODELS_WIDGET_HTML,
        chatData: FIRST_PAGE,
        height: 0,
      },
    ]);
    expect(running().messages.texts).toEqual([]);
    expect(await openings()).toEqual([
      {
        telegram_user_id: String(user),
        entry: "command",
        source_code: null,
        delivery: "delivered",
      },
    ]);
  });

  it.each([
    ["the command with the bot's name", "/models@inside_bot", "command"],
    ["the «ИИ-модели» menu text", "ИИ-модели", "menu"],
    ["a section link", "/start models", "link"],
  ])("sends one widget on %s", async (_name, text, entry) => {
    const user = newUser();

    await running().say(user, text);

    expect(running().messages.widgets).toMatchObject([
      { chatId: String(user), html: AI_MODELS_WIDGET_HTML },
    ]);
    expect(await openings()).toEqual([
      {
        telegram_user_id: String(user),
        entry,
        source_code: null,
        delivery: "delivered",
      },
    ]);
  });

  it("opens from the menu button and stops its spinner", async () => {
    const user = newUser();
    const updateId = newUpdateId();

    await running().receive({
      update_id: updateId,
      callback_query: {
        id: `ai-models-menu-${String(updateId)}`,
        data: "ai-models:open",
        from: { id: user, is_bot: false, first_name: "Synthetic" },
        message: { message_id: 1, chat: { id: user, type: "private" } },
      },
    });

    expect(running().messages.widgets).toHaveLength(1);
    expect(running().messages.callbackAnswers).toEqual([
      `ai-models-menu-${String(updateId)}`,
    ]);
    expect(await openings()).toMatchObject([
      { entry: "menu", delivery: "delivered" },
    ]);
  });

  it("records the label of each link, and none for a label outside the alphabet", async () => {
    const user = newUser();

    await running().say(user, "/start models_autumn-mail");
    await running().say(user, `/start models_${"L".repeat(35)}`);
    await running().say(user, "/start models_осень");
    await running().say(user, "/start models_");

    expect(running().messages.widgets).toHaveLength(4);
    expect(
      (await openings()).map(({ entry, source_code }) => [entry, source_code]),
    ).toEqual([
      ["link", "autumn-mail"],
      ["link", "L".repeat(35)],
      ["link", null],
      ["link", null],
    ]);
  });

  it("ignores a section marker forged inside an ordinary /start", async () => {
    const user = newUser();

    await running().receive({
      update_id: newUpdateId(),
      message: {
        chat: { id: user, type: "private" },
        from: { id: user, is_bot: false },
        message_id: 1,
        text: "/start",
        _inside_ai_models: { source: "forged" },
      },
    });

    expect(running().messages.widgets).toEqual([]);
    expect(await openings()).toEqual([]);
  });

  it.each([
    ["/models in a group", { text: "/models", chatType: "supergroup" }],
    ["«ИИ-модели» in a group", { text: "ИИ-модели", chatType: "group" }],
    ["a section link in a group", { text: "/start models", chatType: "group" }],
    ["/models from a bot", { text: "/models", isBot: true }],
  ])("sends nothing on %s", async (_name, options) => {
    await running().receive(
      privateStartUpdate(newUpdateId(), newUser(), options),
    );

    expect(running().messages.widgets).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toEqual([]);
  });

  it("sends one widget when Telegram repeats the same update", async () => {
    const update = privateStartUpdate(newUpdateId(), newUser(), {
      text: "/models",
    });

    await running().receive(update);
    await running().receive(update);

    expect(running().messages.widgets).toHaveLength(1);
    expect(await openings()).toHaveLength(1);
  });
});

describe("before the Справочник is loaded", () => {
  it("answers with one text, sends no widget and records the opening", async () => {
    const user = newUser();
    const update = privateStartUpdate(newUpdateId(), user, {
      text: "/models",
    });

    await running().receive(update);
    await running().receive(update);

    expect(running().messages.widgets).toEqual([]);
    expect(await plannedTexts()).toEqual([COMING_SOON]);
    expect(await openings()).toEqual([
      {
        telegram_user_id: String(user),
        entry: "command",
        source_code: null,
        delivery: "no_reference",
      },
    ]);

    await running()
      .application.get(StartResponseDeliveryProcessor)
      .processAvailable();
    expect(running().messages.texts).toEqual([
      { chatId: String(user), text: COMING_SOON },
    ]);
  });
});

describe("a widget Telegram does not deliver", () => {
  beforeEach(loadReference);

  it("asks to update Telegram with one text when Telegram rejects the widget", async () => {
    const user = newUser();
    running().messages.widgetResults.push({
      kind: "api_rejected",
      providerErrorCode: 400,
    });

    await running().say(user, "/models");

    expect(running().messages.widgets).toHaveLength(1);
    expect(await plannedTexts()).toEqual([UPDATE_TELEGRAM]);
    expect(await openings()).toMatchObject([{ delivery: "rejected" }]);

    await running()
      .application.get(StartResponseDeliveryProcessor)
      .processAvailable();
    expect(running().messages.texts).toEqual([
      { chatId: String(user), text: UPDATE_TELEGRAM },
    ]);
  });

  it("sends the widget again after Telegram asked to retry later", async () => {
    running().messages.widgetResults.push({
      kind: "api_retryable",
      providerErrorCode: 429,
      retryAfterSeconds: 1,
    });

    await running().say(newUser(), "/models");
    expect(await openings()).toMatchObject([{ delivery: "retry" }]);

    // The inbox offers the failed update again after its backoff.
    vi.setSystemTime(fixedTestInstant() + 60_000);
    await running().application.get(TelegramUpdateProcessor).processAvailable();

    expect(running().messages.widgets).toHaveLength(2);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toMatchObject([{ delivery: "delivered" }]);
  });

  it("never sends a second widget for one request whose delivery is unknown", async () => {
    running().messages.widgetResults.push({ kind: "transport_unknown" });

    await running().say(newUser(), "/models");
    vi.setSystemTime(fixedTestInstant() + 60_000);
    await running().application.get(TelegramUpdateProcessor).processAvailable();

    expect(running().messages.widgets).toHaveLength(1);
    expect(await plannedTexts()).toEqual([]);
    expect(await openings()).toMatchObject([{ delivery: "unknown" }]);
  });
});

describe("a press inside a widget", () => {
  const answered = () =>
    running().messages.answers.map((answer) => answer.data);

  it("answers a request marked 3 from ИИ-модели and sends no message", async () => {
    const update = widgetQueryUpdate(newUpdateId(), newUser(), "3lp0");

    await running().receive(update);

    expect(running().messages.answers).toEqual([
      { queryId: update.widget_query.id, data: COMING_SOON_SCREEN },
    ]);
    expect(running().messages.widgets).toEqual([]);
    expect(await plannedTexts()).toEqual([]);
  });

  it.each([
    ["an unmarked request of an older Trainer message", "h"],
    ["a request of the current Trainer widget", "2h"],
  ])("leaves %s to the Trainer", async (_name, data) => {
    await running().receive(widgetQueryUpdate(newUpdateId(), newUser(), data));

    expect(answered()).toEqual([TRAINER_EMPTY_HOME]);
  });

  it("refuses ИИ-модели presses over the per-user limit in that widget, with no chat text", async () => {
    const user = newUser();
    const other = newUser();

    // The limit is 10 requests of one person in 10 seconds; all presses share one instant.
    for (let index = 0; index < 11; index += 1)
      await running().receive(widgetQueryUpdate(newUpdateId(), user, "3lp0"));
    await running().receive(widgetQueryUpdate(newUpdateId(), user, "2h"));
    await running().receive(widgetQueryUpdate(newUpdateId(), other, "3lp0"));

    expect(answered()).toEqual([
      ...Array.from({ length: 10 }, () => COMING_SOON_SCREEN),
      TOO_OFTEN,
      TOO_OFTEN,
      COMING_SOON_SCREEN,
    ]);
    expect(await plannedTexts()).toEqual([]);
    expect(running().messages.texts).toEqual([]);
  });
});
