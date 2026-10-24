import { BotContacts } from "../../src/modules/bot-contacts/bot-contacts.js";
import {
  StartResponseDeliveryQueue,
  replyStateCounts,
  hasDueReply,
  replyAttemptOutcomeCounts,
} from "../../src/modules/outbound/start-response-delivery-queue.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { closeIfStarted } from "../support/close-if-started.js";
import { hasText } from "../../src/shared/text.js";
import { createHash, randomUUID } from "node:crypto";

import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prepareTelegramUpdateForInbox } from "../../src/adapters/telegram/grammy-update.adapter.js";
import { HttpSalesFunnelAdapter } from "../../src/adapters/platform/http-sales-funnel.adapter.js";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import {
  COMMUNICATIONS_VERSION,
  type CommunicationsRequest,
} from "../../src/modules/communications/communications-contract.js";
import { AUTHOR_AUTHORIZATION } from "../../src/modules/communications/author-authorization.js";
import { AUTHOR_CONTENT_VALIDATION } from "../../src/modules/communications/author-content-validation.js";
import { COMMUNICATION_TRANSPORT } from "../../src/modules/communications/communication-delivery.js";
import type { CommunicationSequenceDraft } from "../../src/modules/communications/sequence-types.js";
import { CommunicationSequences } from "../../src/modules/communications/communication-sequences.js";
import { IdentityLinkRecovery } from "../../src/modules/identity-linking/identity-link-recovery.js";
import { IdentityLinking } from "../../src/modules/identity-linking/identity-linking.js";
import { TELEGRAM_CALLBACK_ANSWERS } from "../../src/modules/bot-sign-in/telegram-callback-answers.js";
import { TelegramUpdateInbox } from "../../src/modules/update-inbox/telegram-update-inbox.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { SALES_FUNNEL_DELIVERY } from "../../src/modules/sales-funnel/sales-funnel-delivery.js";
import { SalesFunnelDeliveryProcessor } from "../../src/modules/sales-funnel/sales-funnel-delivery-processor.js";
import {
  salesFunnelEventId,
  type SalesFunnelEvent,
} from "../../src/modules/sales-funnel/sales-funnel-events.js";
import { TELEGRAM_MESSAGES } from "../../src/modules/outbound/telegram-messages.js";
import { CLOCK } from "../../src/shared/clock.js";
import {
  startSalesFunnelPlatform,
  type SalesFunnelPlatform,
} from "../support/sales-funnel-platform.js";
import { privateStartUpdate } from "../support/synthetic-telegram-updates.js";
import {
  createMigrationDatabase,
  type MigrationDatabaseFixture,
} from "../support/migration-database.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) throw new Error("DATABASE_URL required");
const database = createDatabase(databaseUrl);
const config = {
  ...loadApplicationConfig({
    DATABASE_URL: databaseUrl,
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    PLATFORM_COMMUNICATIONS_SECRET: "synthetic_communications_secret_for_tests",
    TELEGRAM_WELCOME_TEXT: "synthetic welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "synthetic non-member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "synthetic unavailable",
    WORKERS_ENABLED: "false",
    TELEGRAM_MARKETING_ENABLED: "true",
    TELEGRAM_MARKETING_CONSENT_TEXT: "synthetic consent prompt",
    TELEGRAM_MARKETING_CONSENT_BUTTON: "synthetic agree",
    TELEGRAM_MARKETING_CONSENT_CONFIRMATION: "synthetic consent thanks",
  }),
  // Scripted conversations exceed the per-user limit, which ordinary-start covers.
  senderRate: { requests: 10_000, windowMs: 10_000 },
};
let now = new Date("2030-01-01T00:00:00.000Z");
const clock = { now: () => new Date(now) };
const answered: string[] = [];
let app: NestFastifyApplication;
let platform: SalesFunnelPlatform;
let nextUpdate = 1000;

