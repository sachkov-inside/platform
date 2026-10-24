import { loadApplicationConfig } from "../../src/config/application-config.js";
import { AuthorAdmin } from "../../src/modules/communications/author-admin.js";
import { Communications } from "../../src/modules/communications/communications.js";
import { CommunicationSequences } from "../../src/modules/communications/communication-sequences.js";
import { AuthorDelivery } from "../../src/modules/communications/author-delivery.js";
import type { AuthorAuthorization } from "../../src/modules/communications/author-authorization.js";
import type { AuthorContentValidation } from "../../src/modules/communications/author-content-validation.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import {
  parseAuthorState,
  resolveAuthorCallback,
} from "../../src/modules/communications/author-dialog.js";
import { transition } from "../../src/modules/communications/author-transition.js";
import {
  migrationDatabaseLifecycleBudgetMilliseconds,
  createMigrationDatabase,
  type MigrationDatabaseFixture,
} from "../support/migration-database.js";
import type { Database } from "../../src/database/database.js";
import { required } from "../support/required.js";

describe("historical active author dialog", () => {
  const original = {
    version: 1,
    token: "preserved-token",
    actions: [{ kind: "batch:done" }],
    batch: "funnel",
    libraryQuery: "funnel is authored search text",
    funnelAuthor: {
      target: "entry",
      dirty: true,
      funnel: {
        funnelId: randomUUID(),
        name: "Preserved draft",
        isDefault: false,
        revision: 3,
        publishedRevision: 2,
        lifecycle: "published",
        sources: [],
        steps: [],
        entryResponse: { stepId: randomUUID(), parts: [] },
      },
    },
  };
  const abort = new AbortController();
  let fixture: MigrationDatabaseFixture | undefined;
  let acquisition: Promise<MigrationDatabaseFixture> | undefined;
  let database: Database;
  // Suite cleanup is registered before acquisition and joins cancellation even after a hook timeout.
  afterAll(async () => {
    abort.abort(new Error("Author migration fixture cleanup"));
    const acquired = fixture ?? (await acquisition?.catch(() => undefined));
    await acquired?.close();
  }, migrationDatabaseLifecycleBudgetMilliseconds);
  // Keep historical preparation outside the unchanged business-case deadline.
  beforeAll(async () => {
    acquisition = createMigrationDatabase(
      required(process.env["DATABASE_URL"]),
      `author_contract_${randomUUID().replaceAll("-", "")}`,
      { signal: abort.signal },
    );
    fixture = await acquisition;
    database = fixture.database;
  }, migrationDatabaseLifecycleBudgetMilliseconds);
  beforeAll(async () => {
    await migrateTo(database, "036-material-announcements");
  });
  beforeAll(async () => {
    await sql`insert into communication_author_sessions(bot_identity,telegram_user_id,account_ref,state) values('fixture',42,'author',${JSON.stringify(original)}::jsonb)`.execute(
      database,
    );
  });
  beforeAll(async () => {
    await migrateToLatest(database);
  });
  it("upgrades an active historical batch dialog without resetting its draft or changing original archived state", async () => {
    const row = await database
      .selectFrom("communication_author_sessions")
      .select("state")
      .executeTakeFirstOrThrow();
    const state = parseAuthorState(row.state);
    expect(state?.batch).toBe("sequence");
    if (!state) throw new Error("Active dialog must remain resumable");
    expect(state.token).toBe(original.token);
    expect(resolveAuthorCallback(state, "author:preserved-token:0")).toEqual({
      kind: "batch:done",
    });
    const content = {
      type: "text",
      text: "Next message",
      entities: [],
      buttons: [],
    };
    const resumed = transition(
      state,
      { kind: "text", text: content.text, content },
      {
        now: new Date("2026-10-24T05:00:00Z"),
        newId: randomUUID,
        pendingCompositions: new Set(),
      },
    );
    expect(resumed.state.batch).toBe("sequence");
    expect(
      resumed.state.sequenceAuthor?.sequence?.entryResponse.parts,
    ).toMatchObject([{ content }]);
    expect(resumed.state.libraryQuery).toBe(original.libraryQuery);
    const archive = await sql<{
      original: { state: unknown };
    }>`select original from communication_historical_author_state where source_table='communication_author_sessions'`.execute(
      database,
    );
    expect(archive.rows[0]?.original.state).toEqual(original);
  });
});

