import { closeIfStarted } from "../support/close-if-started.js";
import { SIGN_IN_REPLY_ELIGIBILITY } from "../../src/modules/outbound/sign-in-reply-eligibility.js";
import { MarketingEntry } from "../../src/modules/communications/marketing-entry.js";
import type { TelegramDeliveryResult } from "../../src/modules/outbound/telegram-messages.js";
import {
  WAITLIST_AUTHORIZATION,
  type WaitlistAuthorizationResult,
  type WaitlistQuery,
} from "../../src/modules/communications/waitlist-authorization.js";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { BotContacts } from "../../src/modules/bot-contacts/bot-contacts.js";
import { AUTHOR_AUTHORIZATION } from "../../src/modules/communications/author-authorization.js";
import { COMMUNICATION_TRANSPORT } from "../../src/modules/communications/communication-delivery.js";
import { FunnelScheduler } from "../../src/modules/communications/funnel-scheduler.js";
import { CLOCK } from "../../src/shared/clock.js";
import { hasText } from "../../src/shared/text.js";
const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) throw new Error("DATABASE_URL required");
const database = createDatabase(databaseUrl);
const config = loadApplicationConfig({
  DATABASE_URL: databaseUrl,
  TELEGRAM_BOT_IDENTITY: "inside",
  TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
  PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
  TELEGRAM_WELCOME_TEXT: "synthetic welcome",
  TELEGRAM_LINK_RECEIPT_TEXT: "synthetic receipt",
  TELEGRAM_LINKED_MEMBER_TEXT: "synthetic member",
  TELEGRAM_LINKED_NON_MEMBER_TEXT: "synthetic non-member",
  TELEGRAM_LINKED_UNAVAILABLE_TEXT: "synthetic unavailable",
  PLATFORM_COMMUNICATIONS_SECRET: "synthetic_communications_secret_for_tests",
  WORKERS_ENABLED: "false",
  TELEGRAM_MARKETING_ENABLED: "false",
});
const instant = new Date("2030-01-01T00:00:00Z");
let currentTime = new Date(instant);
const clock = { now: () => new Date(currentTime) };
const transport = {
  send: vi.fn((): Promise<TelegramDeliveryResult> =>
    Promise.resolve({ kind: "delivered", providerMessageId: "synthetic" }),
  ),
};
const purchaseUrl = "https://platform.example/products/ai-engineering/buy";
const member = {
  accountRef: "waitlisted-account",
  telegramIdentityRef: "waitlisted-identity",
};
const waitlist = {
  read: vi.fn((_query: WaitlistQuery): Promise<WaitlistAuthorizationResult> =>
    Promise.resolve({
      status: "ok",
      saleOpen: true,
      purchaseUrl,
      active: 1,
      members: [member],
    }),
  ),
};
let app: NestFastifyApplication;
let intakeId: string;
function command(operation: string, payload: unknown, expectedRevision = 0) {
  return app.inject({
    method: "POST",
    url: "/integrations/platform/v1/communications",
    headers: { authorization: `Bearer ${config.communicationsSecret}` },
    payload: {
      contractVersion: "inside-communications-v1",
      operation,
      operationId: randomUUID(),
      expectedRevision,
      actor: { accountRef: "synthetic-author" },
      payload,
    },
  });
}
beforeAll(async () => {
  await migrateToLatest(database);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(AUTHOR_AUTHORIZATION)
    .useValue({ authorize: () => Promise.resolve("allowed") })
    .overrideProvider(WAITLIST_AUTHORIZATION)
    .useValue(waitlist)
    .overrideProvider(COMMUNICATION_TRANSPORT)
    .useValue(transport)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
beforeEach(async () => {
  await sql`truncate communication_broadcasts, communication_contacts, communication_preferences, communication_operations, bot_contacts, bot_contact_events, telegram_transport_slots, telegram_transport_fairness, start_response_deliveries, telegram_updates, communication_funnels, communication_intro, platform_links, link_transactions cascade`.execute(
    database,
  );
  currentTime = new Date(instant);
  intakeId = randomUUID();
  transport.send.mockClear();
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: true,
    purchaseUrl,
    active: 1,
    members: [member],
  });
  await database
    .insertInto("link_transactions")
    .values({
      account_ref: member.accountRef,
      bot_identity: "inside",
      candidate_telegram_user_id: "42",
      confirmed_at: instant,
      expires_at: instant,
      link_transaction_ref: "synthetic-link",
      received_at: instant,
      registered_at: instant,
      return_correlation: "synthetic-return",
      state: "linked",
      token_digest: "a".repeat(43),
    })
    .execute();
  await database
    .insertInto("platform_links")
    .values({
      account_ref: member.accountRef,
      bot_identity: "inside",
      evidence_version: 0,
      last_membership_observation_at: null,
      last_membership_observation_update_id: null,
      link_transaction_ref: "synthetic-link",
      linked_at: instant,
      telegram_identity_ref: member.telegramIdentityRef,
      telegram_user_id: "42",
    })
    .execute();
});
afterAll(async () => {
  try {
    await closeIfStarted(app);
  } finally {
    await database.destroy();
  }
});
test("owner can prepare an explicit waitlist draft without sending or enabling marketing", async () => {
  const broadcastId = randomUUID();
  const saved = await command("broadcasts.save", {
    broadcastId,
    audience: { kind: "waitlist", intakeId },
    scheduledAt: null,
    parts: [
      {
        partId: randomUUID(),
        content: {
          type: "text",
          text: "Открыт предзаказ AI Engineering.",
          entities: [],
          buttons: [
            {
              text: "Перейти к покупке",
              url: "https://platform.example/products/ai-engineering/buy",
            },
          ],
        },
      },
    ],
  });
  expect(saved.statusCode).toBe(200);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
});

