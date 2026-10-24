import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import fixtures from "@inside/contracts/notifications-v1/fixtures.json" with { type: "json" };
import { sql } from "kysely";
import {
  createRestorePostgres,
  snapshotDatabase,
  type RestorePostgres,
  type RestoreDatabase,
} from "../../../../scripts/fixtures/domain-restore/postgres.mjs";
import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { NotificationProvider } from "../../src/modules/notifications/notification-provider.js";
import {
  notificationValidator,
  type NotificationCommand,
} from "../../src/modules/notifications/notification-contract.js";
import { seedNotificationRecipient } from "../support/notification-recipient.js";
import { conforming } from "../support/json.js";
import { required } from "../support/required.js";
import { SequenceScheduler } from "../../src/modules/communications/sequence-scheduler.js";
import { CommunicationSequences } from "../../src/modules/communications/communication-sequences.js";
import { loadComposition } from "../../src/modules/communications/author-drafts.js";
import {
  authorizeAuthor,
  type AuthorAuthorization,
} from "../../src/modules/communications/author-authorization.js";
import { transactionWithExternalReads } from "../../src/database/external-reads.js";
import { findPlatformLink } from "../../src/modules/identity-linking/platform-links.js";

import {
  parseAuthorState,
  resolveAuthorCallback,
} from "../../src/modules/communications/author-dialog.js";
import { signInReplyEligibility } from "../../src/modules/bot-sign-in/reply-eligibility.js";
import { WaitlistConfirmations } from "../../src/modules/communications/waitlist-confirmations.js";
import type { WaitlistConfirmation } from "@inside/contracts/waitlist-confirmation";
import { CommunityRestrictions } from "../../src/modules/community/community-restrictions.js";
import { CommunityProvider } from "../../src/modules/community/community-provider.js";
import {
  COMMUNITY_V2,
  type CommunitySetCommand,
} from "../../src/modules/community/community-contract.js";
import { seedCommunityBinding } from "../support/community-binding.js";
import { FakeCommunityChat } from "../support/community-chat.js";

let postgres: RestorePostgres;
let cleanup = () => Promise.resolve();
beforeAll(async () => {
  postgres = await createRestorePostgres("telegram");
  cleanup = () => postgres.close();
});
afterAll(async () => {
  await cleanup();
});
const initialInstant = "2030-01-31T10:00:00.000Z";
function createRecoveryEffects() {
  return {
    clock: {
      value: new Date(initialInstant),
      now() {
        return new Date(this.value);
      },
    },
    external: { sends: [] as string[], results: new Set<string>() },
    chat: new FakeCommunityChat(),
  };
}
type RecoveryEffects = ReturnType<typeof createRecoveryEffects>;
const sequenceId = randomUUID(),
  stepId = randomUUID(),
  partId = randomUUID();
const historicalDraft = {
  funnelId: sequenceId,
  name: "Retained published sequence",
  isDefault: false,
  sources: [],
  steps: [
    {
      stepId,
      delaySeconds: 10,
      parts: [
        {
          partId,
          content: {
            type: "text",
            text: "Retained sequence text",
            entities: [],
            buttons: [],
          },
        },
      ],
    },
  ],
  entryResponse: {
    stepId: randomUUID(),
    parts: [
      {
        partId: randomUUID(),
        content: {
          type: "text",
          text: "Original entry response",
          entities: [],
          buttons: [],
        },
      },
    ],
  },
};
const historicalSnapshot = {
  ...historicalDraft,
  revision: 4,
  publishedRevision: 3,
  lifecycle: "published",
};
const historicalReceipt = {
  request: {
    contractVersion: "inside-communications-v1",
    operation: "funnels.publish",
    operationId: randomUUID(),
    actor: { accountRef: "synthetic-owner" },
    expectedRevision: 3,
    payload: { funnelId: sequenceId },
  },
  result: { funnel: historicalSnapshot },
};
const historicalSession = {
  version: 1,
  token: "retained-menu",
  batch: "funnel",
  actions: [{ kind: "batch:funnel" }, { kind: "f:list" }, { kind: "home" }],
  menu: {
    text: "Original author menu",
    buttons: [["Continue", { kind: "batch:funnel" }]],
  },
  composing: {
    destination: {
      kind: "funnel",
      id: sequenceId,
      target: stepId,
      expectedRevision: 4,
    },
    prompt: "button-url",
    buttonTitle: "Original pending button",
    content: {
      type: "text",
      text: "Unsaved original text",
      entities: [],
      buttons: [],
    },
  },
  funnelAuthor: { funnel: historicalSnapshot, dirty: true, target: "entry" },
};
const contactId = randomUUID(),
  participationId = randomUUID();
