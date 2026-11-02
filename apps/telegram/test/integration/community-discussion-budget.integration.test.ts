import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "kysely";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import {
  CommunityDiscussionBudget,
  BudgetedDiscussionModel,
  DiscussionBudgetExceeded,
} from "../../src/modules/community-discussions/community-discussion-budget.js";
import type { CommunityDiscussionModel } from "../../src/modules/community-discussions/discussion-model.js";
import { CommunityAuthors } from "../../src/modules/communications/community-authors.js";
import { required } from "../support/required.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";

registerFixedClock();
const database = createDatabase(required(process.env["DATABASE_URL"]));
const now = new Date(fixedTestInstant());
let current = now;
let calls = 0;
let providerFailure = false;
const model: CommunityDiscussionModel = {
  group: () => {
    calls += 1;
    if (providerFailure)
      return Promise.reject(new Error("synthetic provider failure"));
    return Promise.resolve({
      discussions: [],
      usage: { inputTokens: 1000, outputTokens: 1000 },
    });
  },
  transcribe: () => {
    calls += 1;
    return Promise.resolve({
      text: "Ответ",
      usage: { inputTokens: null, outputTokens: null },
    });
  },
};
const input = { messages: [], discussions: [] };
function budget(limit = 10000) {
  const config = loadApplicationConfig({
    DATABASE_URL: required(process.env["DATABASE_URL"]),
    TELEGRAM_BOT_IDENTITY: "budget-test",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
    COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: String(limit),
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic non member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    WORKERS_ENABLED: "false",
  });
  return new CommunityDiscussionBudget(
    database,
    config,
    { now: () => current },
    new CommunityAuthors(database, {
      authorize: () => Promise.resolve("allowed"),
    }),
  );
}
beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  current = now;
  calls = 0;
  providerFailure = false;
  await sql`truncate community_discussion_model_calls, community_discussion_budget_months, community_discussion_runs restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await database.destroy();
});

it("stops both model operations at the durable monthly limit and resumes after a limit increase or month rollover", async () => {
  let gate = new BudgetedDiscussionModel(model, budget());
  await gate.group(input);
  await expect(
    gate.transcribe({ bytes: new Uint8Array([1]), mediaType: "audio/ogg" }),
  ).rejects.toBeInstanceOf(DiscussionBudgetExceeded);
  gate = new BudgetedDiscussionModel(model, budget());
  await expect(gate.group(input)).rejects.toBeInstanceOf(
    DiscussionBudgetExceeded,
  );
  expect(calls).toBe(1);
  expect(await budget().snapshot()).toMatchObject({
    monthCostMicroUsd: 10000,
    modelCalls: 1,
  });
  await new BudgetedDiscussionModel(model, budget(20000)).transcribe({
    bytes: new Uint8Array([1]),
    mediaType: "audio/ogg",
  });
  expect(calls).toBe(2);
  current = new Date("2032-02-01T00:00:00.000Z");
  await new BudgetedDiscussionModel(model, budget()).group(input);
  expect(calls).toBe(3);
  expect(await budget().snapshot()).toMatchObject({
    monthCostMicroUsd: 10000,
    modelCalls: 1,
  });
});
