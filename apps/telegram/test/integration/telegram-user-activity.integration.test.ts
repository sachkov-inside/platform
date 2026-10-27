import { BotContacts } from "../../src/modules/bot-contacts/bot-contacts.js";
import type { Database } from "../../src/database/database.js";
import {
  BotSignIn,
  digestSignInSecret,
} from "../../src/modules/bot-sign-in/bot-sign-in.js";
import { MarketingEntry } from "../../src/modules/communications/marketing-entry.js";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { AppModule } from "../../src/app.module.js";
import { disabledTelegramObservability } from "../../src/observability/telegram-observability.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { prepareTelegramUpdateForInbox } from "../../src/adapters/telegram/grammy-update.adapter.js";
import {
  privateStartUpdate,
  privateContactabilityUpdate,
} from "../support/synthetic-telegram-updates.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { expect, it, vi } from "vitest";
import { migrateToLatest } from "../../src/database/migrator.js";
import { TelegramUpdateInbox } from "../../src/modules/update-inbox/telegram-update-inbox.js";
import { TelegramUserActivity } from "../../src/modules/update-inbox/telegram-user-activity.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { withMigrationDatabase } from "../support/migration-database.js";
import { required } from "../support/required.js";
import { seedCommunityBinding } from "../support/community-binding.js";
import { purgeExpiredRecords } from "../../src/database/retention.js";

const databaseUrl = required(process.env["DATABASE_URL"]);
const config = loadApplicationConfig({
  DATABASE_URL: databaseUrl,
  TELEGRAM_BOT_IDENTITY: "activity-fixture",
  TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests",
  PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests",
  TELEGRAM_WELCOME_TEXT: "Welcome",
  TELEGRAM_LINK_RECEIPT_TEXT: "Receipt",
  TELEGRAM_LINKED_MEMBER_TEXT: "Member",
  TELEGRAM_LINKED_NON_MEMBER_TEXT: "Nonmember",
  TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Unknown",
  WORKERS_ENABLED: "false",
});
// Every case owns a fresh database, so activity retention/rollback never affects another suite.