const sequenceUnknownId = randomUUID(),
  sequenceStoppedId = randomUUID();
const communityBinding = {
  accountRef: randomUUID(),
  telegramIdentityRef: randomUUID(),
  linkRef: randomUUID(),
  linkRevision: 2,
};
const oldCommunityBinding = {
  ...communityBinding,
  telegramIdentityRef: randomUUID(),
  linkRef: randomUUID(),
  linkRevision: 1,
};
const oldCommunityCommand: CommunitySetCommand = {
  contractVersion: COMMUNITY_V2,
  operation: "entitlement.set",
  operationId: randomUUID(),
  correlationRef: randomUUID(),
  entitlementRevision: 6,
  binding: oldCommunityBinding,
  access: { kind: "lifetime" },
  issuedAt: initialInstant,
};
const moderation = {
  operationId: randomUUID(),
  botIdentity: "inside",
  accountRef: communityBinding.accountRef,
  identityRef: communityBinding.telegramIdentityRef,
  expectedRevision: 0,
  action: "hold" as const,
  actorRef: "synthetic-owner",
  reason: "Original moderation hold",
};
const communityCommand: CommunitySetCommand = {
  contractVersion: COMMUNITY_V2,
  operation: "entitlement.set",
  operationId: randomUUID(),
  correlationRef: randomUUID(),
  entitlementRevision: 7,
  binding: communityBinding,
  access: { kind: "lifetime" },
  issuedAt: initialInstant,
};
const commands = ["sent", "unknown", "pending"].map((label, index) => {
  const command = conforming(
    structuredClone(
      required(
        fixtures.find((fixture) => fixture.name === "subscription-telegram"),
      ).value,
    ),
    notificationValidator<NotificationCommand>("telegramDelivery"),
  );
  command.operationId = randomUUID();
  command.deliveryRef = randomUUID();
  command.notificationRef = randomUUID();
  command.binding = {
    ...command.binding,
    accountRef: randomUUID(),
    telegramIdentityRef: randomUUID(),
  };
  command.content = { category: "material", kind: "material_published" };
  command.text = `Synthetic retained ${label}`;
  command.issuedAt = initialInstant;
  command.notAfter = "2030-01-31T10:10:00Z";
  return { command, label, user: String(20000 + index) };
});
const waitlist: WaitlistConfirmation[] = [
  "delivered",
  "unknown",
  "pending",
  "stale",
].map(() => ({
  contractVersion: "inside.waitlist-confirmation.v1",
  eventId: randomUUID(),
  intakeId: randomUUID(),
  accountRef: commands[2]?.command.binding.accountRef ?? "",
  telegramIdentityRef: commands[2]?.command.binding.telegramIdentityRef ?? "",
  linkRevision: 1,
}));
function config(url: string) {
  return loadApplicationConfig({
    DATABASE_URL: url,
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_WEBHOOK_SECRET: "synthetic-restore-webhook-secret-000000",
    PLATFORM_INTEGRATION_SECRET: "synthetic-restore-platform-secret-000000",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000001",
    TELEGRAM_MARKETING_ENABLED: "true",
    TELEGRAM_DELIVERY_MODE: "live",
    TELEGRAM_BOT_TOKEN: "1234:synthetic-restore-only",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
  });
}
function notificationProvider(database: Database, effects: RecoveryEffects) {
  const { clock, external } = effects;
  return new NotificationProvider(
    database,
    "inside",
    clock,
    {
      authorize: (request) =>
        Promise.resolve({
          ...request,
          status: "allowed",
          permitRef: randomUUID(),
          validUntil: new Date(clock.now().getTime() + 5000).toISOString(),
        }),
    },
    {
      sendText: (message) => {
        external.sends.push(message.text);
        return Promise.resolve(
          message.text.endsWith("unknown")
            ? { kind: "transport_unknown" as const }
            : {
                kind: "delivered" as const,
                providerMessageId: `message-${message.chatId}`,
              },
        );
      },
      editText: () => {
        throw new Error("Restore cannot edit historical messages");
      },
    },
    Buffer.alloc(32, 1),
  );
}
function receive(provider: NotificationProvider, command: NotificationCommand) {
  return provider.receive(
    Buffer.from(JSON.stringify(command)),
    {
      exchange: "inside.notifications.telegram.v1",
      routingKey: "material",
      contentType: "application/json",
      type: command.contractVersion,
      messageId: command.operationId,
      persistent: true,
    },
    "material",
  );
}
function community(database: Database, effects: RecoveryEffects) {
  const { clock, chat } = effects;
  return new CommunityProvider(
    database,
    "inside",
    "-1000000000001",
    clock,
    {
      authorize: (request) =>
        Promise.resolve({
          contractVersion: "inside.billing-dispatch.v1",
          operation: "dispatch.result",
          operationId: request.operationId,
          attemptId: request.attemptId,
          dispatchId: request.dispatchId,
          decision: {
            status: "allowed",
            permitRef: randomUUID(),
            validUntil: new Date(clock.now().getTime() + 5000).toISOString(),
          },
        }),
    },
    chat,
    {
      contractVersion: COMMUNITY_V2,
      removalsEnabled: true,
      botTelegramUserId: "1234",
    },
  );
}
function waitlistProvider(
  database: Database,
  url: string,
  effects: RecoveryEffects,
) {
  const { clock, external } = effects;
  return new WaitlistConfirmations(
    database,
    config(url),
    clock,
    {
      current: (command) =>
        Promise.resolve(
          command.eventId === waitlist[3]?.eventId ? "suppressed" : "accepted",
        ),
    },
    {
      send: (message) => {
        external.sends.push(`waitlist:${message.chatId}`);
        return Promise.resolve({
          kind: "delivered",
          providerMessageId: "waitlist-message",
        });
      },
    },
  );
}
async function seedLegacy(
  database: Database,
  url: string,
  effects: RecoveryEffects,
) {
  const { clock, chat } = effects;
  for (const [accountRef, user] of [
    ["synthetic-owner", "40000"],
    ["other-author", "40001"],
  ] as const) {
    await seedCommunityBinding(
      database,
      {
        accountRef,
        telegramIdentityRef: randomUUID(),
        linkRef: randomUUID(),
        linkRevision: 1,
      },
      clock.now(),
      user,
    );
  }
  const provider = notificationProvider(database, effects);
  for (const { command, user, label } of commands) {
    await seedNotificationRecipient(database, command, clock.now(), user);
    expect((await receive(provider, command))?.state).toBe("accepted");
    if (label !== "pending") {
      await sql`delete from telegram_transport_slots; delete from telegram_transport_fairness`.execute(
        database,
      );
      await provider.processCategory("material");
    }
  }
  await seedCommunityBinding(
    database,
    oldCommunityBinding,
    clock.now(),
    "30001",
  );
  chat.membership = "member";
  expect(
    (await community(database, effects).handle(oldCommunityCommand)).status,
  ).toBe(200);
  await community(database, effects).processDueEffects();
  await sql`update platform_links set telegram_identity_ref=${communityBinding.telegramIdentityRef} where telegram_identity_ref=${oldCommunityBinding.telegramIdentityRef}`.execute(
    database,
  );
  chat.membership = "member";
  expect(
    (await community(database, effects).handle(communityCommand)).status,
  ).toBe(200);
  await community(database, effects).processDueEffects();
  expect(
    await new CommunityRestrictions(database, clock).decide(moderation, true),
  ).toBe("applied");
  // An actual published immutable snapshot uses the old wire and old persistence names.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const draft = historicalDraft;
    await pool.query(
      "insert into communication_funnels(funnel_id,bot_identity,owner_account_ref,revision,published_revision,lifecycle,draft,published,is_default) values($1,'inside','synthetic-owner',4,3,'published',$2,$2,false)",
      [sequenceId, draft],
    );
    await pool.query(
      "insert into communication_publications(funnel_id,revision,snapshot,published_at) values($1,3,$2,'2020-01-31')",
      [sequenceId, draft],
    );
    await pool.query(
      "insert into communication_step_ids(funnel_id,step_id,first_published_at,part_ids) values($1,$2,'2020-01-31',$3)",
      [sequenceId, stepId, JSON.stringify([partId])],
    );
    await pool.query(
      "insert into communication_contacts(contact_id,bot_identity,telegram_user_id,marketing_enabled) values($1,'inside',20000,false)",
      [contactId],
    );
    await pool.query(
      "insert into communication_enrollments(enrollment_id,contact_id,funnel_id,enrolled_at,initial_entry_key) values($1,$2,$3,'2020-01-31','original-entry')",
      [participationId, contactId, sequenceId],
    );
    const parts = [
      {
        partId,
        state: "unknown",
        diagnosticCode: "lost_response",
        attempts: [
          {
            attemptId: randomUUID(),
            attemptedAt: "2020-01-31T00:00:00Z",
            outcome: "unknown",
            diagnosticCode: "lost_response",
            duplicateRiskAccepted: false,
          },
        ],
      },
    ];
    for (const [index, delivery] of [
      sequenceUnknownId,
      sequenceStoppedId,
    ].entries())
      await pool.query(
        "insert into communication_deliveries(delivery_id,dedup_key,bot_identity,contact_id,funnel_id,step_id,kind,published_revision,snapshot,parts,due_at,created_at) values($1,$2,'inside',$3,$4,$5,'step',3,$6,$7,'2020-01-31','2020-01-31')",
        [
          delivery,
          `original-${String(index)}`,
          contactId,
          sequenceId,
          stepId,
          JSON.stringify(draft.steps[0]?.parts),
          JSON.stringify(
            index === 0
              ? parts
              : [
                  {
                    partId,
                    state: "pending",
                    diagnosticCode: null,
                    attempts: [],
                  },
                ],
          ),
        ],
      );
    await pool.query(
      "insert into communication_preferences(bot_identity,update_id,contact_id,enabled,observed_at) values('inside',700,$1,false,'2020-01-31')",
      [contactId],
    );
    await pool.query(
      "update communication_contacts set unavailable_since='2020-01-31' where contact_id=$1",
      [contactId],
    );
    await pool.query(
      "update communication_deliveries set cancel_requested=true,cancellation_reason='marketing_unavailable',completed_at='2020-01-31',parts=$2 where delivery_id=$1",
      [
        sequenceStoppedId,
        JSON.stringify([
          {
            partId,
            state: "cancelled",
            diagnosticCode: "marketing_unavailable",
            attempts: [],
          },
        ]),
      ],
    );
    await pool.query(
      "insert into communication_operations(bot_identity,operation_id,actor_account_ref,request,result,created_at) values('inside',$1,'synthetic-owner',$2,$3,'2020-01-31')",
      [
        historicalReceipt.request.operationId,
        historicalReceipt.request,
        historicalReceipt.result,
      ],
    );
    await pool.query(
      "insert into communication_author_sessions(bot_identity,telegram_user_id,account_ref,state) values('inside',40000,'synthetic-owner',$1)",
      [historicalSession],
    );
    await pool.query(
      "insert into communication_author_drafts(bot_identity,owner_account_ref,draft_id,kind,name,snapshot) values('inside','synthetic-owner',$1,'funnel','Original active draft',$2)",
      [sequenceId, historicalSession.funnelAuthor],
    );
    await pool.query(
      "insert into communication_author_compositions(bot_identity,owner_account_ref,destination_id,state) values('inside','synthetic-owner',$1,$2)",
      [sequenceId, historicalSession],
    );
    for (const [index, command] of waitlist.entries())
      await pool.query(
        "insert into waitlist_confirmations(bot_identity,event_id,command,created_at,available_at,state,attempt_count,attempted_at,provider_message_id) values('inside',$1,$2,'2020-01-31','2020-01-31',$3,$4,$5,$6)",
        [
          command.eventId,
          command,
          index === 0 ? "delivered" : index === 1 ? "unknown" : "pending",
          index < 2 ? 1 : 0,
          index < 2 ? "2020-01-31" : null,
          index === 0 ? "original-confirmation" : null,
        ],
      );
  } finally {
    await pool.end();
  }
}
async function state(database: RestoreDatabase) {
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    return await snapshotDatabase((query) => pool.query(query));
  } finally {
    await pool.end();
  }
}
async function authorizedComposition(owner: Database, user: string) {
  const authorization: AuthorAuthorization = {
    authorize: (subject) =>
      Promise.resolve(
        ["synthetic-owner", "other-author"].includes(subject.accountRef)
          ? "allowed"
          : "denied",
      ),
  };
  return transactionWithExternalReads(owner, async (tx) => {
    const input = {
      botIdentity: "inside",
      telegramUserId: user,
      privateChatId: user,
      updateId: "9001",
      text: "",
      content: null,
    };
    const link = await findPlatformLink(
      tx,
      { botIdentity: input.botIdentity, telegramUserId: user },
      "share",
    );
    if (!link)
      throw new Error(
        "Composition reader requires its retained verified binding",
      );
    const permission = await authorizeAuthor(authorization, {
      kind: "telegram",
      accountRef: link.accountRef,
      telegramIdentityRef: link.telegramIdentityRef,
      botIdentity: input.botIdentity,
    });
    if (permission !== "allowed")
      throw new Error(
        "Composition reader requires current author authorization",
      );
    return loadComposition(
      {
        tx,
        input,
        accountRef: link.accountRef,
        identityRef: link.telegramIdentityRef,
      },
      sequenceId,
    );
  });
}

