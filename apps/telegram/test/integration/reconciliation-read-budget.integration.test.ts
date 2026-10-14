import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from "vitest";
import type { Database, DatabaseSchema } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { CommunityProvider } from "../../src/modules/community/community-provider.js";
import { COMMUNITY_V2 } from "../../src/modules/community/community-contract.js";
import { seedCommunityBinding } from "../support/community-binding.js";
import { FakeCommunityChat } from "../support/community-chat.js";
import { required } from "../support/required.js";

let admin: Pool;
let database: Database | undefined;
let databaseName: string | undefined;
let statements: string[] = [];
let provider: CommunityProvider;
let capabilityRequests: number;
let memberRequests: number;
let observedUsers: Set<string>;
const instant = new Date("2030-01-01T00:00:00Z");
let at: Date;
const clock = { now: () => new Date(at) };
beforeAll(() => {
  admin = new Pool({
    connectionString: required(process.env["DATABASE_URL"]),
    max: 1,
  });
});
beforeEach(async () => {
  database = undefined;
  databaseName = undefined;
  const name = `bc4_1466_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  databaseName = name;
  const url = new URL(required(process.env["DATABASE_URL"]));
  url.pathname = `/${name}`;
  database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url.toString(), max: 10 }),
    }),
    log(event) {
      if (event.level === "query") statements.push(event.query.sql);
    },
  });
  await migrateToLatest(database);
  at = new Date(instant);
  capabilityRequests = 0;
  memberRequests = 0;
  observedUsers = new Set();
  statements = [];
  const chat = new FakeCommunityChat();
  chat.membership = "member";
  const capability = chat.readCapability.bind(chat);
  const member = chat.observeMember.bind(chat);
  chat.readCapability = () => {
    capabilityRequests++;
    return capability();
  };
  chat.observeMember = (_chat?: string, user?: string) => {
    if (user !== undefined) observedUsers.add(user);
    memberRequests++;
    return member();
  };
  provider = new CommunityProvider(
    database,
    "spec-1466-bc4",
    "-1000000000000",
    clock,
    {
      authorize: () =>
        Promise.resolve({
          contractVersion: "inside.billing-dispatch.v1",
          operation: "dispatch.result",
          operationId: "unused",
          attemptId: "unused",
          dispatchId: "unused",
          decision: { status: "unavailable" },
        }),
    },
    chat,
    { contractVersion: COMMUNITY_V2, reconciliationCadenceMs: 1000 },
  );
  for (let index = 1; index <= 25; index++) {
    const suffix = String(index).padStart(12, "0");
    const binding = {
      accountRef: `ee000000-0000-4000-8000-${suffix}`,
      telegramIdentityRef: `ef000000-0000-4000-8000-${suffix}`,
      linkRef: `e0000000-0000-4000-8000-${suffix}`,
      linkRevision: 1,
    };
    await seedCommunityBinding(
      database,
      binding,
      instant,
      String(90000 + index),
      "spec-1466-bc4",
    );
    const result = await provider.handle({
      contractVersion: COMMUNITY_V2,
      operation: "entitlement.set",
      operationId: `e1000000-0000-4000-8000-${suffix}`,
      correlationRef: `e2000000-0000-4000-8000-${suffix}`,
      entitlementRevision: 1,
      binding,
      access: { kind: "lifetime" },
      issuedAt: instant.toISOString(),
    });
    expect(result.status).toBe(200);
  }
});
afterEach(async () => {
  await database?.destroy();
  database = undefined;
  if (databaseName !== undefined)
    await admin.query(`DROP DATABASE ${databaseName}`);
});
afterAll(async () => {
  await admin.end();
});
it("shares the bot capability within its five-second lifetime and retains 25 distinct member observations", async () => {
  const measurements = [];
  statements = [];
  expect(await provider.processDueEffects(25)).toBe(25);
  measurements.push({
    phase: "effects",
    sqlStatements: statements.length,
    capabilityRequests,
    memberRequests,
  });
  expect(capabilityRequests).toBe(1);
  expect(memberRequests).toBe(25);
  expect(observedUsers.size).toBe(25);
  at = new Date(instant.getTime() + 4000);
  statements = [];
  expect(await provider.reconcileDueStates(25)).toBe(25);
  measurements.push({
    phase: "reconcile-within-lifetime",
    sqlStatements: statements.length,
    capabilityRequests,
    memberRequests,
  });
  expect(capabilityRequests).toBe(1);
  expect(memberRequests).toBe(50);
  at = new Date(instant.getTime() + 5000);
  statements = [];
  expect(await provider.reconcileDueStates(25)).toBe(25);
  measurements.push({
    phase: "reconcile-after-expiry",
    sqlStatements: statements.length,
    capabilityRequests,
    memberRequests,
  });
  expect(capabilityRequests).toBe(2);
  expect(memberRequests).toBe(75);
  process.stdout.write(
    "BC4 community counters " + JSON.stringify(measurements) + "\n",
  );
});
