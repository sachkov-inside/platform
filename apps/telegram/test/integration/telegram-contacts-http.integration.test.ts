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
import type { ApplicationConfig } from "../../src/config/application-config.js";

import { DATABASE, type Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { IdentityLinking } from "../../src/modules/identity-linking/identity-linking.js";
import {
  TELEGRAM_CONTACT_PROFILE,
  type ContactProfileResult,
} from "../../src/modules/identity-linking/telegram-contact-profile.js";
import { linkEffects } from "../../src/application/link-effects.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { required } from "../support/required.js";
import { telegramContactsResponseSchema } from "@inside/contracts/telegram-contact";
import {
  telegramContactSearchResponseSchema,
  telegramContactsV2ResponseSchema,
} from "@inside/contracts/telegram-contact-v2";
import corpus from "@inside/contracts/runtime/telegram-contact-v2.fixtures.json" with { type: "json" };
import { IdentityLinkRecovery } from "../../src/modules/identity-linking/identity-link-recovery.js";
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
let linkStatements: string[] = [];
let profileStatements: string[] = [];
const profile =
  vi.fn<(_id: string, _signal: AbortSignal) => Promise<ContactProfileResult>>();
const url = "/integrations/platform/v1/telegram-contacts";
const headers = { authorization: "Bearer synthetic_platform_secret" };
beforeAll(async () => {
  database = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl }),
    }),
    log(event) {
      if (
        event.level === "query" &&
        event.query.sql.includes('"platform_links"')
      )
        linkStatements.push(event.query.sql);
      if (
        event.level === "query" &&
        event.query.sql.includes("platform_link_profiles")
      )
        profileStatements.push(event.query.sql);
    },
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
  linkStatements = [];
  profileStatements = [];
  profile.mockReset();
  profile.mockResolvedValue({
    kind: "available",
    displayName: "Анна Смирнова",
    username: "anna_example",
  });
  await sql`truncate table identity_link_recoveries, identity_link_events, platform_link_profiles, platform_links, link_transactions, communication_contacts, bot_contacts restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await app.close();
  await database.destroy();
});
async function linked(index = 0) {
  const linking = new IdentityLinking(
    database,
    { now: () => new Date("2030-01-01T00:00:00.000Z") },
    linkEffects,
  );
  const challenge = await linking.register({
    accountRef: `account-ref-${index}`,
    returnCorrelation: `return-ref-${index}`,
    tokenDigest: createHash("sha256")
      .update(`synthetic-contact-link-${index}`)
      .digest("base64url"),
    expiresAt: new Date("2030-01-01T00:10:00.000Z"),
  });
  const transaction = await database
    .selectFrom("link_transactions")
    .select("token_digest")
    .where("link_transaction_ref", "=", challenge.linkTransactionRef)
    .executeTakeFirstOrThrow();
  await linking.acceptStart({
    botIdentity: "inside",
    telegramUserId: String(42 + index),
    observedAt: new Date("2030-01-01T00:00:00.000Z"),
    linkToken: { kind: "digest", digest: transaction.token_digest },
  });
  const confirmed = await linking.confirm({
    accountRef: `account-ref-${index}`,
    returnCorrelation: `return-ref-${index}`,
    linkTransactionRef: challenge.linkTransactionRef,
  });
  if (confirmed.status !== "linked")
    throw new Error("Fixture link was not confirmed");
  return {
    accountRef: `account-ref-${index}`,
    telegramIdentityRef: confirmed.telegramIdentityRef,
  };
}
function body(
  contacts: readonly { accountRef: string; telegramIdentityRef: string }[],
) {
  return { contractVersion: "inside.telegram-contact.v1", contacts };
}
async function read(
  contacts: readonly { accountRef: string; telegramIdentityRef: string }[],
) {
  const response = await fastify.inject({
    method: "POST",
    url,
    headers,
    payload: body(contacts),
  });
  expect(response.statusCode).toBe(200);
  const raw: unknown = response.json();
  return telegramContactsResponseSchema.parse(raw).contacts;
}
it("authenticates before looking up contacts and rejects malformed batches", async () => {
  for (const authorization of [undefined, "Bearer wrong"]) {
    const response = await fastify.inject({
      method: "POST",
      url,
      headers: authorization === undefined ? {} : { authorization },
      payload: { malformed: true },
    });
    expect(response.statusCode).toBe(401);
  }
  expect(
    (
      await fastify.inject({
        method: "POST",
        url,
        headers,
        payload: { malformed: true },
      })
    ).statusCode,
  ).toBe(400);
  expect(profile).not.toHaveBeenCalled();
});
it("reads only an exact current confirmed binding; username is optional", async () => {
  const query = await linked();
  expect(
    await read([
      { ...query, accountRef: "other" },
      { ...query, telegramIdentityRef: "other" },
    ]),
  ).toEqual([
    {
      ...query,
      accountRef: "other",
      status: "not_found",
      displayName: null,
      username: null,
    },
    {
      ...query,
      telegramIdentityRef: "other",
      status: "not_found",
      displayName: null,
      username: null,
    },
  ]);
  expect(profile).not.toHaveBeenCalled();
  expect(await read([query])).toEqual([
    {
      ...query,
      status: "available",
      displayName: "Анна Смирнова",
      username: "anna_example",
    },
  ]);
  expect(profile).toHaveBeenCalledWith("42", expect.any(AbortSignal));
  profile.mockResolvedValue({
    kind: "available",
    displayName: "Анна",
    username: null,
  });
  expect(await read([query])).toEqual([
    { ...query, status: "available", displayName: "Анна", username: null },
  ]);
});
it("clears the contact after unlink during the Telegram read, and reports upstream failure without a name", async () => {
  const query = await linked();
  profile.mockResolvedValueOnce({ kind: "unavailable" });
  expect(await read([query])).toEqual([
    { ...query, status: "unavailable", displayName: null, username: null },
  ]);
  profile.mockImplementationOnce(async () => {
    await database
      .deleteFrom("platform_links")
      .where("telegram_identity_ref", "=", query.telegramIdentityRef)
      .execute();
    return {
      kind: "available",
      displayName: "Старый контакт",
      username: "old_contact",
    };
  });
  expect(await read([query])).toEqual([
    { ...query, status: "not_found", displayName: null, username: null },
  ]);
});

it.each([1, 20, 100])(
  "enriches %i exact contacts with bounded local reads and at most four concurrent provider requests",
  async (size) => {
    const queries = [];
    for (let index = 0; index < size; index++)
      queries.push(await linked(index));
    let active = 0;
    let maximumActive = 0;
    const signals = new Set<AbortSignal>();
    profile.mockImplementation(async (_id, signal) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      signals.add(signal);
      await Promise.resolve();
      active--;
      return { kind: "available", displayName: "Контакт", username: null };
    });
    linkStatements = [];
    profileStatements = [];
    const result = await read(queries);
    expect(result).toEqual(
      queries.map((query) => ({
        ...query,
        status: "available",
        displayName: "Контакт",
        username: null,
      })),
    );
    expect(profile).toHaveBeenCalledTimes(size);
    expect(maximumActive).toBeGreaterThan(0);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(signals.size).toBe(1);
    expect(linkStatements).toHaveLength(2);
    expect(profileStatements).toHaveLength(1);
  },
);
it.each(["account", "confirmation"])(
  "clears stale provider identity after a concurrent %s replacement",
  async (replacement) => {
    const query = await linked();
    const other = await linked(1);
    const otherBinding = await database
      .selectFrom("platform_links")
      .select("link_transaction_ref")
      .where("telegram_identity_ref", "=", other.telegramIdentityRef)
      .executeTakeFirstOrThrow();
    profile.mockImplementationOnce(async () => {
      await database
        .updateTable("platform_links")
        .set(
          replacement === "account"
            ? { account_ref: other.accountRef }
            : { link_transaction_ref: otherBinding.link_transaction_ref },
        )
        .where("telegram_identity_ref", "=", query.telegramIdentityRef)
        .execute();
      return {
        kind: "available",
        displayName: "Старый контакт",
        username: null,
      };
    });
    expect(await read([query])).toEqual([
      { ...query, status: "not_found", displayName: null, username: null },
    ]);
  },
);

const v2 = "/integrations/platform/v2/telegram-contacts";
async function post(path: "read" | "search", payload: object) {
  return fastify.inject({
    method: "POST",
    url: `${v2}/${path}`,
    headers,
    payload,
  });
}
async function search(query: string, limit = 50) {
  const response = await post("search", {
    contractVersion: "inside.telegram-contact.v2",
    query,
    limit,
  });
  expect(response.statusCode).toBe(200);
  const raw: unknown = response.json();
  return telegramContactSearchResponseSchema.parse(raw);
}
async function observed(
  query: { accountRef: string; telegramIdentityRef: string },
  displayName: string | null,
  username: string | null,
) {
  profile.mockResolvedValueOnce({ kind: "available", displayName, username });
  expect(await read([query])).toEqual([
    { ...query, status: "available", displayName, username },
  ]);
}

it("authenticates v2 before parsing, then rejects every invalid corpus request with 400", async () => {
  for (const path of ["read", "search"] as const)
    for (const authorization of [
      undefined,
      "Bearer wrong",
      "synthetic_platform_secret",
    ]) {
      const response = await fastify.inject({
        method: "POST",
        url: `${v2}/${path}`,
        headers: authorization === undefined ? {} : { authorization },
        payload: corpus[path].validRequests[0]?.body ?? {},
      });
      expect(response.statusCode).toBe(401);
    }
  for (const path of ["read", "search"] as const)
    for (const invalid of corpus[path].invalidRequests)
      expect((await post(path, invalid.body)).statusCode, invalid.case).toBe(
        400,
      );
  expect(profile).not.toHaveBeenCalled();
});

it("answers every valid corpus request with a response of the v2 contract", async () => {
  for (const valid of corpus.search.validRequests) {
    const response = await post("search", valid.body);
    expect(response.statusCode, valid.case).toBe(200);
    expect(telegramContactSearchResponseSchema.parse(response.json())).toEqual({
      contractVersion: "inside.telegram-contact.v2",
      matches: [],
      truncated: false,
    });
  }
  for (const valid of corpus.read.validRequests) {
    const response = await post("read", valid.body);
    expect(response.statusCode, valid.case).toBe(200);
    const raw: unknown = response.json();
    expect(telegramContactsV2ResponseSchema.parse(raw).contacts).toHaveLength(
      valid.body.contacts.length,
    );
  }
});

it("reads v2 contacts with the communications /stop state and nothing for a foreign pair", async () => {
  const [enabled, stopped, unknown] = [
    await linked(0),
    await linked(1),
    await linked(2),
  ];
  await sql`insert into bot_contacts(bot_identity, telegram_user_id, private_chat_id, contactability, first_started_at, last_started_at, updated_at)
    select 'inside', id, id, 'reachable', ts, ts, ts from unnest(array[42, 43]::bigint[]) as id, (select timestamptz '2030-01-01T00:00:00Z' as ts) as fixed`.execute(
    database,
  );
  await sql`insert into communication_contacts(contact_id, bot_identity, telegram_user_id, marketing_enabled)
    values (gen_random_uuid(), 'inside', 42, true), (gen_random_uuid(), 'inside', 43, false)`.execute(
    database,
  );
  profile.mockImplementation((id) =>
    Promise.resolve(
      id === "43"
        ? { kind: "unavailable" }
        : { kind: "available", displayName: `Контакт ${id}`, username: null },
    ),
  );
  const response = await post("read", {
    contractVersion: "inside.telegram-contact.v2",
    contacts: [enabled, stopped, unknown, { ...enabled, accountRef: "other" }],
  });
  expect(response.statusCode).toBe(200);
  const raw: unknown = response.json();
  expect(telegramContactsV2ResponseSchema.parse(raw)).toEqual({
    contractVersion: "inside.telegram-contact.v2",
    contacts: [
      {
        ...enabled,
        status: "available",
        displayName: "Контакт 42",
        username: null,
        marketing: "enabled",
      },
      {
        ...stopped,
        status: "unavailable",
        displayName: null,
        username: null,
        marketing: "stopped",
      },
      {
        ...unknown,
        status: "available",
        displayName: "Контакт 44",
        username: null,
        marketing: "unknown",
      },
      {
        ...enabled,
        accountRef: "other",
        status: "not_found",
        displayName: null,
        username: null,
        marketing: "unknown",
      },
    ],
  });
});

it("searches stored names and usernames case-insensitively, without @ and only over current links", async () => {
  const anna = await linked(0);
  const boris = await linked(1);
  const plain = await linked(2);
  await observed(anna, "Анна Смирнова", "anna_example");
  await observed(boris, "Борис Ёлкин", null);
  await observed(plain, null, "plain_user");
  const match = (
    query: typeof anna,
    displayName: string | null,
    username: string | null,
  ) => ({
    ...query,
    displayName,
    username,
  });
  expect(await search("СМИР")).toEqual({
    contractVersion: "inside.telegram-contact.v2",
    matches: [match(anna, "Анна Смирнова", "anna_example")],
    truncated: false,
  });
  expect((await search("  @ANNA_ex ")).matches).toEqual([
    match(anna, "Анна Смирнова", "anna_example"),
  ]);
  expect((await search("елкин")).matches).toEqual([
    match(boris, "Борис Ёлкин", null),
  ]);
  expect((await search("user")).matches).toEqual([
    match(plain, null, "plain_user"),
  ]);
  // The name and the username are separate fields: a query never spans both.
  expect((await search("смирнова anna")).matches).toEqual([]);
});

it("treats LIKE metacharacters as literal text", async () => {
  const percent = await linked(0);
  const underscore = await linked(1);
  const backslash = await linked(2);
  await observed(percent, "Скидка 50% всем", null);
  await observed(underscore, "Скидка 50 всем", "a_b");
  await observed(backslash, "Путь C:\\new", "axb");
  expect((await search("50%")).matches.map((item) => item.accountRef)).toEqual([
    percent.accountRef,
  ]);
  expect((await search("a_b")).matches.map((item) => item.accountRef)).toEqual([
    underscore.accountRef,
  ]);
  expect((await search("%")).matches.map((item) => item.accountRef)).toEqual([
    percent.accountRef,
  ]);
  expect((await search("_")).matches.map((item) => item.accountRef)).toEqual([
    underscore.accountRef,
  ]);
  expect((await search("\\")).matches.map((item) => item.accountRef)).toEqual([
    backslash.accountRef,
  ]);
});

it("returns at most the requested limit and reports truncation", async () => {
  for (let index = 0; index < 4; index++)
    await observed(await linked(index), `Контакт ${String(index)}`, null);
  const page = await search("контакт", 3);
  expect(page.matches.map((item) => item.displayName)).toEqual([
    "Контакт 0",
    "Контакт 1",
    "Контакт 2",
  ]);
  expect(page.truncated).toBe(true);
  expect((await search("контакт", 4)).truncated).toBe(false);
});

it("never finds a transferred link by the name observed before the transfer", async () => {
  const source = await linked(0);
  await observed(source, "Анна Смирнова", "anna_example");
  expect((await search("анна")).matches).toHaveLength(1);
  const linking = new IdentityLinking(
    database,
    { now: () => new Date("2030-01-01T00:00:00.000Z") },
    linkEffects,
  );
  const challenge = await linking.register({
    accountRef: "account-ref-target",
    returnCorrelation: "return-ref-target",
    tokenDigest: createHash("sha256")
      .update("synthetic-contact-transfer")
      .digest("base64url"),
    expiresAt: new Date("2030-01-01T00:10:00.000Z"),
  });
  const transaction = await database
    .selectFrom("link_transactions")
    .select("token_digest")
    .where("link_transaction_ref", "=", challenge.linkTransactionRef)
    .executeTakeFirstOrThrow();
  await linking.acceptStart({
    botIdentity: "inside",
    telegramUserId: "42",
    observedAt: new Date("2030-01-01T00:00:00.000Z"),
    linkToken: { kind: "digest", digest: transaction.token_digest },
  });
  const recovery = await app.get(IdentityLinkRecovery).execute({
    confirmedSourceAccountRef: source.accountRef,
    confirmedTargetAccountRef: "account-ref-target",
    operatorRef: "synthetic-operator",
    reasonRef: "synthetic-reason",
    recoveryRef: "synthetic-recovery",
    sourceAccountRef: source.accountRef,
    targetAccountRef: "account-ref-target",
    targetLinkTransactionRef: challenge.linkTransactionRef,
    telegramIdentityRef: source.telegramIdentityRef,
  });
  expect(recovery).toMatchObject({ ok: true, outcome: "transferred" });
  expect((await search("анна")).matches).toEqual([]);
  expect(
    await post("read", {
      contractVersion: "inside.telegram-contact.v2",
      contacts: [source],
    }).then((response) => response.json<unknown>()),
  ).toEqual({
    contractVersion: "inside.telegram-contact.v2",
    contacts: [
      {
        ...source,
        status: "not_found",
        displayName: null,
        username: null,
        marketing: "unknown",
      },
    ],
  });
});