async function currentReaders(
  owner: Database,
  url: string,
  effects: RecoveryEffects,
) {
  const { clock, external, chat } = effects;
  const beforeEffects = [...external.sends],
    beforeMutations = [...chat.calls];
  const composer = await authorizedComposition(owner, "40000");
  expect(composer).toEqual({
    destination: {
      kind: "sequence",
      id: sequenceId,
      target: stepId,
      expectedRevision: 4,
    },
    prompt: "button-url",
    buttonTitle: "Original pending button",
    content: {
      type: "text",
      text: "Unsaved original text",
      entities: [],
      buttons: [],
    },
  });
  await expect(authorizedComposition(owner, "40001")).rejects.toMatchObject({
    code: "not_found",
  });
  expect(external.sends).toEqual(beforeEffects);
  expect(chat.calls).toEqual(beforeMutations);
  const sequences = new CommunicationSequences(
    owner,
    config(url),
    { authorize: () => Promise.resolve("allowed") },
    clock,
    { validate: () => Promise.resolve({ status: "ok", targetErrors: [] }) },
  );
  const base = {
    contractVersion: "inside-communications-v2" as const,
    operationId: randomUUID(),
    actor: { accountRef: "synthetic-owner" },
    expectedRevision: 0,
  };
  expect(
    await sequences.execute({
      ...base,
      operation: "sequences.read",
      payload: { sequenceId },
    }),
  ).toMatchObject({
    sequence: { sequenceId, name: "Retained published sequence" },
  });
  const receipt = await sequences.execute({
    ...base,
    operation: "receipts.read",
    payload: { receiptOperationId: historicalReceipt.request.operationId },
  });
  if (!("receipt" in receipt))
    throw new Error("Expected passive receipt reader");
  expect(JSON.parse(receipt.receipt.requestJson)).toEqual(
    historicalReceipt.request,
  );
  expect(JSON.parse(receipt.receipt.resultJson)).toEqual(
    historicalReceipt.result,
  );
  const sessionRow = await owner
    .selectFrom("communication_author_sessions")
    .select("state")
    .where("telegram_user_id", "=", "40000")
    .executeTakeFirstOrThrow();
  const session = parseAuthorState(sessionRow.state);
  expect(session).toMatchObject({
    token: "retained-menu",
    batch: "sequence",
    composing: { destination: { kind: "sequence", id: sequenceId } },
    sequenceAuthor: { sequence: { sequenceId } },
  });
  if (session === undefined)
    throw new Error(
      "Current parser must preserve the active legacy author session",
    );
  expect(resolveAuthorCallback(session, "author:retained-menu:0")).toEqual({
    kind: "batch:sequence",
  });
}

