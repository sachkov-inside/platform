import { closeIfStarted } from "../support/close-if-started.js";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { MaterialAnnouncement } from "@inside/contracts/material-announcements";
import { AppModule } from "../../src/app.module.js";
import {
  loadApplicationConfig,
  type ApplicationConfig,
} from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { BotContacts } from "../../src/modules/bot-contacts/bot-contacts.js";
import { MATERIAL_ANNOUNCEMENT_SOURCE } from "../../src/modules/communications/material-announcement-source.js";
import { MaterialAnnouncements } from "../../src/modules/communications/material-announcements.js";
import { FunnelScheduler } from "../../src/modules/communications/funnel-scheduler.js";
import {
  COMMUNICATION_TRANSPORT,
  type CommunicationMessage,
} from "../../src/modules/communications/communication-delivery.js";
import { updateMarketingAvailability } from "../../src/modules/communications/marketing-preferences.js";
import { contactLock } from "../../src/modules/communications/communication-state.js";
import {
  SIGN_IN_REPLY_ELIGIBILITY,
  type SignInReplyEligibility,
} from "../../src/modules/outbound/sign-in-reply-eligibility.js";
import type { TelegramDeliveryResult } from "../../src/modules/outbound/telegram-messages.js";
import { CLOCK, MONOTONIC_CLOCK } from "../../src/shared/clock.js";
import { hasText } from "../../src/shared/text.js";
const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) throw new Error("DATABASE_URL required");
const db = createDatabase(databaseUrl);
const config: ApplicationConfig = {
  ...loadApplicationConfig({
    DATABASE_URL: databaseUrl,
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_WELCOME_TEXT: "welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "non-member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "unavailable",
    WORKERS_ENABLED: "false",
  }),
  materialAnnouncements: { mode: "all" },
};
const instant = new Date("2030-01-01T00:00:00Z");
let now = new Date(instant);
let item: MaterialAnnouncement;
let sourceAvailable = true;
let sourceCurrent = true;
const clock = { now: () => new Date(now) };
const source = {
  read: vi.fn((_query: { after?: string; announcementRef?: string }) =>
    Promise.resolve(
      sourceAvailable
        ? { items: sourceCurrent ? [item] : [], nextCursor: null }
        : null,
    ),
  ),
};
const transport = {
  send: vi.fn(
    (_message: CommunicationMessage): Promise<TelegramDeliveryResult> =>
      Promise.resolve({ kind: "delivered", providerMessageId: "sample" }),
  ),
};
let app: NestFastifyApplication;
let announcements: MaterialAnnouncements;
let scheduler: FunnelScheduler;
beforeAll(async () => {
  await migrateToLatest(db);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(MONOTONIC_CLOCK)
    .useValue({ now: () => 0 })
    .overrideProvider(MATERIAL_ANNOUNCEMENT_SOURCE)
    .useValue(source)
    .overrideProvider(COMMUNICATION_TRANSPORT)
    .useValue(transport)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
});
async function clearHistory() {
  await sql`truncate communication_broadcasts, communication_contacts, communication_preferences, bot_contacts, bot_contact_events,
    telegram_transport_slots, telegram_transport_fairness, start_response_deliveries, telegram_updates cascade`.execute(
    db,
  );
}
beforeEach(async () => {
  await clearHistory();
  now = new Date(instant);
  item = {
    announcementRef: randomUUID(),
    materialId: randomUUID(),
    title: "Заголовок <b>без HTML</b>",
    summary: "Краткое описание.",
    url: "https://inside.example/materials/sample",
    occurredAt: instant.toISOString(),
    notAfter: "2030-01-02T00:00:00.000Z",
  };
  sourceAvailable = true;
  sourceCurrent = true;
  source.read
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(
        sourceAvailable
          ? { items: sourceCurrent ? [item] : [], nextCursor: null }
          : null,
      ),
    );
  transport.send.mockClear();
  Object.assign(config, {
    materialAnnouncements: { mode: "all" },
    platformTrackingRedirectUrl: undefined,
    platformTrackingTargetPrefixes: undefined,
  });
  announcements = new MaterialAnnouncements(db, config, source, clock);
  scheduler = new FunnelScheduler(
    db,
    config,
    clock,
    transport,
    app.get<SignInReplyEligibility>(SIGN_IN_REPLY_ELIGIBILITY),
    undefined,
    { now: () => 0 },
    announcements,
  );
  // Every case owns its poll cursor and uses one fixed publication instant.
  now = new Date("2030-01-01T01:00:00Z");
  for (const id of ["42", "43"])
    await app.get(BotContacts).observeStart(
      {
        botIdentity: "inside",
        telegramUserId: id,
        privateChatId: id,
        updateId: id,
        observedAt: new Date(+instant - 1000),
      },
      "none",
    );
});
afterAll(async () => {
  try {
    await clearHistory();
  } finally {
    try {
      await closeIfStarted(app);
    } finally {
      await db.destroy();
    }
  }
});
async function tick() {
  now = new Date(+now + 31_000);
  return scheduler.processAvailable(25);
}
async function stop(id: string) {
  await db.transaction().execute(async (tx) => {
    await contactLock(tx, "inside", id);
    await updateMarketingAvailability(tx, "inside", id, now, true, false);
  });
}
test("all activated unlinked contacts receive one public announcement with its preview URL", async () => {
  await tick();
  await tick();
  await tick();
  expect(transport.send.mock.calls.map(([m]) => m.chatId).sort()).toEqual([
    "42",
    "43",
  ]);
  expect(transport.send.mock.calls[0]?.[0].content.text).toContain(item.title);
  expect(transport.send.mock.calls[0]?.[0]).toMatchObject({
    linkPreviewUrl: item.url,
    content: {
      buttons: [{ text: "Открыть материал", url: item.url }],
    },
  });
  expect(
    await db
      .selectFrom("communication_material_announcements")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
test("test mode plans only the configured owner and keeps ordinary marketing off", async () => {
  Object.assign(config, {
    materialAnnouncements: { mode: "test", telegramUserId: "42" },
  });
  expect(config.marketingEnabled).toBe(false);
  await tick();
  await tick();
  expect(transport.send.mock.calls.map(([m]) => m.chatId)).toEqual(["42"]);
});
test("stop before planning excludes a contact; stop after planning cancels its saved delivery", async () => {
  await stop("43");
  await announcements.plan();
  await stop("42");
  await tick();
  expect(transport.send).not.toHaveBeenCalled();
});
test("a newly activated contact does not receive announcements from before its start", async () => {
  await app.get(BotContacts).observeStart(
    {
      botIdentity: "inside",
      telegramUserId: "44",
      privateChatId: "44",
      updateId: "44",
      observedAt: now,
    },
    "none",
  );
  await tick();
  await tick();
  expect(transport.send.mock.calls.map(([m]) => m.chatId).sort()).toEqual([
    "42",
    "43",
  ]);
});
test("withdrawal between the committed claim and final fresh check prevents transport", async () => {
  await announcements.plan();
  source.read
    .mockImplementationOnce(() =>
      Promise.resolve({ items: [item], nextCursor: null }),
    )
    .mockImplementationOnce(() =>
      Promise.resolve({ items: [], nextCursor: null }),
    );
  sourceCurrent = false;
  await scheduler.processAvailable(25);
  expect(transport.send).not.toHaveBeenCalled();
});
test("unavailable final eligibility defers the unsent claim and a fresh check can resume it", async () => {
  await announcements.plan();
  source.read
    .mockImplementationOnce(() =>
      Promise.resolve({ items: [item], nextCursor: null }),
    )
    .mockImplementationOnce(() => Promise.resolve(null));
  await scheduler.processAvailable(25);
  expect(transport.send).not.toHaveBeenCalled();
  await tick();
  await tick();
  expect(transport.send.mock.calls.map(([m]) => m.chatId).sort()).toEqual([
    "42",
    "43",
  ]);
});
test("a disabled rollout never dispatches already planned material broadcasts", async () => {
  await announcements.plan();
  Object.assign(config, { materialAnnouncements: undefined });
  await tick();
  expect(transport.send).not.toHaveBeenCalled();
});

test("unknown provider outcomes survive replay without an automatic duplicate", async () => {
  transport.send.mockResolvedValueOnce({ kind: "transport_unknown" });
  await tick();
  await tick();
  await tick();
  expect(transport.send.mock.calls.map(([m]) => m.chatId).sort()).toEqual([
    "42",
    "43",
  ]);
  const rows = await db
    .selectFrom("communication_deliveries")
    .selectAll()
    .where("kind", "=", "broadcast")
    .execute();
  expect(
    rows.filter((row) => row.parts.some((part) => part.state === "unknown")),
  ).toHaveLength(1);
});
test("concurrent planners commit one audience snapshot", async () => {
  await Promise.all([announcements.plan(), announcements.plan()]);
  expect(
    await db
      .selectFrom("communication_material_announcements")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
  expect(
    await db
      .selectFrom("communication_deliveries")
      .selectAll()
      .where("kind", "=", "broadcast")
      .execute(),
  ).toHaveLength(2);
});

test("preview retains the public reader URL while the button uses its tracked link", async () => {
  Object.assign(config, {
    platformTrackingRedirectUrl: "https://inside.example/communications/visit",
    platformTrackingTargetPrefixes: ["https://inside.example/materials/"],
  });
  await tick();
  await tick();
  const message = transport.send.mock.calls[0]?.[0];
  expect(message?.linkPreviewUrl).toBe(item.url);
  expect(message?.content.buttons[0]?.url).toMatch(
    /^https:\/\/inside\.example\/communications\/visit\?token=/u,
  );
});