test("explicit launch sends only the real waitlist audience with global marketing disabled", async () => {
  await app.get(BotContacts).observeStart(
    {
      botIdentity: "inside",
      telegramUserId: "42",
      privateChatId: "42",
      updateId: "1",
      observedAt: instant,
    },
    "none",
  );
  await app.get(BotContacts).observeStart(
    {
      botIdentity: "inside",
      telegramUserId: "43",
      privateChatId: "43",
      updateId: "2",
      observedAt: instant,
    },
    "none",
  );
  const broadcastId = randomUUID();
  expect(
    (
      await command("broadcasts.save", {
        broadcastId,
        audience: { kind: "waitlist", intakeId },
        scheduledAt: null,
        parts: [
          {
            partId: randomUUID(),
            content: {
              type: "text",
              text: "Открыт предзаказ AI Engineering.",
              entities: [],
              buttons: [{ text: "Перейти к покупке", url: purchaseUrl }],
            },
          },
        ],
      })
    ).statusCode,
  ).toBe(200);
  const launched = await command("broadcasts.launch", { broadcastId }, 1);
  expect(launched.statusCode).toBe(200);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(1);
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(transport.send).toHaveBeenCalledWith(
    expect.objectContaining({ chatId: "42" }),
  );
});

async function prepared() {
  await app.get(BotContacts).observeStart(
    {
      botIdentity: "inside",
      telegramUserId: "42",
      privateChatId: "42",
      updateId: "1",
      observedAt: instant,
    },
    "none",
  );
  const broadcastId = randomUUID();
  expect(
    (
      await command("broadcasts.save", {
        broadcastId,
        audience: { kind: "waitlist", intakeId },
        scheduledAt: null,
        parts: [
          {
            partId: randomUUID(),
            content: {
              type: "text",
              text: "Открыт предзаказ AI Engineering.",
              entities: [],
              buttons: [{ text: "Перейти к покупке", url: purchaseUrl }],
            },
          },
        ],
      })
    ).statusCode,
  ).toBe(200);
  return broadcastId;
}
test("withdrawal after snapshot suppresses dispatch; a second broadcast cannot notify the same opening", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: true,
    purchaseUrl,
    active: 0,
    members: [],
  });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
  const second = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId: second }, 1)).statusCode,
  ).toBe(409);
});
test("closed sale and unavailable eligibility never dispatch", async () => {
  const broadcastId = await prepared();
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: false,
    purchaseUrl,
    active: 1,
    members: [member],
  });
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(409);
  expect(transport.send).not.toHaveBeenCalled();
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: true,
    purchaseUrl,
    active: 1,
    members: [member],
  });
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  waitlist.read.mockResolvedValue({ status: "unavailable" });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
});
test("preview exposes active and eligible audience and closed sale without sending", async () => {
  const broadcastId = await prepared();
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: false,
    purchaseUrl,
    active: 3,
    members: [member],
  });
  const preview = await command("broadcasts.preview", { broadcastId }, 1);
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({
    waitlistPreview: { active: 3, eligible: 1, saleOpen: false, purchaseUrl },
  });
  expect(transport.send).not.toHaveBeenCalled();
});

test("unknown transport result remains unknown after repeated worker runs and launch retries", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  transport.send.mockResolvedValueOnce({ kind: "transport_unknown" });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(1);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(409);
  const restarted = new FunnelScheduler(
    database,
    config,
    { now: () => new Date(instant) },
    transport,
    app.get(SIGN_IN_REPLY_ELIGIBILITY),
    waitlist,
  );
  expect(await restarted.processAvailable()).toBe(0);
  expect(transport.send).toHaveBeenCalledTimes(1);
  const statistics = await command("statistics.read", { broadcastId });
  expect(statistics.json()).toMatchObject({
    statistics: { deliveries: { sent: 0, unknown: 1, failed: 0 } },
  });
});
test("current stop after snapshot suppresses notification without resetting the existing preference", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  await app.get(MarketingEntry).setPreference(
    {
      botIdentity: "inside",
      telegramUserId: "42",
      privateChatId: "42",
      updateId: "99",
      observedAt: instant,
    },
    false,
  );
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
  const statistics = await command("statistics.read", { broadcastId });
  expect(statistics.json()).toMatchObject({
    statistics: { marketingOff: 1, deliveries: { sent: 0 } },
  });
});
test("a changed local verified identity is never substituted into the snapshot", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  await database
    .updateTable("platform_links")
    .set({ telegram_identity_ref: "replacement-identity" })
    .where("account_ref", "=", member.accountRef)
    .execute();
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
});