it("commits the event with exactly one successful lease settlement, survives retry and excludes lease-lost/failed/system work", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateToLatest(database);
      const inbox = new TelegramUpdateInbox(database);
      const before = await nativeClock(database);
      await inbox.accept(config.botIdentity, "1", {}, before);
      const abandoned = required(await inbox.claimNext(before));
      const reclaimed = required(
        await inbox.claimNext(new Date(before.getTime() + 60001)),
      );
      expect(
        await inbox.markProcessed(abandoned, before, {
          telegramUserId: "101",
          kind: "marketing_preference",
        }),
      ).toBe(false);
      expect(
        await inbox.markProcessed(reclaimed, before, {
          telegramUserId: "101",
          kind: "marketing_preference",
        }),
      ).toBe(true);
      expect(
        await inbox.markProcessed(reclaimed, before, {
          telegramUserId: "101",
          kind: "marketing_preference",
        }),
      ).toBe(false);
      expect(await inbox.accept(config.botIdentity, "1", {}, before)).toBe(
        "duplicate",
      );
      await inbox.accept(config.botIdentity, "2", {}, before);
      await inbox.markProcessed(
        required(await inbox.claimNext(before)),
        before,
      );
      await inbox.accept(config.botIdentity, "3", {}, before);
      await inbox.markFailed(
        required(await inbox.claimNext(before)),
        before,
        "test_failure",
      );
      const after = await nativeClock(database);
      const result = await new TelegramUserActivity(database, config).read({
        from: before.toISOString(),
        to: after.toISOString(),
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          accountIds: [],
          unlinkedContacts: 1,
          attribution: "current_confirmed_link",
          coverage: { status: "partial", continuity: "not_proven" },
        },
      });
      // Persistence rollback proof: a failed fact write cannot leave a successfully processed inbox.
      await inbox.accept(config.botIdentity, "4", {}, before);
      const item = required(await inbox.claimNext(before));
      await expect(
        inbox.markProcessed(item, before, {
          telegramUserId: "invalid-bigint",
          kind: "marketing_preference",
        }),
      ).rejects.toThrow();
      expect(
        await inbox.markProcessed(item, before, {
          telegramUserId: "102",
          kind: "marketing_preference",
        }),
      ).toBe(true);
    },
  );
});
it("uses only current confirmed owner links, isolates bots and deduplicates users across the Moscow boundary", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateToLatest(database);
      const native = await nativeClock(database);
      const moscow = new Date(native.getTime() + 3 * 3600000);
      const midnight = new Date(
        Date.UTC(
          moscow.getUTCFullYear(),
          moscow.getUTCMonth(),
          moscow.getUTCDate(),
        ) -
          3 * 3600000 -
          86400000,
      );
      await database
        .updateTable("telegram_activity_collection")
        .set({ started_at: new Date(midnight.getTime() - 1000) })
        .execute();
      const first = randomUUID(),
        second = randomUUID();
      const inbox = new TelegramUpdateInbox(database);
      async function fact(bot: string, id: string, user: string, at: Date) {
        await inbox.accept(bot, id, {}, at);
        const item = required(await inbox.claimNext(at));
        await inbox.markProcessed(item, at, {
          telegramUserId: user,
          kind: "marketing_preference",
        });
        // Controlled historical source boundary, not a historical reconstruction in production.
        await database
          .updateTable("telegram_user_activity")
          .set({ occurred_at: at })
          .where("bot_identity", "=", bot)
          .where("update_id", "=", id)
          .execute();
      }
      await fact(
        config.botIdentity,
        "10",
        "101",
        new Date(midnight.getTime() - 1),
      );
      await fact(config.botIdentity, "11", "101", midnight);
      await fact(config.botIdentity, "12", "102", midnight);
      await fact(
        config.botIdentity,
        "13",
        "103",
        new Date(midnight.getTime() + 1),
      );
      await fact("foreign-bot", "14", "104", midnight);
      await seedCommunityBinding(
        database,
        {
          accountRef: first,
          linkRef: randomUUID(),
          linkRevision: 1,
          telegramIdentityRef: randomUUID(),
        },
        new Date(midnight.getTime() - 1000),
        "101",
        config.botIdentity,
      );
      const activity = new TelegramUserActivity(database, config);
      const window = {
        from: new Date(midnight.getTime() - 1).toISOString(),
        to: new Date(midnight.getTime() + 1).toISOString(),
      };
      expect(await activity.read(window)).toMatchObject({
        ok: true,
        value: { accountIds: [first], unlinkedContacts: 1 },
      });
      // A later confirmed link changes current-link projection, without rewriting or fabricating past actions.
      await seedCommunityBinding(
        database,
        {
          accountRef: second,
          linkRef: randomUUID(),
          linkRevision: 1,
          telegramIdentityRef: randomUUID(),
        },
        midnight,
        "102",
        config.botIdentity,
      );
      const linked = await activity.read(window);
      expect(linked.ok).toBe(true);
      if (linked.ok) {
        expect(new Set(linked.value.accountIds)).toEqual(
          new Set([first, second]),
        );
        expect(linked.value.unlinkedContacts).toBe(0);
      }
      const retained = new Date(native.getTime() - 366 * 86400000);
      await fact(config.botIdentity, "15", "105", retained);
      await purgeExpiredRecords(database, native, {
        membershipCheckDays: 90,
        salesFunnelEventDays: 30,
      });
      expect(
        await activity.read({
          from: retained.toISOString(),
          to: new Date(retained.getTime() + 1).toISOString(),
        }),
      ).toEqual({ ok: false, error: { code: "outside_retention" } });
    },
  );
});

