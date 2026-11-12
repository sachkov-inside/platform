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
import { AiModelsReferences } from "../../src/modules/ai-models/ai-models-reference.js";
import { runAiModelsReport } from "../../src/operations/ai-models-report-command.js";
import { hasText } from "../../src/shared/text.js";
import { closeIfStarted } from "../support/close-if-started.js";
import {
  registerFixedClock,
  virtualTestClock,
} from "../support/fixed-clock.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";
import {
  newUser,
  startTrainerBot,
  type TrainerBot,
} from "../support/trainer-bot.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

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

const at = (instant: string) => vi.setSystemTime(Date.parse(instant));

/** The owner's import makes the synthetic Справочник current; it has a suite of its own. */
async function loadReference(): Promise<void> {
  const report = await new AiModelsReferences(
    database,
    virtualTestClock,
  ).import(syntheticAiModelsReference(), true);
  expect(report.status).toBe("imported");
}

/**
 * Writes what the card screens write for an opened tab «Главное» of a model card, at an instant
 * of the test's choice: `viewedAt`, in UTC. Like them, it adds nothing when the person already
 * viewed the card on that Moscow day. ai-models.integration.test.ts presses the cards themselves.
 */
async function viewCard(
  userId: number,
  modelCode: string,
  viewedAt: string,
): Promise<void> {
  await database
    .insertInto("ai_models_card_views")
    .values({
      bot_identity: "inside",
      telegram_user_id: userId,
      model_code: modelCode,
      viewed_at: new Date(viewedAt),
    })
    .onConflict((conflict) =>
      conflict
        .columns([
          "bot_identity",
          "telegram_user_id",
          "model_code",
          "viewed_on",
        ])
        .doNothing(),
    )
    .execute();
}

/** Runs the owner's command and reads its JSON lines. */
async function report(mode: string): Promise<{
  lines: unknown[];
  stdout: string;
}> {
  const outcome = await runAiModelsReport({
    mode,
    database,
    clock: virtualTestClock,
  });
  expect(outcome.stderr).toBe("");
  expect(outcome.exitCode).toBe(0);
  return {
    stdout: outcome.stdout,
    lines: outcome.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as unknown),
  };
}

describe("the usage report", () => {
  it("counts openings and people of a day, split by source label", async () => {
    await loadReference();
    const [first, second, third] = [newUser(), newUser(), newUser()];
    await running().say(first, "/start models_post1");
    await running().say(second, "/start models_post1");
    await running().say(third, "/models");
    await running().say(second, "/start models_digest");
    // The first person comes again the same day, now without a label.
    await running().say(first, "ИИ-модели");

    const { lines } = await report("--usage");

    // The fixed test instant is 12:00 of 7 October in Moscow.
    expect(lines).toEqual([
      {
        day: "2026-10-07",
        openings: 5,
        people: 3,
        sources: [
          { source: "digest", openings: 1, people: 1 },
          { source: "post1", openings: 2, people: 2 },
          { source: "неизвестна", openings: 2, people: 2 },
        ],
      },
    ]);
  });

  it("puts each opening on its Moscow day", async () => {
    await loadReference();
    const user = newUser();
    // 23:59:50 of 7 October in Moscow.
    at("2026-10-07T20:59:50Z");
    await running().say(user, "/start models_night");
    // 00:00:10 of 8 October in Moscow.
    at("2026-10-07T21:00:10Z");
    await running().say(user, "/start models_night");

    const { lines } = await report("--usage");

    expect(lines).toEqual([
      {
        day: "2026-10-07",
        openings: 1,
        people: 1,
        sources: [{ source: "night", openings: 1, people: 1 }],
      },
      {
        day: "2026-10-08",
        openings: 1,
        people: 1,
        sources: [{ source: "night", openings: 1, people: 1 }],
      },
    ]);
  });

  it("counts a request made before the Справочник was loaded", async () => {
    const [early, later] = [newUser(), newUser()];
    await running().say(early, "/start models_teaser");
    await loadReference();
    await running().say(later, "/start models_teaser");

    const { lines } = await report("--usage");

    // The first person got the text that the section opens soon; both asked for it.
    expect(running().messages.widgets).toHaveLength(1);
    expect(lines).toEqual([
      {
        day: "2026-10-07",
        openings: 2,
        people: 2,
        sources: [{ source: "teaser", openings: 2, people: 2 }],
      },
    ]);
  });
});

