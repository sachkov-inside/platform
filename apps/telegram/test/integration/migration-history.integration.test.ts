import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { hasText } from "../../src/shared/text.js";
import { communicationFunnelsMigration } from "../../src/database/migrations/011-communication-funnels.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Migration } from "kysely/migration";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import {
  migrateDown,
  migrateTo,
  migrateToLatest,
} from "../../src/database/migrator.js";
import { botSignInMigration } from "../../src/database/migrations/008-bot-sign-in.js";
import { signInReservationMigration } from "../../src/database/migrations/009-sign-in-reservation.js";
import { communicationsTemplatesMigration } from "../../src/database/migrations/010-communications-templates.js";
import { signInMessageResultMigration } from "../../src/database/migrations/010-sign-in-message-result.js";
import { CommunityRestrictions } from "../../src/modules/community/community-restrictions.js";
import { TelegramUpdateInbox } from "../../src/modules/update-inbox/telegram-update-inbox.js";
import { digest } from "../../src/security/payload-digest.js";
import {
  currentMigrationNames,
  legacyMigrationNames,
} from "../support/migration-history-ledgers.js";
import {
  canonicalJoinRequestUpdate,
  canonicalMembershipUpdate,
  canonicalProviderMembershipUpdate,
  privateContactabilityUpdate,
  privateStartUpdate,
} from "../support/synthetic-telegram-updates.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl))
  throw new Error("DATABASE_URL is required for integration tests");
const database = createDatabase(databaseUrl);
beforeAll(() => migrateToLatest(database));
let historicalStep = 0;
beforeEach(async () => {
  await migrateTo(database, "007-owner-identity-recovery");
  // The retained deployment precedes historical steps and Kysely's fixed-time upgrades.
  const deployedAt = new Date(fixedTestInstant() - 1000).toISOString();
  await sql`update kysely_migration set timestamp = ${deployedAt}`.execute(
    database,
  );
  historicalStep = 0;
});
afterAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixedTestInstant());
  try {
    await migrateToLatest(database);
  } finally {
    vi.useRealTimers();
    await database.destroy();
  }
});

// Reconstruct the real pre-merge histories using their unchanged migrations and ledger keys.
async function applyHistorical(
  name: string,
  migration: Migration,
): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await migration.up(transaction);
    const appliedAt = new Date(
      fixedTestInstant() - 500 + historicalStep++,
    ).toISOString();
    await sql`insert into kysely_migration (name, timestamp) values (${name}, ${appliedAt})`.execute(
      transaction,
    );
  });
}

async function migrationLedger() {
  const result = await sql<{ name: string; timestamp: string }>`
    select name, timestamp from kysely_migration order by name
  `.execute(database);
  return result.rows;
}