it("collects only actual committed private command outcomes through the real processor and authenticated runtime route", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      const app = await NestFactory.create<NestFastifyApplication>(
        AppModule.registerManaged(
          { ...config, senderRate: { requests: 1, windowMs: 10000 } },
          database,
          disabledTelegramObservability,
        ),
        new FastifyAdapter(),
        { logger: false },
      );
      try {
        await app.init();
        const at = await nativeClock(database);
        const inbox = app.get(TelegramUpdateInbox),
          processor = app.get(TelegramUpdateProcessor);
        async function send(id: number, user: number, text: string) {
          await inbox.accept(
            config.botIdentity,
            String(id),
            prepareTelegramUpdateForInbox(
              privateStartUpdate(id, user, { text }),
            ),
            at,
          );
          await processor.processAvailable(50, at);
        }
        await send(100, 101, "/stop");
        await send(101, 101, "/resume"); // Rate limited, no activity.
        await send(102, 103, "/unknown");
        await inbox.accept(
          config.botIdentity,
          "103",
          privateContactabilityUpdate(103, 104, "kicked"),
          at,
        );
        await processor.processAvailable(50, at);
        // An actual failed persistence write cannot be mistaken for domain success.
        await sql`alter table communication_preferences rename to activity_unavailable_preferences`.execute(
          database,
        );
        try {
          await send(104, 102, "/stop");
        } finally {
          await sql`alter table activity_unavailable_preferences rename to communication_preferences`.execute(
            database,
          );
        }
        await processor.processAvailable(50, new Date(at.getTime() + 1000));
        // Crash after the domain receipt commits, before inbox settlement: replay confirms it once.
        await inbox.accept(
          config.botIdentity,
          "105",
          prepareTelegramUpdateForInbox(
            privateStartUpdate(105, 105, { text: "/stop" }),
          ),
          at,
        );
        await inbox.claimNext(at);
        await app.get(BotContacts).observeStart(
          {
            botIdentity: config.botIdentity,
            updateId: "105",
            telegramUserId: "105",
            privateChatId: "105",
            observedAt: at,
          },
          "none",
        );
        await app.get(MarketingEntry).setPreference(
          {
            botIdentity: config.botIdentity,
            updateId: "105",
            telegramUserId: "105",
            privateChatId: "105",
            observedAt: at,
          },
          false,
        );
        await processor.processAvailable(50, new Date(at.getTime() + 60001));
        const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
        const request = async (authorization: string | undefined) => {
          const to = await nativeClock(database);
          return fastify.inject({
            method: "POST",
            url: "/integrations/platform/v1/participant-activity",
            headers: authorization === undefined ? {} : { authorization },
            payload: {
              contractVersion: "inside.telegram-activity.v1",
              from: at.toISOString(),
              to: to.toISOString(),
            },
          });
        };
        expect((await request(undefined)).statusCode).toBe(401);
        expect((await request("Bearer wrong")).statusCode).toBe(401);
        await vi.waitFor(
          async () => {
            const response = await request(
              `Bearer ${config.platformIntegrationSecret}`,
            );
            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
              ok: true,
              value: { accountIds: [], unlinkedContacts: 3 },
            });
          },
          { timeout: 1000, interval: 10 },
        );
      } finally {
        await app.close();
      }
    },
  );
});