describe("the cards report", () => {
  it("counts card views and people per model, most viewed first", async () => {
    const [first, second, third] = [newUser(), newUser(), newUser()];
    await viewCard(first, "gpt-5", "2026-10-07T08:00:00Z");
    await viewCard(first, "gpt-5", "2026-10-06T08:00:00Z");
    await viewCard(second, "gpt-5", "2026-10-02T08:00:00Z");
    // Equal views: the card more people viewed goes first.
    await viewCard(third, "claude-opus", "2026-10-05T08:00:00Z");
    await viewCard(third, "claude-opus", "2026-10-04T08:00:00Z");
    await viewCard(first, "kimi-k2", "2026-10-03T08:00:00Z");
    await viewCard(second, "kimi-k2", "2026-10-04T08:00:00Z");
    await viewCard(third, "deepseek-v3", "2026-10-01T08:00:00Z");

    const { lines } = await report("--cards");

    expect(lines).toEqual([
      {
        model: "gpt-5",
        views: 3,
        people: 2,
        last7Days: { views: 3, people: 2 },
      },
      {
        model: "kimi-k2",
        views: 2,
        people: 2,
        last7Days: { views: 2, people: 2 },
      },
      {
        model: "claude-opus",
        views: 2,
        people: 1,
        last7Days: { views: 2, people: 1 },
      },
      {
        model: "deepseek-v3",
        views: 1,
        people: 1,
        last7Days: { views: 1, people: 1 },
      },
    ]);
  });

  it("counts a person's opens of one card once per Moscow day", async () => {
    await loadReference();
    const [user, other] = [newUser(), newUser()];
    // The fixed test instant is 12:00 of 7 October in Moscow.
    await running().tap(user, "3matlas-pro");
    await running().tap(user, "3matlas-pro");
    await running().tap(other, "3matlas-pro");
    // A tap comes 2 seconds after the clock: 23:59:52 of 7 October in Moscow.
    at("2026-10-07T20:59:50Z");
    await running().tap(user, "3matlas-pro");
    // 00:00:02 of 8 October in Moscow: a new day counts again.
    at("2026-10-07T21:00:00Z");
    await running().tap(user, "3matlas-pro");
    await running().tap(user, "3matlas-pro");

    const { lines } = await report("--cards");

    expect(lines).toEqual([
      {
        model: "atlas-pro",
        views: 3,
        people: 2,
        last7Days: { views: 3, people: 2 },
      },
    ]);
  });

  it("counts the last seven Moscow days, today included", async () => {
    const user = newUser();
    // 23:59:59 of 30 September in Moscow: the day before the seven.
    await viewCard(user, "gpt-5", "2026-09-30T20:59:59Z");
    // 00:00 of 1 October in Moscow: the first of the seven days up to 7 October.
    await viewCard(user, "gpt-5", "2026-09-30T21:00:00Z");
    await viewCard(user, "deepseek-v3", "2026-09-01T08:00:00Z");

    // The fixed test instant is 12:00 of 7 October in Moscow.
    const today = await report("--cards");
    // 00:00:10 of 8 October in Moscow: 1 October has left the seven days.
    at("2026-10-07T21:00:10Z");
    const tomorrow = await report("--cards");

    expect(today.lines).toEqual([
      {
        model: "gpt-5",
        views: 2,
        people: 1,
        last7Days: { views: 1, people: 1 },
      },
      {
        model: "deepseek-v3",
        views: 1,
        people: 1,
        last7Days: { views: 0, people: 0 },
      },
    ]);
    expect(tomorrow.lines).toEqual([
      {
        model: "gpt-5",
        views: 2,
        people: 1,
        last7Days: { views: 0, people: 0 },
      },
      {
        model: "deepseek-v3",
        views: 1,
        people: 1,
        last7Days: { views: 0, people: 0 },
      },
    ]);
  });
});

describe("both reports", () => {
  it("carry no Telegram identifier of the people they count", async () => {
    await loadReference();
    const [first, second] = [newUser(), newUser()];
    await running().say(first, "/start models_post1");
    await running().say(second, "/models");
    await viewCard(first, "gpt-5", "2026-10-07T08:00:00Z");
    await viewCard(second, "gpt-5", "2026-10-07T08:00:00Z");

    const usage = await report("--usage");
    const cards = await report("--cards");

    expect(usage.lines).toHaveLength(1);
    expect(cards.lines).toHaveLength(1);
    for (const user of [first, second])
      expect(usage.stdout + cards.stdout).not.toContain(String(user));
  });

  it("print nothing when nobody opened the section", async () => {
    expect((await report("--usage")).stdout).toBe("");
    expect((await report("--cards")).stdout).toBe("");
  });

  it("refuse a call without a known report and print nothing", async () => {
    for (const mode of [undefined, "--questions", "--people"])
      expect(
        await runAiModelsReport({ mode, database, clock: virtualTestClock }),
      ).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "Use --usage or --cards with DATABASE_URL.\n",
      });
  });
});