async function recover(database: RestoreDatabase, effects: RecoveryEffects) {
  const { clock, external } = effects;
  const owner = createDatabase(database.url);
  try {
    clock.value = new Date("2030-01-31T10:01:00Z");
    await currentReaders(owner, database.url, effects);
    const provider = notificationProvider(owner, effects);
    for (const { command } of commands) await receive(provider, command);
    await provider.processCategory("material");
    await provider.publishResults((result) => {
      external.results.add(result.messageId);
      return Promise.resolve();
    });
    const scheduler = new SequenceScheduler(
      owner,
      config(database.url),
      clock,
      {
        send: (message) => {
          external.sends.push(`unexpected-sequence:${message.chatId}`);
          throw new Error("Stopped/unknown historical sequence cannot send");
        },
      },
      signInReplyEligibility,
    );
    await scheduler.processAvailable();
    const notifications = waitlistProvider(owner, database.url, effects);
    for (const command of waitlist) await notifications.receive(command);
    for (const minute of [2, 3]) {
      clock.value = new Date(`2030-01-31T10:0${String(minute)}:00Z`);
      await notifications.processAvailable();
    }
    expect(
      (await community(owner, effects).handle(oldCommunityCommand)).status,
    ).toBe(200);
    expect(
      (await community(owner, effects).handle(communityCommand)).status,
    ).toBe(200);
    expect(
      await new CommunityRestrictions(owner, clock).decide(moderation, true),
    ).toBe("duplicate");
    await community(owner, effects).processDueEffects();
    await community(owner, effects).reconcileDueStates();
    expect(
      await owner
        .selectFrom("community_desired_states")
        .select([
          "admission_restriction",
          "restriction_revision",
          "removal_origin",
        ])
        .where("account_ref", "=", communityBinding.accountRef)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      admission_restriction: "moderation",
      restriction_revision: "1",
      removal_origin: "none",
    });

    expect(
      await owner
        .selectFrom("notification_commands")
        .select(["state"])
        .where("operation_id", "=", required(commands[1]).command.operationId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "unknown" });
    expect(
      await owner
        .selectFrom("notification_commands")
        .select(["state"])
        .where("operation_id", "=", required(commands[0]).command.operationId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "sent" });
    expect(
      await owner
        .selectFrom("waitlist_confirmations")
        .select("state")
        .where("event_id", "=", required(waitlist[1]).eventId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "unknown" });
    expect(
      await owner
        .selectFrom("waitlist_confirmations")
        .select("state")
        .where("event_id", "=", required(waitlist[3]).eventId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "suppressed" });
  } finally {
    await owner.destroy();
  }
}

