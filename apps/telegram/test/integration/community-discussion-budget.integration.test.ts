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
import { AuthorDelivery } from "../../src/modules/communications/author-delivery.js";
import type { AuthorAuthorization } from "../../src/modules/communications/author-authorization.js";
import { seedCommunityBinding } from "../support/community-binding.js";
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
function configuration(limit = 10000) {
  return loadApplicationConfig({
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
}
function budget(
  limit = 10000,
  authorization: AuthorAuthorization = {
    authorize: () => Promise.resolve("allowed"),
  },
) {
  return new CommunityDiscussionBudget(
    database,
    configuration(limit),
    { now: () => current },
    new CommunityAuthors(database, authorization),
  );
}
beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  current = now;
  calls = 0;
  providerFailure = false;
  await sql`truncate telegram_transport_slots, telegram_transport_fairness, communication_author_outbox, platform_links, link_transactions, bot_contacts, community_discussion_model_calls, community_discussion_budget_months, community_discussion_runs restart identity cascade`.execute(
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

it("keeps a failed provider attempt charged and prevents parallel stale budget checks", async () => {
  const entered = deferred();
  const release = deferred();
  const slow: CommunityDiscussionModel = {
    ...model,
    group: async () => {
      calls += 1;
      entered.resolve();
      await release.promise;
      throw new Error("synthetic billed invalid output");
    },
  };
  const pending = new BudgetedDiscussionModel(slow, budget()).group(input);
  const rejected = expect(pending).rejects.toThrow(
    "synthetic billed invalid output",
  );
  try {
    await entered.promise;
    await expect(
      new BudgetedDiscussionModel(model, budget()).group(input),
    ).rejects.toBeInstanceOf(DiscussionBudgetExceeded);
    expect(calls).toBe(1);
  } finally {
    release.resolve();
  }
  await rejected;
  expect(await budget().snapshot()).toMatchObject({
    monthCostMicroUsd: 10000,
    modelCalls: 1,
  });
});

it("prices transcription duration even when the provider returns no usage", async () => {
  await new BudgetedDiscussionModel(model, budget(20000)).transcribe({
    bytes: new Uint8Array([1]),
    mediaType: "audio/ogg",
    durationSeconds: 130,
  });
  expect(await budget().snapshot()).toMatchObject({
    monthCostMicroUsd: 13000,
    modelCalls: 1,
  });
});

it("enqueues one monthly author notice durably and never holds the budget lock during author authorization", async () => {
  await seedCommunityBinding(
    database,
    {
      accountRef: "budget-author",
      telegramIdentityRef: "budget-author-identity",
      linkRef: "budget-link",
      linkRevision: 1,
    },
    now,
    "900",
    "budget-test",
  );
  const entered = deferred();
  const release = deferred();
  const authorization: AuthorAuthorization = {
    authorize: async () => {
      entered.resolve();
      await release.promise;
      return "allowed";
    },
  };
  const pending = new BudgetedDiscussionModel(
    model,
    budget(0, authorization),
  ).group(input);
  const rejected = expect(pending).rejects.toBeInstanceOf(
    DiscussionBudgetExceeded,
  );
  try {
    await entered.promise;
    await new BudgetedDiscussionModel(model, budget(20000)).group(input);
    expect(calls).toBe(1);
  } finally {
    release.resolve();
  }
  await rejected;
  await Promise.all([
    budget(0).retryNotification(),
    budget(0).retryNotification(),
  ]);
  const delivered: string[] = [];
  const outbox = new AuthorDelivery(
    database,
    { ...configuration(), deliveryMode: "live" },
    { authorize: () => Promise.resolve("allowed") },
    {
      send: (message) => {
        delivered.push(message.chatId);
        return Promise.resolve({
          kind: "delivered",
          providerMessageId: "notice-1",
        });
      },
    },
  );
  expect(await outbox.processAvailable(now)).toBe(1);
  expect(await outbox.processAvailable(now)).toBe(0);
  expect(delivered).toEqual(["900"]);
});

it("continues bounded recipient pages and selects only a confirmed authorized author", async () => {
  for (let id = 901; id <= 907; id += 1)
    await seedCommunityBinding(
      database,
      {
        accountRef: `budget-author-${id}`,
        telegramIdentityRef: `budget-identity-${id}`,
        linkRef: `budget-link-${id}`,
        linkRevision: 1,
      },
      now,
      String(id),
      "budget-test",
    );
  const checked: string[] = [];
  const authorization: AuthorAuthorization = {
    authorize: (actor) => {
      checked.push(actor.accountRef);
      return Promise.resolve(
        actor.accountRef === "budget-author-907" ? "allowed" : "denied",
      );
    },
  };
  await expect(
    new BudgetedDiscussionModel(model, budget(0, authorization)).group(input),
  ).rejects.toBeInstanceOf(DiscussionBudgetExceeded);
  expect(checked).toHaveLength(5);
  const delivered: string[] = [];
  const outbox = new AuthorDelivery(
    database,
    { ...configuration(), deliveryMode: "live" },
    authorization,
    {
      send: (message) => {
        delivered.push(message.chatId);
        return Promise.resolve({
          kind: "delivered",
          providerMessageId: "notice-page",
        });
      },
    },
  );
  expect(await outbox.processAvailable(now)).toBe(0);
  await budget(0, authorization).retryNotification();
  expect(await outbox.processAvailable(now)).toBe(1);
  expect(delivered).toEqual(["907"]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