test("confirmed Telegram block is reported as failure and never retried", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  transport.send.mockResolvedValueOnce({
    kind: "api_rejected",
    providerErrorCode: 403,
  });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(1);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(
    (await command("statistics.read", { broadcastId })).json(),
  ).toMatchObject({
    statistics: { blocked: 1, deliveries: { suppressed: 1, sent: 0 } },
  });
});
test("ordinary broadcasts remain pending while the explicitly launched waitlist can dispatch", async () => {
  const broadcastId = await prepared();
  const all = randomUUID();
  const parts = [
    {
      partId: randomUUID(),
      content: {
        type: "text",
        text: "Ordinary marketing",
        entities: [],
        buttons: [],
      },
    },
  ];
  expect(
    (
      await command("broadcasts.save", {
        broadcastId: all,
        audience: { kind: "all" },
        parts,
        scheduledAt: null,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await command("broadcasts.launch", { broadcastId: all }, 1)).statusCode,
  ).toBe(200);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  const launches = await Promise.all([
    command("broadcasts.launch", { broadcastId }, 1),
    command("broadcasts.launch", { broadcastId }, 1),
  ]);
  expect(launches.map((response) => response.statusCode).sort()).toEqual([
    200, 409,
  ]);
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(1);
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(
    (await command("statistics.read", { broadcastId: all })).json(),
  ).toMatchObject({ statistics: { deliveries: { sent: 0, pending: 1 } } });
});

test("withdrawal after the first Platform check but before the local claim prevents transport", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  let withdrawn = false;
  waitlist.read.mockImplementation(() => {
    const active = !withdrawn;
    withdrawn = true;
    return Promise.resolve({
      status: "ok",
      saleOpen: true,
      purchaseUrl,
      active: active ? 1 : 0,
      members: active ? [member] : [],
    });
  });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
  expect(
    (await command("statistics.read", { broadcastId })).json(),
  ).toMatchObject({
    statistics: { deliveries: { sent: 0, unknown: 0, pending: 0 } },
  });
});

test("launch report retains active and unavailable audience separately from delivery attempts", async () => {
  const broadcastId = await prepared();
  await app.get(MarketingEntry).setPreference(
    {
      botIdentity: "inside",
      telegramUserId: "42",
      privateChatId: "42",
      updateId: "99",
      observedAt: instant,
    },
    false,
  );
  const launched = await command("broadcasts.launch", { broadcastId }, 1);
  expect(launched.statusCode).toBe(200);
  expect(launched.json()).toMatchObject({
    broadcast: {
      snapshotSize: 0,
      waitlistAudience: { active: 1, eligible: 0, excluded: 1 },
    },
  });
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: true,
    purchaseUrl,
    active: 0,
    members: [],
  });
  expect(
    (await command("broadcasts.read", { broadcastId })).json(),
  ).toMatchObject({
    broadcast: { waitlistAudience: { active: 1, eligible: 0, excluded: 1 } },
  });
  expect(
    (await command("statistics.read", { broadcastId })).json(),
  ).toMatchObject({
    statistics: { deliveries: { sent: 0, failed: 0, unknown: 0 } },
  });
  expect(transport.send).not.toHaveBeenCalled();
});

test("final eligibility outage releases an unsent claim without unknown delivery and retries after recovery", async () => {
  const broadcastId = await prepared();
  expect(
    (await command("broadcasts.launch", { broadcastId }, 1)).statusCode,
  ).toBe(200);
  let first = true;
  waitlist.read.mockImplementation(() => {
    if (!first) return Promise.resolve({ status: "unavailable" });
    first = false;
    return Promise.resolve({
      status: "ok",
      saleOpen: true,
      purchaseUrl,
      active: 1,
      members: [member],
    });
  });
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(0);
  expect(transport.send).not.toHaveBeenCalled();
  expect(
    (await command("statistics.read", { broadcastId })).json(),
  ).toMatchObject({
    statistics: { deliveries: { pending: 1, unknown: 0, sent: 0 } },
  });
  waitlist.read.mockResolvedValue({
    status: "ok",
    saleOpen: true,
    purchaseUrl,
    active: 1,
    members: [member],
  });
  currentTime = new Date("2030-01-01T00:00:06Z");
  expect(await app.get(FunnelScheduler).processAvailable()).toBe(1);
  expect(transport.send).toHaveBeenCalledTimes(1);
});