beforeAll(async () => {
  await migrateToLatest(database);
  platform = await startSalesFunnelPlatform();
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(AUTHOR_AUTHORIZATION)
    .useValue({ authorize: () => Promise.resolve("allowed") })
    .overrideProvider(AUTHOR_CONTENT_VALIDATION)
    .useValue({
      validate: () => Promise.resolve({ status: "ok", targetErrors: [] }),
    })
    .overrideProvider(COMMUNICATION_TRANSPORT)
    .useValue({
      send: () =>
        Promise.resolve({ kind: "delivered", providerMessageId: "1" }),
    })
    .overrideProvider(TELEGRAM_MESSAGES)
    .useValue({
      sendText: () =>
        Promise.resolve({ kind: "delivered", providerMessageId: "1" }),
    })
    .overrideProvider(TELEGRAM_CALLBACK_ANSWERS)
    .useValue({
      answer: (id: string) => {
        answered.push(id);
        return Promise.resolve();
      },
    })
    .overrideProvider(SALES_FUNNEL_DELIVERY)
    .useValue(new HttpSalesFunnelAdapter(platform.url, platform.secret))
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
});

beforeEach(async () => {
  await sql`truncate sales_funnel_event_outbox, communication_sequences, communication_intro, communication_operations, communication_contacts, communication_preferences, communication_entries, telegram_transport_slots, bot_contacts, bot_contact_events, telegram_updates, start_response_deliveries, membership_checks, identity_link_recoveries, identity_link_events, platform_links, link_transactions, telegram_identity_reservations cascade`.execute(
    database,
  );
  now = new Date("2030-01-01T00:00:00.000Z");
  platform.events.clear();
  platform.answers.length = 0;
  platform.failWith = undefined;
  answered.length = 0;
});

afterAll(async () => {
  await closeIfStarted(app);
  await closeIfStarted(platform);
  await database.destroy();
});

async function publishDefaultSequence(): Promise<void> {
  const part = (text: string) => ({
    partId: randomUUID(),
    content: { type: "text" as const, text, entities: [], buttons: [] },
  });
  const sequence: CommunicationSequenceDraft = {
    sequenceId: randomUUID(),
    name: "survey",
    isDefault: true,
    sources: [{ sourceId: randomUUID(), code: "m_survey", name: "survey" }],
    entryResponse: { stepId: randomUUID(), parts: [part("entry")] },
    steps: [],
  };
  const command = (
    operation: string,
    payload: CommunicationsRequest["payload"],
    expectedRevision = 0,
  ): CommunicationsRequest => ({
    contractVersion: COMMUNICATIONS_VERSION,
    operation,
    operationId: randomUUID(),
    expectedRevision,
    actor: { accountRef: "synthetic-author" },
    payload,
  });
  const sequences = app.get(CommunicationSequences);
  await sequences.execute(
    command("intro.save", { introId: randomUUID(), parts: [part("intro")] }),
  );
  await sequences.execute(command("sequences.save", sequence));
  await sequences.execute(
    command("sequences.publish", { sequenceId: sequence.sequenceId }, 1),
  );
}

/** Sends one private update through the webhook path's preparation, inbox and processor. */
async function send(payload: unknown, updateId = nextUpdate++): Promise<void> {
  await app
    .get(TelegramUpdateInbox)
    .accept(
      "inside",
      String(updateId),
      prepareTelegramUpdateForInbox(payload),
      now,
    );
  await app.get(TelegramUpdateProcessor).processAvailable(50, now);
}

function text(value: string, user = 42, updateId = nextUpdate++) {
  return send(privateStartUpdate(updateId, user, { text: value }), updateId);
}

function consentPress(user = 42) {
  const updateId = nextUpdate++;
  return send(
    {
      update_id: updateId,
      callback_query: {
        id: `callback-${updateId}`,
        from: { id: user, is_bot: false },
        message: { message_id: 1, chat: { id: user, type: "private" } },
        data: "marketing:consent",
      },
    },
    updateId,
  );
}

async function queued(): Promise<SalesFunnelEvent[]> {
  const rows = await database
    .selectFrom("sales_funnel_event_outbox")
    .select("event")
    .orderBy("sequence_id")
    .execute();
  return rows.map((row) => row.event);
}

async function contactRef(user = "42"): Promise<string> {
  const row = await database
    .selectFrom("communication_contacts")
    .select("contact_id")
    .where("telegram_user_id", "=", user)
    .executeTakeFirstOrThrow();
  return row.contact_id;
}