async function assertMiniAppColumns(present: boolean) {
  const columns = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'sign_in_requests'
      and column_name in ('source', 'mini_app_proof_digest', 'mini_app_oidc_context_digest',
        'mini_app_launch_browser_digest', 'mini_app_bound_at')
    order by column_name
  `.execute(database);
  expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
    present
      ? [
          "mini_app_bound_at",
          "mini_app_launch_browser_digest",
          "mini_app_oidc_context_digest",
          "mini_app_proof_digest",
          "source",
        ]
      : [],
  );
}

it.each(["communications-first", "sign-in-first"] as const)(
  "preserves existing data and supports down/latest after %s deployment",
  async (history) => {
    const identity = randomUUID();
    if (history === "communications-first") {
      await applyHistorical(
        "010-communications-templates",
        communicationsTemplatesMigration,
      );
      await applyHistorical(
        "011-communication-funnels",
        communicationFunnelsMigration,
      );
      await database
        .insertInto("communication_templates")
        .values({
          template_id: identity,
          bot_identity: "synthetic",
          owner_account_ref: "synthetic-account",
          revision: 1,
          content: JSON.stringify({ text: "preserved" }),
          created_at: new Date(fixedTestInstant()),
          updated_at: new Date(fixedTestInstant()),
        })
        .execute();
    } else {
      await applyHistorical("008-bot-sign-in", botSignInMigration);
      await applyHistorical(
        "009-sign-in-reservation",
        signInReservationMigration,
      );
      await applyHistorical(
        "010-sign-in-message-result",
        signInMessageResultMigration,
      );
      await database
        .insertInto("sign_in_subjects")
        .values({
          subject_ref: identity,
          bot_identity: "synthetic",
          telegram_user_id: "42",
          reserved_for_sign_in: true,
        })
        .execute();
    }
    const assertPreserved = async () => {
      if (history === "communications-first") {
        expect(
          await database
            .selectFrom("communication_templates")
            .select(["content", "revision"])
            .where("template_id", "=", identity)
            .executeTakeFirst(),
        ).toEqual({ content: { text: "preserved" }, revision: 1 });
      } else {
        expect(
          await database
            .selectFrom("sign_in_subjects")
            .select("reserved_for_sign_in")
            .where("subject_ref", "=", identity)
            .executeTakeFirst(),
        ).toEqual({ reserved_for_sign_in: true });
      }
      expect(
        await database
          .selectFrom("sign_in_requests")
          .select([
            "request_ref",
            "bot_identity",
            "start_token_digest",
            "browser_secret_digest",
            "state",
            "confirmation_code",
          ])
          .where("request_ref", "=", identity)
          .executeTakeFirst(),
      ).toEqual({
        request_ref: identity,
        bot_identity: "synthetic-history",
        start_token_digest: "a".repeat(43),
        browser_secret_digest: "b".repeat(43),
        state: "pending",
        confirmation_code: "123456",
      });
    };
    // Complete the exact retained ledger first;031 is a separate forward step.
    await migrateTo(database, "030-invitation-redemptions");
    await database
      .insertInto("sign_in_requests")
      .values({
        request_ref: identity,
        bot_identity: "synthetic-history",
        start_token_digest: "a".repeat(43),
        browser_secret_digest: "b".repeat(43),
        confirmation_code: "123456",
        state: "pending",
        created_at: new Date(fixedTestInstant()),
        expires_at: new Date(fixedTestInstant() + 60_000),
      })
      .execute();
    const retained = await migrationLedger();
    expect(retained.map(({ name }) => name)).toEqual(legacyMigrationNames);
    expect(retained).toHaveLength(31);
    await assertMiniAppColumns(false);
    await assertPreserved();
    await migrateToLatest(database);
    const upgraded = await migrationLedger();
    expect(upgraded.map(({ name }) => name)).toEqual(currentMigrationNames);
    expect(
      upgraded.filter(({ name }) => name !== "031-mini-app-sign-in"),
    ).toEqual(retained);
    await assertMiniAppColumns(true);
    expect(
      await database
        .selectFrom("sign_in_requests")
        .select([
          "source",
          "mini_app_proof_digest",
          "mini_app_oidc_context_digest",
          "mini_app_launch_browser_digest",
          "mini_app_bound_at",
        ])
        .where("request_ref", "=", identity)
        .executeTakeFirst(),
    ).toEqual({
      source: "bot",
      mini_app_proof_digest: null,
      mini_app_oidc_context_digest: null,
      mini_app_launch_browser_digest: null,
      mini_app_bound_at: null,
    });
    await assertPreserved();
    await migrateDown(database);
    expect(await migrationLedger()).toEqual(retained);
    await assertMiniAppColumns(false);
    await assertPreserved();
    await migrateToLatest(database);
    const reapplied = await migrationLedger();
    expect(reapplied.map(({ name }) => name)).toEqual(currentMigrationNames);
    expect(
      reapplied.filter(({ name }) => name !== "031-mini-app-sign-in"),
    ).toEqual(retained);
    await assertMiniAppColumns(true);
    await assertPreserved();
    await migrateToLatest(database);
    await assertPreserved();
    await assertMiniAppColumns(true);
    expect(await migrationLedger()).toEqual(reapplied);
    const ledger = await sql<{
      count: string;
    }>`select count(*) from kysely_migration`.execute(database);
    expect(ledger.rows[0]?.count).toBe("32");
    const applied = (await migrationLedger()).map(({ name }) => name);
    expect(applied).toEqual(currentMigrationNames);
  },
);

it("preserves legacy restriction receipts without inventing an audit during upgrade", async () => {
  await migrateTo(database, "020-community-effect-provenance");
  const input = {
    operationId: randomUUID(),
    botIdentity: "synthetic-legacy",
    accountRef: "opaque-legacy-account",
    identityRef: "opaque-legacy-identity",
    expectedRevision: 1,
    action: "restore" as const,
    actorRef: "synthetic-owner",
    reason: "Legacy decision",
  };
  const now = new Date(fixedTestInstant());
  await sql`insert into community_restriction_decisions
    (operation_id, fingerprint, actor_ref, reason, created_at)
    values (${input.operationId}, ${digest(input)}, ${input.actorRef}, ${input.reason}, ${now})`.execute(
    database,
  );
  await migrateToLatest(database);
  const read = () =>
    database
      .selectFrom("community_restriction_decisions")
      .selectAll()
      .where("operation_id", "=", input.operationId)
      .executeTakeFirstOrThrow();
  const historical = await read();
  expect(historical.audit).toBeNull();
  const decisions = new CommunityRestrictions(database, { now: () => now });
  expect(await decisions.decide(input, true)).toBe("duplicate");
  expect(await decisions.decide({ ...input, reason: "Changed" }, true)).toBe(
    "conflict",
  );
  expect(await read()).toEqual(historical);
  await migrateDown(database);
  await migrateToLatest(database);
  expect(await read()).toEqual(historical);
});

it.each([
  "009-sign-in-reservation",
  "011-communication-funnels",
  "012-marketing-preferences",
  "013-broadcast-analytics",
  "014-author-admin",
  "015-author-drafts",
])(
  "still rejects missing dependencies for %s at every entrypoint",
  async (migrationName) => {
    await sql`insert into kysely_migration (name, timestamp) values (${migrationName}, ${new Date(fixedTestInstant()).toISOString()})`.execute(
      database,
    );
    try {
      await expect(migrateToLatest(database)).rejects.toThrow(
        "Database migration failed",
      );
      await expect(migrateDown(database)).rejects.toThrow(
        "Database rollback failed",
      );
      await expect(
        migrateTo(database, "007-owner-identity-recovery"),
      ).rejects.toThrow("Database migration to");
    } finally {
      await sql`delete from kysely_migration where name = ${migrationName}`.execute(
        database,
      );
    }
  },
);

it("gives waiting updates the same lane during upgrade as the inbox gives new ones", async () => {
  const payloads: ({ update_id: number } & Record<string, unknown>)[] = [
    canonicalMembershipUpdate(1, -100, 42, "member"),
    canonicalProviderMembershipUpdate(2, -100, 999, "administrator"),
    canonicalJoinRequestUpdate(3, -100, 43),
    privateContactabilityUpdate(4, 44, "kicked"),
    privateStartUpdate(5, 45),
    {
      update_id: 6,
      callback_query: {
        id: "6",
        from: { id: 46, is_bot: false },
        message: { chat: { id: 46, type: "private" }, message_id: 1 },
        data: "synthetic",
      },
    },
    { update_id: 7 },
  ];
  const lanes = () =>
    database
      .selectFrom("telegram_updates")
      .select(["update_id", "lane_key"])
      .orderBy("update_id")
      .execute();
  const receivedAt = new Date("2026-09-25T10:00:00.000Z");

  await migrateTo(database, "024-membership-check-retention");
  await sql`truncate telegram_updates`.execute(database);
  for (const payload of payloads)
    await sql`insert into telegram_updates
      (bot_identity, update_id, payload, state, received_at, available_at)
      values ('inside', ${payload.update_id}, ${JSON.stringify(payload)}::jsonb,
        'pending', ${receivedAt}, ${receivedAt})`.execute(database);
  await migrateToLatest(database);
  const upgraded = await lanes();

  await sql`truncate telegram_updates`.execute(database);
  const inbox = new TelegramUpdateInbox(database);
  for (const payload of payloads)
    await inbox.accept(
      "inside",
      String(payload.update_id),
      payload,
      receivedAt,
    );

  expect(upgraded).toEqual(await lanes());
  expect(upgraded.map((row) => row.lane_key)).toEqual([
    "-100",
    "-100",
    "-100",
    "44",
    "45",
    "46",
    null,
  ]);
});
