import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { groupReportCandidates } from "../../src/operations/group-report-candidates.js";
import { runGroupMembersReport } from "../../src/operations/group-members-report-command.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasText } from "../../src/shared/text.js";
import { seedCommunityBinding } from "../support/community-binding.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) throw new Error("DATABASE_URL is required");
let database: Database;
const now = new Date("2026-10-08T10:00:00Z");

beforeAll(async () => {
  database = createDatabase(databaseUrl);
  await migrateToLatest(database);
});
beforeEach(async () => {
  await sql`truncate bot_contacts, community_bindings, platform_links, link_transactions restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await database.destroy();
});

it("reports distinct known people of this bot and uses only current links", async () => {
  await seedCommunityBinding(
    database,
    {
      accountRef: "00000000-0000-4000-8000-000000000001",
      telegramIdentityRef: "current-identity",
      linkRef: "00000000-0000-4000-8000-000000000003",
      linkRevision: 1,
    },
    now,
    "101",
  );
  await seedCommunityBinding(
    database,
    {
      accountRef: "other-account",
      telegramIdentityRef: "other-identity",
      linkRef: "00000000-0000-4000-8000-000000000004",
      linkRevision: 1,
    },
    now,
    "999",
    "other-bot",
  );
  await database
    .insertInto("bot_contacts")
    .values({
      bot_identity: "inside",
      telegram_user_id: "102",
      private_chat_id: "102",
      contactability: "blocked",
      first_started_at: now,
      last_started_at: now,
      updated_at: now,
    })
    .execute();
  await database
    .insertInto("community_bindings")
    .values([
      {
        bot_identity: "inside",
        account_ref: "former-account",
        telegram_identity_ref: "former-identity",
        link_ref: "00000000-0000-4000-8000-000000000002",
        link_revision: 1,
        telegram_user_id: "103",
        first_seen_at: now,
        last_seen_at: now,
      },
      {
        bot_identity: "inside",
        account_ref: "00000000-0000-4000-8000-000000000001",
        telegram_identity_ref: "current-identity",
        link_ref: "00000000-0000-4000-8000-000000000003",
        link_revision: 1,
        telegram_user_id: "101",
        first_seen_at: now,
        last_seen_at: now,
      },
    ])
    .execute();
  const candidates = await groupReportCandidates(database, "inside");
  expect(candidates).toEqual([
    {
      telegramUserId: "101",
      accountRef: "00000000-0000-4000-8000-000000000001",
      identityRef: "current-identity",
    },
    { telegramUserId: "102", accountRef: null, identityRef: null },
    { telegramUserId: "103", accountRef: null, identityRef: null },
  ]);
  const directory = await mkdtemp(join(tmpdir(), "telegram-979-command-"));
  const output = join(directory, "report.json");
  try {
    await runGroupMembersReport({
      database,
      botIdentity: "inside",
      canonicalChatId: "-1001",
      output,
      platformEndpoint:
        "https://platform.invalid/community-entitlements/members-without-right",
      operatorToken: "synthetic-operator",
      fetcher: () =>
        Promise.resolve(
          Response.json({
            checkedAt: now.toISOString(),
            truncated: false,
            items: [
              {
                accountId: "00000000-0000-4000-8000-000000000001",
                telegramIdentityRef: "current-identity",
                observedAt: now.toISOString(),
              },
            ],
          }),
        ),
      telegram: {
        getBotChatMember: () =>
          Promise.resolve({
            kind: "observed",
            value: { status: "administrator" },
          }),
        getChatMember: () =>
          Promise.resolve({ kind: "observed", value: { status: "member" } }),
      },
    });
    const report: unknown = JSON.parse(await readFile(output, "utf8"));
    expect(report).toMatchObject({
      coverage: "known_ids_only",
      candidatesChecked: 3,
      items: [
        {
          telegramUserId: "101",
          category: "without_right",
          accountRef: "00000000-0000-4000-8000-000000000001",
        },
        { telegramUserId: "102", category: "without_link", accountRef: null },
        { telegramUserId: "103", category: "without_link", accountRef: null },
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