async function link(user: string, account = "account-ref-a") {
  const linking = app.get(IdentityLinking);
  const token = createHash("sha256")
    .update(`token-${user}-${account}`)
    .digest("base64url");
  const challenge = await linking.register({
    accountRef: account,
    expiresAt: new Date(now.getTime() + 600_000),
    returnCorrelation: `return-${user}`,
    tokenDigest: token,
  });
  await linking.acceptStart({
    botIdentity: "inside",
    linkToken: { digest: token, kind: "digest" },
    observedAt: now,
    telegramUserId: user,
  });
  return linking.confirm({
    accountRef: account,
    linkTransactionRef: challenge.linkTransactionRef,
    returnCorrelation: `return-${user}`,
  });
}

describe("sales sequence events", () => {
  it("reports a labelled and an unlabelled /start once each, even when an update replays", async () => {
    await publishDefaultSequence();
    await text("/start m_survey", 42, 1);
    await send(privateStartUpdate(1, 42, { text: "/start m_survey" }), 1);
    await text("/start", 42, 2);
    const contact = await contactRef();
    expect(await queued()).toEqual([
      {
        eventId: salesFunnelEventId("bot_entered:inside:1"),
        contactRef: contact,
        occurredAt: "2030-01-01T00:00:00.000Z",
        kind: "bot_entered",
        sourceCode: "m_survey",
      },
      {
        eventId: salesFunnelEventId("bot_entered:inside:2"),
        contactRef: contact,
        occurredAt: "2030-01-01T00:00:00.000Z",
        kind: "bot_entered",
        sourceCode: null,
      },
    ]);
  });

  it("reports explicit commands while retired consent buttons cannot restore stop", async () => {
    await publishDefaultSequence();
    await text("/start");
    await text("/stop");
    await consentPress();
    await text("/start");
    const analytics = app.get(CommunicationSequences);
    const contacts = await analytics.execute({
      contractVersion: COMMUNICATIONS_VERSION,
      operation: "statistics.read",
      operationId: randomUUID(),
      expectedRevision: 0,
      actor: { accountRef: "synthetic-author" },
      payload: {},
    });
    expect(contacts).toMatchObject({
      statistics: { contacts: [{ marketingEnabled: false }] },
    });
    expect(
      (await queued())
        .filter((event) => event.kind === "marketing_consent")
        .map((event) => event.granted),
    ).toEqual([false]);
    await text("/resume");
    expect(
      (await queued())
        .filter((event) => event.kind === "marketing_consent")
        .map((event) => event.granted),
    ).toEqual([false, true]);
    expect(answered).toHaveLength(0);
  });

  it("starts the published sequence without a consent prompt or a synthetic consent fact", async () => {
    await publishDefaultSequence();
    await text("/start m_survey");
    const result = await app.get(CommunicationSequences).execute({
      contractVersion: COMMUNICATIONS_VERSION,
      operation: "statistics.read",
      operationId: randomUUID(),
      expectedRevision: 0,
      actor: { accountRef: "synthetic-author" },
      payload: {},
    });
    expect(result).toMatchObject({
      statistics: { contacts: [{ marketingEnabled: true }] },
    });
    const prompts = await database
      .selectFrom("start_response_deliveries")
      .select(["message_text", "buttons"])
      .where("message_text", "in", [
        "synthetic consent prompt",
        "synthetic consent thanks",
      ])
      .execute();
    expect(prompts).toEqual([]);
    expect((await queued()).map((event) => event.kind)).toEqual([
      "bot_entered",
    ]);
  });

  it.each([false, true])(
    "retires a historical consent prompt (unknown=%s) while unfiltered ordinary traffic keeps its receipt and attempts",
    async (unknown) => {
      await app.get(BotContacts).observeStart(
        {
          botIdentity: "inside",
          telegramUserId: "42",
          privateChatId: "42",
          updateId: "1",
          observedAt: now,
        },
        "none",
      );
      const queue = app.get(StartResponseDeliveryQueue);
      const old = {
        botIdentity: "inside",
        telegramUserId: "42",
        privateChatId: "42",
        messageText: "retired consent prompt",
        sourceKey: "marketing-consent:inside:1711",
        now,
        buttons: [{ text: "old consent", callbackData: "marketing:consent" }],
      };
      await queue.enqueue(old);
      if (unknown) {
        // Restored evidence from the retired sender, never a new current send.
        const receipt = await database
          .selectFrom("start_response_deliveries")
          .select("id")
          .where("source_key", "=", old.sourceKey)
          .executeTakeFirstOrThrow();
        await database
          .insertInto("start_response_delivery_attempts")
          .values({
            start_response_delivery_id: receipt.id,
            attempt_number: 1,
            attempted_at: now,
            diagnostic_code: "historical_lost_response",
            outcome: "transport_unknown",
            provider_error_code: null,
            provider_message_id: null,
          })
          .execute();
        await database
          .updateTable("start_response_deliveries")
          .set({ state: "retry_scheduled", attempt_count: 1 })
          .where("id", "=", receipt.id)
          .execute();
      }
      const ordinary = {
        ...old,
        buttons: [],
        messageText: "ordinary current reply",
        sourceKey: "ordinary-service:inside:1711",
      };
      await queue.enqueue(ordinary);
      expect(await hasDueReply(database, "inside", now)).toBe(true);
      const claimed = await queue.claimNext(now);
      expect(claimed).toMatchObject({
        messageText: "ordinary current reply",
        attemptNumber: 1,
      });
      if (!claimed) throw new Error("Ordinary due reply was starved");
      expect(
        await queue.recordResult(
          claimed,
          { kind: "delivered", providerMessageId: "1711001" },
          now,
        ),
      ).toBe(true);
      expect(await queue.enqueue(ordinary)).toBe(false);
      expect(await queue.enqueue(old)).toBe(false);
      expect(await queue.claimNext(now)).toBeUndefined();
      expect(await hasDueReply(database, "inside", now)).toBe(false);
      expect(await replyStateCounts(database)).toMatchObject(
        unknown
          ? { unknown_exhausted: 1, delivered: 1 }
          : { rejected: 1, delivered: 1 },
      );
      expect(await replyAttemptOutcomeCounts(database)).toMatchObject(
        unknown ? { transport_unknown: 1, delivered: 1 } : { delivered: 1 },
      );
    },
  );

  it("reports a confirmed link, including one of a bot contact from before communication records", async () => {
    await publishDefaultSequence();
    await text("/start", 42);
    const linked = await link("42");
    if (linked.status !== "linked") throw new Error("not linked");
    await database
      .insertInto("bot_contacts")
      .values({
        bot_identity: "inside",
        contactability: "reachable",
        first_started_at: now,
        last_started_at: now,
        private_chat_id: "43",
        telegram_user_id: "43",
        updated_at: now,
      })
      .execute();
    expect((await link("43", "account-ref-b")).status).toBe("linked");
    expect(
      (await queued()).filter((event) => event.kind === "account_linked"),
    ).toEqual([
      {
        eventId: salesFunnelEventId(
          `account_linked:${linked.linkTransactionRef}`,
        ),
        contactRef: await contactRef("42"),
        occurredAt: "2030-01-01T00:00:00.000Z",
        kind: "account_linked",
        telegramIdentityRef: linked.telegramIdentityRef,
      },
      expect.objectContaining({
        contactRef: await contactRef("43"),
        kind: "account_linked",
      }),
    ]);
  });

  it("reports an owner transfer of the link to another Account", async () => {
    await text("/start", 42);
    const first = await link("42", "account-ref-a");
    if (first.status !== "linked") throw new Error("not linked");
    const target = await link("42", "account-ref-b");
    expect(target.status).toBe("recovery-required");
    if (target.status !== "recovery-required")
      throw new Error("no recovery case");
    const transferred = await app.get(IdentityLinkRecovery).execute({
      confirmedSourceAccountRef: "account-ref-a",
      confirmedTargetAccountRef: "account-ref-b",
      recoveryRef: "recovery-ref-a",
      operatorRef: "operator-ref-a",
      reasonRef: "reason-ref-a",
      telegramIdentityRef: first.telegramIdentityRef,
      sourceAccountRef: "account-ref-a",
      targetAccountRef: "account-ref-b",
      targetLinkTransactionRef: target.linkTransactionRef,
    });
    expect(transferred.ok).toBe(true);
    expect(
      (await queued())
        .filter((event) => event.kind === "account_linked")
        .map((event) => event.eventId),
    ).toEqual([
      salesFunnelEventId(`account_linked:${first.linkTransactionRef}`),
      salesFunnelEventId(`account_linked:${target.linkTransactionRef}`),
    ]);
  });

  it("rolls back the link, initial check and legacy communication contact when account event persistence fails", async () => {
    // Simulate persisted legacy data from before communication storage existed.
    await database
      .insertInto("bot_contacts")
      .values({
        bot_identity: "inside",
        telegram_user_id: "42",
        private_chat_id: "42",
        contactability: "reachable",
        first_started_at: now,
        last_started_at: now,
        updated_at: now,
      })
      .execute();
    await sql`create function synthetic_account_event_fault() returns trigger language plpgsql as $$
      begin if new.kind = 'account_linked' then raise exception 'synthetic account event failure'; end if; return new; end $$;
      create trigger synthetic_account_event_fault before insert on sales_funnel_event_outbox
      for each row execute function synthetic_account_event_fault()`.execute(
      database,
    );
    try {
      await expect(link("42")).rejects.toThrow(
        "synthetic account event failure",
      );
      expect(
        await database.selectFrom("platform_links").selectAll().execute(),
      ).toEqual([]);
      expect(
        await database.selectFrom("membership_checks").selectAll().execute(),
      ).toEqual([]);
      expect(
        await database
          .selectFrom("communication_contacts")
          .selectAll()
          .execute(),
      ).toEqual([]);
      expect(
        (await queued()).filter((event) => event.kind === "account_linked"),
      ).toEqual([]);
    } finally {
      await sql`drop trigger synthetic_account_event_fault on sales_funnel_event_outbox;
        drop function synthetic_account_event_fault()`.execute(database);
    }
    await expect(link("42")).resolves.toMatchObject({ status: "linked" });
    expect(
      (await queued()).filter((event) => event.kind === "account_linked"),
    ).toHaveLength(1);
  });

  it("delivers every event to Platform once, retries through a Platform failure and never sends Telegram ids", async () => {
    await publishDefaultSequence();
    await text("/start m_survey", 987654321);
    await text("/stop", 987654321);
    await link("987654321");
    const delivery = app.get(SalesFunnelDeliveryProcessor);

    platform.failWith = 503;
    await expect(delivery.processNext(now)).resolves.toBe("retryable");
    platform.failWith = undefined;
    await expect(delivery.processAvailable(50, now)).resolves.toBe(2);
    now = new Date(now.getTime() + 60_000);
    await expect(delivery.processAvailable(50, now)).resolves.toBe(1);

    expect(platform.events.size).toBe(3);
    expect(
      platform.answers.filter((answer) => answer.status === 200),
    ).toHaveLength(3);
    const states = await database
      .selectFrom("sales_funnel_event_outbox")
      .select("state")
      .execute();
    expect(states.every((row) => row.state === "delivered")).toBe(true);
    const wire = JSON.stringify([...platform.events.values()]);
    expect(wire).not.toContain("987654321");
  });

  it("recognises a repeated delivery as a duplicate and logs a changed one as a contract conflict", async () => {
    await publishDefaultSequence();
    await text("/start m_survey");
    const delivery = app.get(SalesFunnelDeliveryProcessor);
    await expect(delivery.processNext(now)).resolves.toBe("delivered");

    await database
      .updateTable("sales_funnel_event_outbox")
      .set({ state: "pending" })
      .execute();
    await expect(delivery.processNext(now)).resolves.toBe("delivered");
    expect(platform.answers.at(-1)).toEqual({
      status: 200,
      body: {
        contractVersion: "inside.sales-funnel-events.v1",
        accepted: 0,
        duplicates: 1,
      },
    });

    const [event] = await queued();
    await database
      .updateTable("sales_funnel_event_outbox")
      .set({
        state: "pending",
        event: JSON.stringify({ ...event, sourceCode: "m_other" }),
      })
      .execute();
    await expect(delivery.processNext(now)).resolves.toBe("conflict");
    expect(platform.answers.at(-1)?.status).toBe(409);
    const row = await database
      .selectFrom("sales_funnel_event_outbox")
      .select(["state", "diagnostic_code"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      state: "rejected",
      diagnostic_code: "platform_event_conflict",
    });
    await expect(delivery.processNext(now)).resolves.toBeUndefined();
  });
});