describe.each(["done", "message", "broadcast-done"] as const)(
  "historical AuthorAdmin %s fixture",
  (mode) => {
    const sequenceId = randomUUID();
    const content = {
      type: "text" as const,
      text: "Original funnel authored text",
      entities: [],
      buttons: [],
    };
    const draft = {
      funnelId: sequenceId,
      name: "Preserved draft",
      isDefault: false,
      sources: [],
      steps: [],
      entryResponse: {
        stepId: randomUUID(),
        parts: [{ partId: randomUUID(), content }],
      },
    };
    const broadcast = {
      broadcastId: randomUUID(),
      revision: 1,
      state: "draft",
      parts: [{ partId: randomUUID(), content }],
      audience: { kind: "all" },
      scheduledAt: null,
      audienceSnapshotId: null,
      snapshotSize: 0,
    };
    const original = {
      version: 1,
      token: "original-menu",
      actions: [{ kind: "batch:done" }],
      batch: mode === "broadcast-done" ? "broadcast" : "funnel",
      libraryQuery: "literal funnel and series",
      ...(mode === "broadcast-done"
        ? { broadcast }
        : {
            funnelAuthor: {
              target: "entry",
              dirty: true,
              funnel: {
                ...draft,
                revision: 3,
                publishedRevision: null,
                lifecycle: "draft",
              },
            },
          }),
    };
    const abort = new AbortController();
    let fixture: MigrationDatabaseFixture | undefined;
    let acquisition: Promise<MigrationDatabaseFixture> | undefined;
    let database: Database;
    // Suite cleanup is registered before acquisition and joins cancellation even after a hook timeout.
    afterAll(async () => {
      abort.abort(new Error("Author migration fixture cleanup"));
      const acquired = fixture ?? (await acquisition?.catch(() => undefined));
      await acquired?.close();
    }, migrationDatabaseLifecycleBudgetMilliseconds);
    // Keep historical preparation outside the unchanged business-case deadline.
    beforeAll(async () => {
      acquisition = createMigrationDatabase(
        required(process.env["DATABASE_URL"]),
        `author_public_${randomUUID().replaceAll("-", "")}`,
        { signal: abort.signal },
      );
      fixture = await acquisition;
      database = fixture.database;
    }, migrationDatabaseLifecycleBudgetMilliseconds);
    beforeAll(async () => {
      await migrateTo(database, "036-material-announcements");
    });
    beforeAll(async () => {
      await sql`insert into communication_author_sessions(bot_identity,telegram_user_id,account_ref,state) values('fixture',42,'author',${JSON.stringify(original)}::jsonb)`.execute(
        database,
      );
      await sql`insert into communication_funnels(funnel_id,bot_identity,owner_account_ref,revision,published_revision,lifecycle,draft,is_default) values(${sequenceId}::uuid,'fixture','author',3,null,'draft',${JSON.stringify(draft)}::jsonb,false)`.execute(
        database,
      );
      await sql`insert into link_transactions(account_ref,bot_identity,candidate_telegram_user_id,confirmed_at,expires_at,link_transaction_ref,received_at,registered_at,return_correlation,state,token_digest) values('author','fixture',42,now(),now(),'link',now(),now(),'return','linked',${"a".repeat(43)})`.execute(
        database,
      );
      await sql`insert into platform_links(bot_identity,telegram_user_id,account_ref,telegram_identity_ref,link_transaction_ref,linked_at,evidence_version) values('fixture',42,'author','identity','link',now(),0)`.execute(
        database,
      );
    });
    beforeAll(async () => {
      await migrateToLatest(database);
    });
    it(`fresh AuthorAdmin resumes the original persisted ${mode} update after migration`, async () => {
      const config = loadApplicationConfig({
        DATABASE_URL: required(process.env["DATABASE_URL"]),
        TELEGRAM_BOT_IDENTITY: "fixture",
        TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
        TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
        PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
        PLATFORM_COMMUNICATIONS_SECRET:
          "synthetic_communications_secret_for_tests",
        TELEGRAM_WELCOME_TEXT: "Welcome",
        TELEGRAM_LINK_RECEIPT_TEXT: "Receipt",
        TELEGRAM_LINKED_MEMBER_TEXT: "Member",
        TELEGRAM_LINKED_NON_MEMBER_TEXT: "Nonmember",
        TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Unavailable",
        WORKERS_ENABLED: "false",
      });
      const authorization: AuthorAuthorization = {
        authorize: () => Promise.resolve("allowed"),
      };
      const validation: AuthorContentValidation = {
        validate: () => Promise.resolve({ status: "ok", targetErrors: [] }),
      };
      const posts = new Communications(database, config, authorization);
      const sequences = new CommunicationSequences(
        database,
        config,
        authorization,
        { now: () => new Date("2026-10-24T05:00:00Z") },
        validation,
      );
      const delivery = new AuthorDelivery(database, config, authorization, {
        send: () => {
          return Promise.reject(
            new Error("Author continuation must not send provider messages"),
          );
        },
      });
      const admin = new AuthorAdmin(
        database,
        config,
        authorization,
        posts,
        sequences,
        delivery,
        validation,
      );
      expect(
        await admin.handle({
          botIdentity: "fixture",
          updateId: "100",
          telegramUserId: "42",
          privateChatId: "42",
          text: mode === "message" ? "Next message" : "",
          content:
            mode === "message" ? { ...content, text: "Next message" } : null,
          ...(mode === "message"
            ? {}
            : {
                callbackData: "author:original-menu:0",
                callbackQueryId: "100",
              }),
        }),
      ).toBe(true);
      const row = await database
        .selectFrom("communication_author_sessions")
        .select("state")
        .executeTakeFirstOrThrow();
      const state = parseAuthorState(row.state);
      expect(state?.libraryQuery).toBe(original.libraryQuery);
      if (mode === "broadcast-done") {
        expect(state?.batch).toBeUndefined();
        expect(state?.broadcast).toEqual(broadcast);
      } else {
        expect(state?.sequenceAuthor?.sequence?.sequenceId).toBe(sequenceId);
        if (mode === "message") {
          expect(state?.batch).toBe("sequence");
          expect(
            state?.sequenceAuthor?.sequence?.entryResponse.parts.map(
              (p) => p.content.text,
            ),
          ).toEqual([content.text, "Next message"]);
        } else {
          expect(state?.batch).toBeUndefined();
          expect(state?.sequenceAuthor?.sequence?.revision).toBe(4);
        }
      }
      expect(
        await database
          .selectFrom("communication_author_receipts")
          .selectAll()
          .execute(),
      ).toHaveLength(1);
      const archive = await sql<{
        original: { state: unknown };
      }>`select original from communication_historical_author_state where source_table='communication_author_sessions'`.execute(
        database,
      );
      expect(archive.rows[0]?.original.state).toEqual(original);
    });
  },
);
