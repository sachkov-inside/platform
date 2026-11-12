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

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { AiModelsReferences } from "../../src/modules/ai-models/ai-models-reference.js";
import { AI_MODELS_CODE_PATTERN } from "../../src/modules/ai-models/widget/ai-models-widget-request.js";
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
  syntheticAiModelsReference,
  type SyntheticAiModelsReference,
} from "../support/synthetic-ai-models-reference.js";
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

const NBSP = "\u00a0";
/** The first page of «Мощные» of the synthetic Справочник, as the wire tests spell it out. */
const FIRST_PAGE = [
  "l",
  "p",
  0,
  2,
  "12.11",
  [
    "atlas-pro|Atlas 3 Pro|5|1|wb|||самая сильная в примере, но дорогая",
    "boreal-2|Boreal 2|5|1|fc|||сильная и недорогая",
    "atlas-mini|Atlas 3 Mini|5|0|fb|||почти как Pro, но дешевле",
    "gale|Gale 4|5|0||||неплохая и дешёвая",
    "cirrus-7|Cirrus 7|4|0|fp|||средняя по силе, есть в подписке от $6",
    "delta|Delta 1|3|0|fm|||очень дешёвая, для простых задач",
    "echo|Echo 5 Flash|2|0||||дешёвая, только по API",
  ],
];
const COMING_SOON = "Раздел «ИИ-модели» скоро откроется.";
const UPDATE_TELEGRAM =
  "Раздел «ИИ-модели» не открылся. Обновите Telegram до последней версии и отправьте /models ещё раз.";
const STALE =
  "Список моделей обновился. Отправьте /models, чтобы открыть новый.";
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