describe("migration 029 backfill", () => {
  const contact = randomUUID();
  const funnel = randomUUID();
  const source = randomUUID();
  const linkRef = "historical-link-42";
  const identityRef = "historical-identity-42";
  const occurredAt = "2030-01-01T00:00:00.000Z";
  const draft = {
    funnelId: funnel,
    name: "survey",
    isDefault: true,
    sources: [{ sourceId: source, code: "m_survey", name: "survey" }],
    entryResponse: { stepId: randomUUID(), parts: [] },
    steps: [],
  };
  const encodedDraft = JSON.stringify(draft);
  const abort = new AbortController();
  let fixture: MigrationDatabaseFixture | undefined;
  let acquisition: Promise<MigrationDatabaseFixture> | undefined;
  let historical: Database;
  // Register cleanup before startup; cancellation also owns an unfinished acquisition.
  afterAll(async () => {
    abort.abort(new Error("Historical fixture cleanup"));
    const acquired = fixture ?? (await acquisition?.catch(() => undefined));
    await acquired?.close();
  });
  beforeAll(async () => {
    acquisition = createMigrationDatabase(
      databaseUrl,
      `sales_history_${randomUUID().replaceAll("-", "")}`,
      { signal: abort.signal },
    );
    fixture = await acquisition;
    historical = fixture.database;
  });
  let preferences: unknown;
  let links: unknown;
  let at029: SalesFunnelEvent[];
  let after037: SalesFunnelEvent[];
  let afterReplay: SalesFunnelEvent[];
  let outboxExists: boolean | undefined;
  const expected: SalesFunnelEvent[] = [
    {
      eventId: salesFunnelEventId("bot_entered:inside:7"),
      contactRef: contact,
      occurredAt,
      kind: "bot_entered",
      sourceCode: "m_survey",
    },
    {
      eventId: salesFunnelEventId("marketing_consent:inside:8"),
      contactRef: contact,
      occurredAt,
      kind: "marketing_consent",
      granted: false,
    },
    {
      eventId: salesFunnelEventId(`account_linked:${linkRef}`),
      contactRef: contact,
      occurredAt,
      kind: "account_linked",
      telegramIdentityRef: identityRef,
    },
  ];
  const orderedExpected = expected.toSorted((a, b) =>
    a.eventId.localeCompare(b.eventId),
  );
  const events = async () =>
    (
      await historical
        .selectFrom("sales_funnel_event_outbox")
        .select("event")
        .execute()
    )
      .map((row) => row.event)
      .sort((a, b) => a.eventId.localeCompare(b.eventId));
  beforeAll(async () => {
    await migrateTo(historical, "027-owner-link-activation");
  });
  beforeAll(async () => {
    // Actual pre-029 columns and facts, before canonical sequence owners existed.
    await sql`
        insert into bot_contacts (bot_identity, telegram_user_id, private_chat_id, contactability, first_started_at, last_started_at, updated_at)
          values ('inside', 42, 42, 'reachable', ${occurredAt}::timestamptz, ${occurredAt}::timestamptz, ${occurredAt}::timestamptz)`.execute(
      historical,
    );
    await sql`insert into communication_funnels (funnel_id, bot_identity, owner_account_ref, revision, published_revision, lifecycle, draft, published, is_default)
          values (${funnel}::uuid, 'inside', 'synthetic-author', 1, 1, 'published', ${encodedDraft}::jsonb, ${encodedDraft}::jsonb, true)`.execute(
      historical,
    );
    await sql`insert into communication_publications (funnel_id, revision, snapshot, published_at)
          values (${funnel}::uuid, 1, ${encodedDraft}::jsonb, ${occurredAt}::timestamptz)`.execute(
      historical,
    );
    await sql`insert into communication_sources (bot_identity, source_id, code, funnel_id)
          values ('inside', ${source}::uuid, 'm_survey', ${funnel}::uuid)`.execute(
      historical,
    );
    await sql`insert into communication_contacts (contact_id, bot_identity, telegram_user_id, marketing_enabled)
          values (${contact}::uuid, 'inside', 42, false)`.execute(historical);
    await sql`insert into communication_entries (bot_identity, update_id, contact_id, funnel_id, source_id, source_code, entered_at, outcome)
          values ('inside', 7, ${contact}::uuid, ${funnel}::uuid, ${source}::uuid, 'm_survey', ${occurredAt}::timestamptz, 'entered')`.execute(
      historical,
    );
    await sql`insert into communication_preferences (bot_identity, update_id, contact_id, enabled, observed_at)
          values ('inside', 8, ${contact}::uuid, false, ${occurredAt}::timestamptz)`.execute(
      historical,
    );
    await sql`insert into link_transactions (link_transaction_ref, account_ref, token_digest, return_correlation, expires_at, state, bot_identity, candidate_telegram_user_id, registered_at, received_at, confirmed_at)
          values (${linkRef}, 'account-ref-a', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'return-42', '2030-01-01T01:00:00.000Z', 'linked', 'inside', 42, ${occurredAt}::timestamptz, ${occurredAt}::timestamptz, ${occurredAt}::timestamptz)`.execute(
      historical,
    );
    await sql`insert into platform_links (telegram_identity_ref, bot_identity, telegram_user_id, account_ref, link_transaction_ref, linked_at)
          values (${identityRef}, 'inside', 42, 'account-ref-a', ${linkRef}, ${occurredAt}::timestamptz)
      `.execute(historical);
    preferences = await historical
      .selectFrom("communication_preferences")
      .selectAll()
      .execute();
    links = await historical.selectFrom("platform_links").selectAll().execute();
  });
  beforeAll(async () => {
    await migrateTo(historical, "029-sales-funnel-events");
    at029 = await events();
  });
  beforeAll(async () => {
    // Exercise actual 029.down before crossing the irreversible 037 contract.
    await migrateTo(historical, "027-owner-link-activation");
    const outbox = await sql<{ exists: boolean }>`select exists (
          select 1 from information_schema.tables where table_schema = 'public'
            and table_name = 'sales_funnel_event_outbox'
        ) as exists`.execute(historical);
    outboxExists = outbox.rows[0]?.exists;
  });
  beforeAll(async () => {
    await migrateToLatest(historical);
    after037 = await events();
  });
  beforeAll(async () => {
    await migrateToLatest(historical);
    afterReplay = await events();
  });
  it("queues past entries, explicit preferences and links under the application's event ids", async () => {
    expect(at029).toEqual(orderedExpected);
    expect(outboxExists).toBe(false);
    expect(after037).toEqual(orderedExpected);
    expect(afterReplay).toEqual(orderedExpected);
    expect(
      await historical
        .selectFrom("communication_preferences")
        .selectAll()
        .execute(),
    ).toEqual(preferences);
    expect(
      await historical.selectFrom("platform_links").selectAll().execute(),
    ).toEqual(links);
    expect(
      await historical
        .selectFrom("communication_contacts")
        .select(["contact_id", "marketing_enabled"])
        .execute(),
    ).toEqual([{ contact_id: contact, marketing_enabled: false }]);
    expect(
      await historical
        .selectFrom("communication_entries")
        .select(["update_id", "sequence_id", "source_id", "source_code"])
        .execute(),
    ).toEqual([
      {
        update_id: "7",
        sequence_id: funnel,
        source_id: source,
        source_code: "m_survey",
      },
    ]);
    expect(
      await historical
        .selectFrom("communication_publications")
        .select("snapshot")
        .execute(),
    ).toEqual([{ snapshot: draft }]);
  });
});