// Two full archives, two EMPTY restores and real owner reconstruction are the subject here.
// The ordinary five-second unit default does not cover that PostgreSQL process boundary.
test("full Telegram archives preserve both migration ledger and mixed provider receipts across fresh recovery owners", async () => {
  // Retain this same external ledger across every reconnect and both restore boundaries.
  const recoveryEffects = createRecoveryEffects();
  const { clock, external, chat } = recoveryEffects;
  const source = await postgres.emptyDatabase();
  const legacyOwner = createDatabase(source.url);
  try {
    await migrateTo(legacyOwner, "035-waitlist-confirmations");
    await seedLegacy(legacyOwner, source.url, recoveryEffects);
  } finally {
    await legacyOwner.destroy();
  }
  expect(external.sends).toEqual([
    "Synthetic retained sent",
    "Synthetic retained unknown",
  ]);
  const legacyState = await state(source);
  const legacy = await postgres.backup(source);
  const migrate = async (database: RestoreDatabase) => {
    const owner = createDatabase(database.url);
    try {
      await migrateToLatest(owner);
    } finally {
      await owner.destroy();
    }
  };
  await migrate(source);
  const upgradedOwner = createDatabase(source.url);
  try {
    const archive = (
      await sql<{
        source_table: string;
        original: unknown;
      }>`select source_table,original from communication_historical_author_state order by source_table,source_key`.execute(
        upgradedOwner,
      )
    ).rows;
    for (const table of [
      "communication_author_sessions",
      "communication_author_drafts",
      "communication_author_compositions",
    ])
      expect(
        archive
          .filter((row) => row.source_table === table)
          .map((row) => row.original),
      ).toEqual(
        (legacyState.tables[`public.${table}`] ?? []).map((row): unknown =>
          JSON.parse(row),
        ),
      );
  } finally {
    await upgradedOwner.destroy();
  }
  await recover(source, recoveryEffects);
  expect(external.sends).toEqual([
    "Synthetic retained sent",
    "Synthetic retained unknown",
    "Synthetic retained pending",
    "waitlist:20002",
  ]);
  const recovered = await state(source);
  const effects = [...external.sends],
    mutations = [...chat.calls];
  await recover(source, recoveryEffects);
  expect(await state(source)).toEqual(recovered);
  expect(external.sends).toEqual(effects);
  expect(chat.calls).toEqual(mutations);
  const upgraded = await postgres.backup(source);
  await expect(postgres.restore(upgraded, source)).rejects.toThrow(
    "completely empty",
  );
  const restored = await postgres.emptyDatabase();
  await postgres.restore(upgraded, restored);
  expect(await state(restored)).toEqual(recovered);
  await migrate(restored);
  expect(await state(restored)).toEqual(recovered);
  for (let pass = 0; pass < 2; pass++) {
    await recover(restored, recoveryEffects);
    expect(await state(restored)).toEqual(recovered);
    expect(external.sends).toEqual(effects);
    expect(chat.calls).toEqual(mutations);
  }
  const rollback = await postgres.emptyDatabase();
  await postgres.restore(legacy, rollback);
  expect(await state(rollback)).toEqual(legacyState);
  await migrate(rollback);
  // The legacy archive predates pending external effects completed above. Forward-upgrade
  // proves restoration; dispatch requires reconciliation of post-backup external receipts.
  const heldOwner = createDatabase(rollback.url);
  try {
    await currentReaders(heldOwner, rollback.url, recoveryEffects);
    const heldConfig = {
      ...config(rollback.url),
      deliveryMode: "disabled" as const,
      marketingEnabled: false,
    };
    const forbiddenTransport = {
      send: () => {
        throw new Error("Held restore cannot dispatch");
      },
    };
    const heldNotifications = new NotificationProvider(
      heldOwner,
      "inside",
      clock,
      { authorize: () => Promise.resolve(undefined) },
      {
        sendText: () => {
          throw new Error("Held restore cannot send notification");
        },
        editText: () => {
          throw new Error("Held restore cannot edit");
        },
      },
      Buffer.alloc(32, 1),
    );
    const heldWaitlist = new WaitlistConfirmations(
      heldOwner,
      heldConfig,
      clock,
      { current: () => Promise.resolve("unavailable") },
      forbiddenTransport,
    );
    const heldScheduler = new SequenceScheduler(
      heldOwner,
      heldConfig,
      clock,
      forbiddenTransport,
      signInReplyEligibility,
    );
    for (let pass = 0; pass < 2; pass++) {
      expect(await heldWaitlist.processAvailable()).toBe(0);
      expect(await heldScheduler.processAvailable()).toBe(0);
      await heldNotifications.processCategory("material");
      expect(
        await heldOwner
          .selectFrom("notification_commands")
          .select("state")
          .where("operation_id", "=", required(commands[2]).command.operationId)
          .executeTakeFirstOrThrow(),
      ).toEqual({ state: "retrying" });
      expect(
        await heldOwner
          .selectFrom("waitlist_confirmations")
          .select("state")
          .where("event_id", "=", required(waitlist[2]).eventId)
          .executeTakeFirstOrThrow(),
      ).toEqual({ state: "pending" });
      expect(
        (await receive(heldNotifications, required(commands[0]).command))
          ?.state,
      ).toBe("sent");
      expect(
        (await receive(heldNotifications, required(commands[1]).command))
          ?.state,
      ).toBe("unknown");
    }
  } finally {
    await heldOwner.destroy();
  }
  expect(external.sends).toEqual(effects);
  expect(chat.calls).toEqual(mutations);
  Object.assign(postgres.evidence, {
    image: postgres.image,
    versions: postgres.versions,
    legacy: { sha256: legacy.sha256, bytes: legacy.bytes },
    upgraded: { sha256: upgraded.sha256, bytes: upgraded.bytes },
    commands: postgres.commands,
    effects: external.sends,
    chat: chat.calls,
  });
}, 60_000);
