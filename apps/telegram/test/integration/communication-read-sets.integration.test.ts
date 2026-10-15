import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
  describe,
} from "vitest";
import type { Database, DatabaseSchema } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import {
  readStatistics,
  readEntries,
} from "../../src/modules/communications/communication-statistics.js";
import {
  COMMUNICATIONS_VERSION,
  type CommunicationsRequest,
} from "../../src/modules/communications/communications-contract.js";
import { required } from "../support/required.js";

import { AuthorBroadcastDrafts } from "../../src/modules/communications/author-broadcast-drafts.js";
import { AuthorFunnelDrafts } from "../../src/modules/communications/author-funnel-drafts.js";
import type { Context } from "../../src/modules/communications/author-admin.js";
import { Funnels } from "../../src/modules/communications/funnels.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";

let entryStatements: string[] = [];
let communicationStatements: string[] = [];
let database: Database;
let databaseCreated = false;
let owner: Pool | undefined;
let ownedDatabaseName: string | undefined;
const instant = new Date("2030-01-01T00:00:00Z");
const request: CommunicationsRequest = {
  contractVersion: COMMUNICATIONS_VERSION,
  operationId: "00000000-0000-4000-8000-000000000001",
  actor: { accountRef: "author" },
  operation: "statistics.read",
  expectedRevision: 0,
  payload: {},
};
beforeAll(async () => {
  const databaseUrl = new URL(required(process.env["DATABASE_URL"]));
  owner = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
  const name = `communication_read_sets_${randomUUID().replaceAll("-", "")}`;
  await owner.query(`CREATE DATABASE ${name}`);
  // Ownership begins only after CREATE succeeds; a failed acquisition cannot remove another database.
  ownedDatabaseName = name;
  databaseUrl.pathname = `/${name}`;
  database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl.toString(),
      }),
    }),
    log(event) {
      if (
        event.level === "query" &&
        event.query.sql.trimStart().toLowerCase().startsWith("select")
      )
        communicationStatements.push(event.query.sql);
      if (
        event.level === "query" &&
        event.query.sql.includes("communication_entries")
      )
        entryStatements.push(event.query.sql);
    },
  });
  databaseCreated = true;
  await migrateToLatest(database);
});
beforeEach(async () => {
  entryStatements = [];
  communicationStatements = [];
  await sql`truncate communication_contacts, bot_contacts, communication_author_drafts, communication_funnels, communication_broadcasts, communication_operations cascade`.execute(
    database,
  );
});
afterAll(async () => {
  try {
    if (databaseCreated) await database.destroy();
  } finally {
    try {
      if (ownedDatabaseName !== undefined)
        await owner?.query(`DROP DATABASE ${ownedDatabaseName} WITH (FORCE)`);
    } finally {
      await owner?.end();
    }
  }
});

describe.each([0, 1, 100, 101])(
  "statistics with %i equal-time entries per contact",
  (entries) => {
    beforeEach(async () => {
      await sql`insert into bot_contacts(bot_identity,telegram_user_id,private_chat_id,contactability,first_started_at,last_started_at,updated_at)
    select 'inside', n, n, 'reachable', ${instant}, ${instant}, ${instant} from generate_series(1,100) n`.execute(
        database,
      );
      await sql`insert into communication_contacts(contact_id,bot_identity,telegram_user_id,marketing_enabled)
    select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'inside', n, true from generate_series(1,100) n`.execute(
        database,
      );
      await sql`insert into communication_entries(bot_identity,update_id,contact_id,funnel_id,source_id,source_code,entered_at,outcome)
    select 'inside', c.telegram_user_id*1000+e, c.contact_id, null,
      ('10000000-0000-4000-8000-' || lpad(e::text,12,'0'))::uuid, 'source-'||e, ${instant}, 'enrolled'
    from communication_contacts c cross join generate_series(1,${entries}::int) e`.execute(
        database,
      );
    });
    it("keeps independent 100-contact histories and cursors in one set read", async () => {
      entryStatements = [];
      const result = await database
        .transaction()
        .execute((tx) => readStatistics(tx, request, "inside", "author"));
      expect(entryStatements).toHaveLength(1);
      expect(result.statistics.contacts).toHaveLength(100);
      for (const contact of result.statistics.contacts) {
        expect(contact.entries).toHaveLength(Math.min(entries, 100));
        expect(contact.firstSourceId).toBe(
          entries === 0 ? null : "10000000-0000-4000-8000-000000000001",
        );
        expect(contact.latestSourceId).toBe(
          entries === 0
            ? null
            : `10000000-0000-4000-8000-${String(entries).padStart(12, "0")}`,
        );
        if (entries === 101) {
          expect(contact.nextEntryCursor).not.toBeNull();
          const continuation = await database.transaction().execute((tx) =>
            readEntries(
              tx,
              {
                ...request,
                payload: {
                  contactId: contact.contactId,
                  cursor: required(contact.nextEntryCursor),
                },
              },
              "inside",
              "author",
            ),
          );
          expect(continuation.entries).toEqual([
            {
              sourceId: "10000000-0000-4000-8000-000000000101",
              sourceCode: "source-101",
              funnelId: null,
              enteredAt: "2030-01-01T00:00:00.000Z",
              outcome: "enrolled",
            },
          ]);
          expect(continuation.nextCursor).toBeNull();
        } else expect(contact.nextEntryCursor).toBeNull();
      }
    });
  },
);