it("does not count a repeated, expired or foreign sign-in decision as a fresh successful action", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateToLatest(database);
      const at = await nativeClock(database);
      const signin = new BotSignIn(
        database,
        { ...config, signInEnabled: true },
        { now: () => at },
      );
      const requestRef = randomUUID(),
        digest = digestSignInSecret("synthetic-start");
      expect(
        await signin.register({
          requestRef,
          startTokenDigest: digest,
          browserSecretDigest: digestSignInSecret("synthetic-browser"),
          expiresAt: new Date(at.getTime() + 300000),
        }),
      ).toMatchObject({ status: "registered" });
      await signin.acceptStart(
        {
          botIdentity: config.botIdentity,
          updateId: "1",
          telegramUserId: "101",
          privateChatId: "101",
          observedAt: at,
        },
        digest,
      );
      const decision = {
        botIdentity: config.botIdentity,
        telegramUserId: "101",
        privateChatId: "101",
        messageId: "99",
        requestRef,
        decision: "approve" as const,
      };
      const expiredRef = randomUUID();
      const expiredDigest = digestSignInSecret("synthetic-expired-start");
      expect(
        await signin.register({
          requestRef: expiredRef,
          startTokenDigest: expiredDigest,
          browserSecretDigest: digestSignInSecret("synthetic-expired-browser"),
          expiresAt: new Date(at.getTime() + 300000),
        }),
      ).toMatchObject({ status: "registered" });
      await signin.acceptStart(
        {
          botIdentity: config.botIdentity,
          updateId: "10",
          telegramUserId: "102",
          privateChatId: "102",
          observedAt: at,
        },
        expiredDigest,
      );
      const expired = new BotSignIn(
        database,
        { ...config, signInEnabled: true },
        { now: () => new Date(at.getTime() + 300001) },
      );
      const expiredDecision = {
        ...decision,
        requestRef: expiredRef,
        telegramUserId: "102",
        privateChatId: "102",
      };
      await expired.decide(expiredDecision, "11");
      expect(await expired.confirmedDecision(expiredDecision, "11")).toBe(
        false,
      );
      await signin.decide(decision, "2");
      expect(await signin.confirmedDecision(decision, "2")).toBe(true);
      await signin.decide(decision, "3");
      expect(await signin.confirmedDecision(decision, "3")).toBe(false);
      expect(
        await signin.confirmedDecision(
          { ...decision, telegramUserId: "102" },
          "2",
        ),
      ).toBe(false);
      expect(
        await signin.confirmedDecision({ ...decision, decision: "deny" }, "2"),
      ).toBe(false);
      expect(
        await signin.confirmedDecision(
          { ...decision, requestRef: randomUUID() },
          "2",
        ),
      ).toBe(false);
    },
  );
});
it("reports overflow and unavailable collection metadata as UNKNOWN instead of truncating to a plausible zero", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateToLatest(database);
      const at = await nativeClock(database);
      const before = new Date(at.getTime() - 1000);
      const activity = new TelegramUserActivity(database, config);
      expect(
        await activity.read({
          from: new Date(at.getTime() - 2000).toISOString(),
          to: before.toISOString(),
        }),
      ).toEqual({ ok: false, error: { code: "outside_collection" } });
      await database
        .updateTable("telegram_activity_collection")
        .set({ started_at: new Date(at.getTime() - 2000) })
        .execute();
      await sql`insert into telegram_user_activity(bot_identity,update_id,telegram_user_id,kind,occurred_at)
    select ${config.botIdentity},n,n,'marketing_preference',${before} from generate_series(1,10001) n`.execute(
        database,
      );
      const window = { from: before.toISOString(), to: at.toISOString() };
      expect(await activity.read(window)).toEqual({
        ok: false,
        error: { code: "source_budget_exceeded" },
      });
      await database.deleteFrom("telegram_activity_collection").execute();
      expect(await activity.read(window)).toEqual({
        ok: false,
        error: { code: "source_unavailable" },
      });
    },
  );
});

async function nativeClock(database: Database): Promise<Date> {
  const result = await sql<{
    now: Date;
  }>`select clock_timestamp() as now`.execute(database);
  return required(result.rows[0]).now;
}

it("physically purges bounded365-day analytics batches by native clock and preserves recent actions even with a fast application clock", async () => {
  await withMigrationDatabase(
    databaseUrl,
    `activity_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateToLatest(database);
      const at = await nativeClock(database),
        old = new Date(at.getTime() - 366 * 86400000);
      await sql`insert into telegram_user_activity(bot_identity,update_id,telegram_user_id,kind,occurred_at)
      select ${config.botIdentity},n,n,'marketing_preference',${old} from generate_series(1,1001) n`.execute(
        database,
      );
      await sql`insert into telegram_user_activity(bot_identity,update_id,telegram_user_id,kind,occurred_at)
      values (${config.botIdentity},1002,1002,'marketing_preference',${at})`.execute(
        database,
      );
      const fastClock = new Date(at.getTime() + 4000 * 86400000),
        periods = { membershipCheckDays: 90, salesFunnelEventDays: 30 };
      expect(await purgeExpiredRecords(database, fastClock, periods)).toBe(
        1000,
      );
      expect(await purgeExpiredRecords(database, fastClock, periods)).toBe(1);
      expect(await purgeExpiredRecords(database, fastClock, periods)).toBe(0);
      await vi.waitFor(
        async () => {
          expect(
            await new TelegramUserActivity(database, config).read({
              from: at.toISOString(),
              to: (await nativeClock(database)).toISOString(),
            }),
          ).toMatchObject({ ok: true, value: { unlinkedContacts: 1 } });
        },
        { timeout: 1000, interval: 10 },
      );
    },
  );
});