/** The owner's import makes this synthetic file the current Справочник. */
async function loadReference(
  file: SyntheticAiModelsReference = syntheticAiModelsReference(),
): Promise<void> {
  const report = await new AiModelsReferences(
    database,
    virtualTestClock,
  ).import(file, true);
  expect(report.status).toBe("imported");
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
  beforeEach(() => loadReference());

  it("sends one widget on /models and records the opening", async () => {
    const user = newUser();

    await running().say(user, "/models");

    expect(running().messages.widgets).toEqual([
      {
        chatId: String(user),
        html: AI_MODELS_WIDGET_HTML,
        chatData: JSON.stringify(FIRST_PAGE),
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
  beforeEach(() => loadReference());

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
    await loadReference();
    const update = widgetQueryUpdate(newUpdateId(), newUser(), "3lp0");

    await running().receive(update);

    expect(running().messages.answers).toEqual([
      { queryId: update.widget_query.id, data: JSON.stringify(FIRST_PAGE) },
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
    await loadReference();
    const user = newUser();
    const other = newUser();
    const page = JSON.stringify(FIRST_PAGE);

    // The limit is 10 requests of one person in 10 seconds; all presses share one instant.
    for (let index = 0; index < 11; index += 1)
      await running().receive(widgetQueryUpdate(newUpdateId(), user, "3lp0"));
    await running().receive(widgetQueryUpdate(newUpdateId(), user, "2h"));
    await running().receive(widgetQueryUpdate(newUpdateId(), other, "3lp0"));

    expect(answered()).toEqual([
      ...Array.from({ length: 10 }, () => page),
      TOO_OFTEN,
      TOO_OFTEN,
      page,
    ]);
    expect(await plannedTexts()).toEqual([]);
    expect(running().messages.texts).toEqual([]);
  });

  it("says the section opens soon while no Справочник is loaded", async () => {
    expect(await running().tap(newUser(), "3lp0")).toEqual(["x", COMING_SOON]);
  });
});

describe("screens of the widget", () => {
  beforeEach(() => loadReference());

  /** The model codes of a list page, with its group titles in place. */
  const listed = (screen: readonly unknown[]) =>
    z
      .array(z.union([z.string(), z.tuple([z.literal("g"), z.string()])]))
      .parse(screen[5])
      .map((row) => (typeof row === "string" ? row.split("|")[0] : row));

  it.each([
    ["3lp1", ["l", "p", 1, 2, "12.11"], ["fjord", "halo"]],
    [
      "3lf0",
      ["l", "f", 0, 1, "12.11"],
      [
        ["g", "На каждый день"],
        "boreal-2",
        "atlas-mini",
        "delta",
        ["g", "Дизайн и моушн"],
        "atlas-mini",
        "cirrus-7",
      ],
    ],
    [
      "3lv0",
      ["l", "v", 0, 1, "12.11"],
      ["delta", "gale", "boreal-2", "atlas-pro"],
    ],
    [
      "3lc0",
      ["l", "c", 0, 2, "12.11"],
      ["delta", "halo", "echo", "gale", "cirrus-7", "boreal-2", "atlas-mini"],
    ],
    ["3lc1", ["l", "c", 1, 2, "12.11"], ["fjord", "atlas-pro"]],
  ])(
    "answers the list page %s of the current Справочник",
    async (request, head, codes) => {
      const screen = await running().tap(newUser(), request);

      expect(screen.slice(0, 5)).toEqual(head);
      expect(listed(screen)).toEqual(codes);
    },
  );

  it("answers the first page of «Мощные» like the chat state of a new message", async () => {
    expect(await running().tap(newUser(), "3lp0")).toEqual(FIRST_PAGE);
  });

  it("answers the tab «Главное» of a card", async () => {
    expect(await running().tap(newUser(), "3matlas-pro")).toEqual([
      "m",
      "atlas-pro",
      "Atlas 3 Pro",
      5,
      1,
      5,
      "$5 / $25 за 1 млн токенов · задача ≈ $6,20",
      "самая сильная в примере, но дорогая",
      [
        ["w", "тратит много токенов на одну задачу"],
        ["bh", "Atlas часто блокирует аккаунты"],
      ],
      [],
      ["код", "агенты"],
      [
        "m",
        "Atlas Code",
        "1-е место в синтетическом замере",
        "OpenCode по ключу API",
      ],
      "В Atlas Lite модель доступна только до 30.11",
    ]);
  });

  it("answers the tab «Подписки» of a card", async () => {
    expect(await running().tap(newUser(), "3satlas-pro")).toEqual([
      "s",
      "atlas-pro",
      "Atlas 3 Pro",
      5,
      1,
      5,
      [
        [
          "Atlas Chat",
          "h",
          "nn",
          [
            "Lite · $20|v|||только по акции до 30.11||1",
            "Max · $100|v|||в 5 раз больше Lite||",
            `Ultra · $200|m|≈${NBSP}$4${NBSP}200|21 раз||на Pro половина лимита|`,
          ],
        ],
      ],
    ]);
  });

  it("answers «О данных» with the full check date", async () => {
    expect(await running().tap(newUser(), "3a")).toEqual([
      "a",
      "12.11.2026",
      [
        "Мощность и цена задачи: синтетический рейтинг агентов",
        "Мощность: место в таблице агентов, каждая точка на 10 мест",
        "Замеры подписок: синтетический замер",
        "Значки, «Мой выбор» и «Лучше взять»: мнение автора",
      ],
    ]);
  });

  it("shows the newest Справочник after another import", async () => {
    const changed = syntheticAiModelsReference();
    changed.checkedOn = "2026-11-19";
    await loadReference(changed);

    const screen = await running().tap(newUser(), "3lp0");

    expect(screen.slice(0, 5)).toEqual(["l", "p", 0, 2, "19.11"]);
  });

  it("says the list was updated for a model or a page the new Справочник no longer has", async () => {
    const changed = syntheticAiModelsReference();
    changed.checkedOn = "2026-11-19";
    changed.models = changed.models.filter(
      ({ code }) => code !== "echo" && code !== "halo",
    );
    await loadReference(changed);
    const user = newUser();

    expect(await running().tap(user, "3mecho")).toEqual(["x", STALE]);
    expect(await running().tap(user, "3secho")).toEqual(["x", STALE]);
    expect(await running().tap(user, "3lp1")).toEqual(["x", STALE]);
    expect((await running().tap(user, "3mgale")).slice(0, 2)).toEqual([
      "m",
      "gale",
    ]);
  });

  it.each([
    ["an unknown screen", "3z"],
    ["a filter that does not exist", "3lq0"],
    ["a card without a code", "3m"],
  ])("answers %s with the widget's own retry state", async (_name, data) => {
    expect(await running().tap(newUser(), data)).toEqual(["x"]);
  });
});

describe("opened model cards", () => {
  beforeEach(() => loadReference());

  const views = () =>
    database
      .selectFrom("ai_models_card_views")
      .select([
        "bot_identity",
        "telegram_user_id",
        "model_code",
        "viewed_at",
        sql<string>`to_char(viewed_on, 'YYYY-MM-DD')`.as("viewed_on"),
      ])
      .orderBy("id")
      .execute();

  it("records one view per person, model and Moscow day of the tab «Главное»", async () => {
    const user = newUser();
    const other = newUser();

    // The fixed test instant is 12:00 of 7 October in Moscow.
    await running().tap(user, "3matlas-pro");
    const first = virtualTestClock.now();
    await running().tap(user, "3satlas-pro");
    await running().tap(user, "3matlas-pro");
    await running().tap(other, "3matlas-pro");
    const second = virtualTestClock.now();
    await running().tap(user, "3mdelta");
    const third = virtualTestClock.now();
    // A tap comes 2 seconds after the clock: 23:59:52 of 7 October in Moscow.
    vi.setSystemTime(Date.parse("2026-10-07T20:59:50Z"));
    await running().tap(user, "3matlas-pro");
    // 00:00:02 of 8 October in Moscow.
    vi.setSystemTime(Date.parse("2026-10-07T21:00:00Z"));
    await running().tap(user, "3matlas-pro");
    const fourth = virtualTestClock.now();

    const view = (
      telegramUser: number,
      model: string,
      viewedAt: Date,
      viewedOn: string,
    ) => ({
      bot_identity: "inside",
      telegram_user_id: String(telegramUser),
      model_code: model,
      viewed_at: viewedAt,
      viewed_on: viewedOn,
    });
    expect(await views()).toEqual([
      view(user, "atlas-pro", first, "2026-10-07"),
      view(other, "atlas-pro", second, "2026-10-07"),
      view(user, "delta", third, "2026-10-07"),
      view(user, "atlas-pro", fourth, "2026-10-08"),
    ]);
  });

  it("records nothing for lists, «Подписки», «О данных» or a card that is gone", async () => {
    const user = newUser();

    for (const data of ["3lp0", "3satlas-pro", "3a", "3mnobody", "3z"])
      await running().tap(user, data);

    expect(await views()).toEqual([]);
  });

  it("stores exactly the model codes the Справочник code format accepts", async () => {
    const format = new RegExp(`^${AI_MODELS_CODE_PATTERN}$`);
    const codes = [
      "a",
      "atlas-pro",
      "0123456789abcdef",
      "0123456789abcdefg",
      "gpt-5.5",
      "atlas_pro",
      "-atlas",
      "Atlas",
    ];
    const stored: string[] = [];
    for (const code of codes) {
      const insert = database
        .insertInto("ai_models_card_views")
        .values({
          bot_identity: "inside",
          telegram_user_id: newUser(),
          model_code: code,
          viewed_at: virtualTestClock.now(),
        })
        .execute();
      if (format.test(code)) {
        await insert;
        stored.push(code);
      } else await expect(insert, code).rejects.toThrow("check constraint");
    }

    expect(stored).toEqual(["a", "atlas-pro", "0123456789abcdef"]);
    expect((await views()).map(({ model_code }) => model_code)).toEqual(stored);
  });
});