it.each(["funnel", "broadcast"] as const)(
  "reads the authorized author's %s list as sets with draft preference and complete cursors",
  async (kind) => {
    const databaseUrl = required(process.env["DATABASE_URL"]);
    const config = loadApplicationConfig({
      DATABASE_URL: databaseUrl,
      TELEGRAM_BOT_IDENTITY: "inside",
      TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
      TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
      PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
      TELEGRAM_WELCOME_TEXT: "welcome",
      TELEGRAM_LINK_RECEIPT_TEXT: "receipt",
      TELEGRAM_LINKED_MEMBER_TEXT: "member",
      TELEGRAM_LINKED_NON_MEMBER_TEXT: "nonmember",
      TELEGRAM_LINKED_UNAVAILABLE_TEXT: "unavailable",
      WORKERS_ENABLED: "false",
    });
    const authorization = {
      authorize: vi.fn(() => Promise.resolve("allowed" as const)),
    };
    const funnels = new Funnels(
      database,
      config,
      authorization,
      { now: () => instant },
      { validate: () => Promise.resolve({ status: "ok", targetErrors: [] }) },
    );
    const id = (index: number) =>
      `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    for (let index = 1; index <= 12; index++) {
      const draft = {
        funnelId: id(index),
        name: `Saved ${index}`,
        isDefault: false,
        sources: [],
        steps: [],
        entryResponse: {
          stepId: "30000000-0000-4000-8000-000000000001",
          parts: [],
        },
      };
      if (index !== 11) {
        if (kind === "funnel")
          await database
            .insertInto("communication_funnels")
            .values({
              funnel_id: id(index),
              bot_identity: "inside",
              owner_account_ref: index === 12 ? "other" : "author",
              revision: 1,
              published_revision: null,
              lifecycle: "draft",
              draft: JSON.stringify(draft),
              published: null,
              is_default: false,
            })
            .execute();
        else
          await database
            .insertInto("communication_broadcasts")
            .values({
              broadcast_id: id(index),
              bot_identity: "inside",
              owner_account_ref: index === 12 ? "other" : "author",
              revision: 1,
              state: "draft",
              parts: JSON.stringify([]),
              audience: JSON.stringify({ kind: "all" }),
              scheduled_at: null,
              audience_snapshot_id: null,
              snapshot_size: 0,
              launched_at: null,
              launch_operation_id: null,
              created_at: instant,
            })
            .execute();
      }
      if (index === 1 || index === 11)
        await database
          .insertInto("communication_author_drafts")
          .values({
            bot_identity: "inside",
            owner_account_ref: "author",
            draft_id: id(index),
            kind,
            name: `Edited ${index}`,
            snapshot: JSON.stringify(
              kind === "funnel"
                ? {
                    funnel: {
                      ...draft,
                      revision: 0,
                      lifecycle: "draft",
                      publishedRevision: null,
                    },
                    dirty: true,
                  }
                : {
                    broadcastId: id(index),
                    revision: 0,
                    state: "draft",
                    parts: [],
                    audience: { kind: "all" },
                    scheduledAt: null,
                    audienceSnapshotId: null,
                    snapshotSize: 0,
                  },
            ),
          })
          .execute();
    }
    const list =
      kind === "funnel"
        ? new AuthorFunnelDrafts(funnels)
        : new AuthorBroadcastDrafts(funnels);
    function context(tx: Context["tx"]): Context {
      return {
        tx,
        accountRef: "author",
        identityRef: "authorized-identity",
        input: {
          botIdentity: "inside",
          updateId: "1",
          telegramUserId: "42",
          privateChatId: "42",
          text: "",
          content: null,
        },
      };
    }
    communicationStatements = [];
    const first = await database
      .transaction()
      .execute(async (tx) => await list.list(context(tx), undefined));
    expect(first.items).toHaveLength(10);
    expect(first.items[0]?.name).toBe("Edited 1");
    expect(first.nextCursor).toBe(id(10));
    expect(communicationStatements.length).toBeLessThanOrEqual(3);
    // Context is the authorization established by AuthorAdmin; list reads must not authorize each item again.
    expect(authorization.authorize).not.toHaveBeenCalled();
    const second = await database
      .transaction()
      .execute(async (tx) => await list.list(context(tx), first.nextCursor));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.name).toBe("Edited 11");
    expect(second.nextCursor).toBeUndefined();
    const firstItem = required(first.items[0]);
    if ("broadcast" in firstItem) expect(firstItem.broadcast.revision).toBe(1);
  },
);
