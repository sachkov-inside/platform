import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { linkEffects } from "../../src/application/link-effects.js";
import type { ApplicationConfig } from "../../src/config/application-config.js";
import { DATABASE, type Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { IdentityLinkRecovery } from "../../src/modules/identity-linking/identity-link-recovery.js";
import { IdentityLinking } from "../../src/modules/identity-linking/identity-linking.js";
import { LinkProfiles } from "../../src/modules/identity-linking/link-profiles.js";
import {
  TELEGRAM_CONTACT_PROFILE,
  type ContactProfileResult,
} from "../../src/modules/identity-linking/telegram-contact-profile.js";
import { TelegramContacts } from "../../src/modules/identity-linking/telegram-contacts.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { closeIfStarted } from "../support/close-if-started.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";
import {
  privateContactabilityUpdate,
  privateStartUpdate,
} from "../support/synthetic-telegram-updates.js";

registerFixedClock();
const databaseUrl = required(process.env["DATABASE_URL"]);
const config: ApplicationConfig = {
  marketingEnabled: false,
  botIdentity: "inside",
  canonicalChatId: "-1000000000000",
  databaseUrl,
  deliveryMode: "disabled",
  evidenceDeliveryMode: "disabled",
  host: "127.0.0.1",
  linkReceiptText: "Synthetic link receipt",
  linkedMemberText: "Synthetic member status",
  linkedNonMemberText: "Synthetic non-member status",
  linkedUnavailableText: "Synthetic unavailable status",
  communityMode: "disabled",
  communityReconciliationCadenceMilliseconds: 60_000,
  communityTexts: {
    invite: "Synthetic community invite",
    preparing: "Synthetic community preparing",
    member: "Synthetic community member",
    unavailable: "Synthetic community unavailable",
    readmission: "Synthetic community readmission",
    welcome: "Synthetic community welcome",
  },
  membershipCheckRetentionDays: 90,
  salesFunnelEventRetentionDays: 30,
  membershipMode: "disabled",
  membershipReconciliationCadenceMilliseconds: 240_000,
  platformIntegrationSecret: "synthetic_platform_secret",
  port: 3002,
  webhookSecret: "synthetic_webhook_secret",
  welcomeText: "Synthetic welcome",
  workersEnabled: false,
};

let app: NestFastifyApplication;
let database: Database;
let fastify: FastifyInstance;
let updateId = 500;
const profile =
  vi.fn<(_id: string, _signal: AbortSignal) => Promise<ContactProfileResult>>();

beforeAll(async () => {
  database = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl }),
    }),
  });
  await migrateToLatest(database);
  const testing = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(DATABASE)
    .useValue(database)
    .overrideProvider(TELEGRAM_CONTACT_PROFILE)
    .useValue({ read: profile })
    .compile();
  app = testing.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
});
beforeEach(async () => {
  profile.mockReset();
  await sql`
    truncate table
      identity_link_recoveries,
      identity_link_events,
      platform_link_profiles,
      platform_links,
      link_transactions,
      start_response_delivery_attempts,
      start_response_deliveries,
      bot_contact_events,
      communication_contacts,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
});
afterAll(async () => {
  try {
    await closeIfStarted(app);
  } finally {
    await database.destroy();
  }
});

function linking() {
  return new IdentityLinking(
    database,
    { now: () => new Date(fixedTestInstant()) },
    linkEffects,
  );
}
async function register(label: string, telegramUserId: string) {
  const challenge = await linking().register({
    accountRef: `account-ref-${label}`,
    returnCorrelation: `return-ref-${label}`,
    tokenDigest: createHash("sha256")
      .update(`synthetic-profile-link-${label}`)
      .digest("base64url"),
    expiresAt: new Date(fixedTestInstant() + 600_000),
  });
  const transaction = await database
    .selectFrom("link_transactions")
    .select("token_digest")
    .where("link_transaction_ref", "=", challenge.linkTransactionRef)
    .executeTakeFirstOrThrow();
  await linking().acceptStart({
    botIdentity: "inside",
    telegramUserId,
    observedAt: new Date(fixedTestInstant()),
    linkToken: { kind: "digest", digest: transaction.token_digest },
  });
  return challenge.linkTransactionRef;
}
async function linked(label: string, telegramUserId: string) {
  const linkTransactionRef = await register(label, telegramUserId);
  const confirmed = await linking().confirm({
    accountRef: `account-ref-${label}`,
    returnCorrelation: `return-ref-${label}`,
    linkTransactionRef,
  });
  if (confirmed.status !== "linked")
    throw new Error("Fixture link was not confirmed");
  return {
    accountRef: `account-ref-${label}`,
    telegramIdentityRef: confirmed.telegramIdentityRef,
  };
}
async function stored() {
  return database
    .selectFrom("platform_link_profiles")
    .select(["telegram_identity_ref", "display_name", "username"])
    .orderBy("telegram_identity_ref")
    .execute();
}
async function deliver(payload: object) {
  const response = await fastify.inject({
    method: "POST",
    url: "/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
    payload,
  });
  expect(response.statusCode).toBe(202);
  await app.get(TelegramUpdateProcessor).processAvailable();
  const processed = await database
    .selectFrom("telegram_updates")
    .select("state")
    .orderBy("update_id", "desc")
    .executeTakeFirstOrThrow();
  expect(processed.state).toBe("processed");
}
function withSender(
  update: ReturnType<typeof privateStartUpdate>,
  sender: Record<string, unknown>,
) {
  return {
    ...update,
    message: {
      ...update.message,
      from: { ...update.message.from, ...sender },
    },
  };
}

it("stores the sender profile of a linked user's /start and refreshes it on the next update", async () => {
  const link = await linked("anna", "42");
  await deliver(
    withSender(privateStartUpdate(++updateId, 42), {
      first_name: "Анна",
      last_name: "Смирнова",
      username: "anna_example",
    }),
  );
  expect(await stored()).toEqual([
    {
      telegram_identity_ref: link.telegramIdentityRef,
      display_name: "Анна Смирнова",
      username: "anna_example",
    },
  ]);
  const blocked = privateContactabilityUpdate(++updateId, 42, "kicked");
  await deliver({
    ...blocked,
    my_chat_member: {
      ...blocked.my_chat_member,
      from: { ...blocked.my_chat_member.from, first_name: "Анна" },
    },
  });
  expect(await stored()).toEqual([
    {
      telegram_identity_ref: link.telegramIdentityRef,
      display_name: "Анна",
      username: null,
    },
  ]);
});

it("does not store users without a current link of this bot", async () => {
  await deliver(
    withSender(privateStartUpdate(++updateId, 77), {
      first_name: "Без привязки",
      username: "unlinked_user",
    }),
  );
  await linked("other", "78");
  await app.get(LinkProfiles).observe({
    botIdentity: "other-bot",
    telegramUserId: "78",
    observedAt: new Date(fixedTestInstant()),
    profile: { displayName: "Другой бот", username: null },
  });
  expect(await stored()).toEqual([]);
});

it("stores the profile read for an available current contact only", async () => {
  const link = await linked("anna", "42");
  const absent = await linked("boris", "43");
  profile.mockImplementation((id) =>
    Promise.resolve(
      id === "42"
        ? { kind: "available", displayName: "Анна", username: "anna_example" }
        : { kind: "unavailable" },
    ),
  );
  await app
    .get(TelegramContacts)
    .read([link, absent, { ...link, accountRef: "account-ref-other" }]);
  expect(await stored()).toEqual([
    {
      telegram_identity_ref: link.telegramIdentityRef,
      display_name: "Анна",
      username: "anna_example",
    },
  ]);
});

it("ignores an observation older than the stored one", async () => {
  const link = await linked("anna", "42");
  const profiles = app.get(LinkProfiles);
  const at = (offset: number) => new Date(fixedTestInstant() + offset);
  await profiles.observe({
    botIdentity: "inside",
    telegramUserId: "42",
    observedAt: at(60_000),
    profile: { displayName: "Новое имя", username: null },
  });
  await profiles.observe({
    botIdentity: "inside",
    telegramUserId: "42",
    observedAt: at(0),
    profile: { displayName: "Старое имя", username: "old_name" },
  });
  expect(await stored()).toEqual([
    {
      telegram_identity_ref: link.telegramIdentityRef,
      display_name: "Новое имя",
      username: null,
    },
  ]);
  await profiles.observe({
    botIdentity: "inside",
    telegramUserId: "42",
    observedAt: at(120_000),
    profile: { displayName: "Ещё новее", username: "newest" },
  });
  expect(await stored()).toEqual([
    {
      telegram_identity_ref: link.telegramIdentityRef,
      display_name: "Ещё новее",
      username: "newest",
    },
  ]);
});

it("deletes the stored profile in the transfer transaction", async () => {
  const source = await linked("source", "42");
  await app.get(LinkProfiles).observe({
    botIdentity: "inside",
    telegramUserId: "42",
    observedAt: new Date(fixedTestInstant()),
    profile: { displayName: "Анна", username: "anna_example" },
  });
  expect(await stored()).toHaveLength(1);
  const target = await register("target", "42");
  const result = await app.get(IdentityLinkRecovery).execute({
    confirmedSourceAccountRef: source.accountRef,
    confirmedTargetAccountRef: "account-ref-target",
    operatorRef: "synthetic-operator",
    reasonRef: "synthetic-reason",
    recoveryRef: "synthetic-profile-recovery",
    sourceAccountRef: source.accountRef,
    targetAccountRef: "account-ref-target",
    targetLinkTransactionRef: target,
    telegramIdentityRef: source.telegramIdentityRef,
  });
  expect(result).toMatchObject({ ok: true, outcome: "transferred" });
  expect(await stored()).toEqual([]);
  // A read of the former pair finds no current link and stores nothing.
  await app.get(TelegramContacts).read([source]);
  expect(await stored()).toEqual([]);
});

it("answers the read when storing the observed profile fails, and logs only a technical code", async () => {
  const link = await linked("anna", "42");
  profile.mockResolvedValue({
    kind: "available",
    displayName: "Анна",
    username: "anna_example",
  });
  await sql`create function reject_link_profile() returns trigger language plpgsql
    as $$ begin raise exception 'synthetic profile write failure'; end $$`.execute(
    database,
  );
  await sql`create trigger reject_link_profile before insert or update on platform_link_profiles
    for each row execute function reject_link_profile()`.execute(database);
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  try {
    expect(await app.get(TelegramContacts).read([link])).toEqual([
      {
        ...link,
        status: "available",
        displayName: "Анна",
        username: "anna_example",
      },
    ]);
    const lines = stderr.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([
      `${JSON.stringify({ level: "error", scope: "identity-linking.link-profile-observe", failure: "pg_P0001" })}\n`,
    ]);
  } finally {
    stderr.mockRestore();
    await sql`drop trigger reject_link_profile on platform_link_profiles`.execute(
      database,
    );
    await sql`drop function reject_link_profile()`.execute(database);
  }
  expect(await stored()).toEqual([]);
});
