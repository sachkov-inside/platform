import {
  CommunityEntitlements,
  TelegramAccountLinks,
} from "../../src/modules/telegram-membership/index.js";
import {
  type CommunitySetCommand,
  communityResultSchema,
} from "../../src/modules/telegram-membership/domain/community-entitlement.js";
import type { CommunityDeliveryOutcome } from "../../src/modules/telegram-membership/ports/community-entitlement-provider.js";
import { contractDigest } from "../../src/infrastructure/contracts/canonical-digest.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  assembleAccounts,
  type Accounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import { migrateBefore } from "./setup/historical-upgrade.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let db: TestDatabase;
let rights: AccessGrants;
let accounts: Accounts;
const account = randomUUID();
const product = randomUUID();
const foreignProduct = randomUUID();
const now = new Date("2030-01-15T00:00:00.000Z");
const start = new Date("2020-01-01T00:00:00.000Z");
const finish = new Date("2030-02-01T00:00:00.000Z");

beforeEach(async () => {
  db = await createTestDatabase();
  await migrateBefore(db, "0090_explicit_community_rights");
  await db.prisma.account.create({
    data: {
      id: account,
      logtoIssuer: "https://historical-community.test",
      logtoSubject: account,
    },
  });
  // This fixture is deliberately older than the generated Product model.
  // Seed only columns owned by its historical migration boundary.
  for (const id of [product, foreignProduct]) {
    await db.prisma.$executeRaw(Prisma.sql`
      insert into materials.series (id, slug, name)
      values (${id}::uuid, ${`historical-${id}`}, ${`Course ${id}`})
    `);
  }
  accounts = assembleAccounts({
    prisma: db.prisma,
    emailFingerprintKey: "historical-community-fixture-fingerprint-key",
  });
  rights = assembleAccessGrants({
    prisma: db.prisma,
    accounts,
    contentCatalog: new CoverageCatalog(db.prisma),
    clock: () => now,
  });
});
afterEach(async () => db.dispose());

async function historicalGrant(
  capabilities: string[],
  validUntil: Date | null = null,
) {
  const id = randomUUID();
  await db.prisma.accessGrant.create({
    data: {
      id,
      accountId: account,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities,
      coverage: { productIds: [], materialIds: [] },
      startsAt: start,
      validUntil,
      revision: 1,
      reason: "Historical community fixture",
    },
  });
  await db.prisma.accessChange.create({
    data: {
      accountId: account,
      grantId: id,
      operationId: randomUUID(),
      kind: "manual_granted",
      reason: "Historical community fixture",
      recordedAt: start,
    },
  });
  return id;
}
async function migrateHistoricalBaseline() {
  await migrateBefore(db, "0095_historical_community_coverage");
}

async function expectCommunity(productId: string, validUntil: string | null) {
  const result = await rights.resolveCapabilities(account, {
    productIds: [productId],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected readable community rights");
  expect(result.capabilities).toContainEqual({
    capability: "community",
    validUntil,
  });
}

test("repairs a historical Product grant at the public own-Product and scoped capability seams", async () => {
  const grantId = await historicalGrant([`product:${product}`, "support"]);
  await migrateHistoricalBaseline();
  expect(await rights.readOwnProducts(account)).toMatchObject({
    ok: true,
    value: [
      {
        id: product,
        materials: { state: "available" },
        community: { state: "unavailable" },
      },
    ],
  });
  await migrateToLatest(db.url);
  expect(await rights.readOwnProducts(account)).toMatchObject({
    ok: true,
    value: [
      {
        id: product,
        materials: { state: "available" },
        community: { state: "available" },
      },
    ],
  });
  await expectCommunity(product, null);
  const foreign = await rights.resolveCapabilities(account, {
    productIds: [foreignProduct],
  });
  expect(
    foreign.ok &&
      foreign.capabilities.some(({ capability }) => capability === "community"),
  ).toBe(false);
  await linkTelegramAccount(db.prisma, {
    accountId: account,
    identityRef: `historical-${account}`,
    now,
  });
  const sent: CommunitySetCommand[] = [];
  const answer = (
    command: CommunitySetCommand,
  ): Promise<CommunityDeliveryOutcome> =>
    Promise.resolve({
      kind: "result",
      result: communityResultSchema.parse({
        contractVersion: command.contractVersion,
        operation: "entitlement.result",
        operationId: command.operationId,
        binding: command.binding,
        entitlementRevision: command.entitlementRevision,
        access: command.access,
        status: "applied",
        observedMembership: "member",
        admissionRestriction: "none",
        groupUrl: "https://t.me/c/1234567890/1",
        updatedAt: now.toISOString(),
      }),
    });
  const community = new CommunityEntitlements({
    botStartUrl: "https://t.me/historical_fixture_bot",
    accounts,
    prisma: db.prisma,
    grants: rights,
    links: new TelegramAccountLinks(db.prisma),
    clock: () => now,
    provider: {
      set: (command) => {
        sent.push(command);
        return answer(command);
      },
      status: answer,
    },
  });
  expect(await community.prepareOwnAdmission(account)).toMatchObject({
    state: "ready",
  });
  expect(
    await community.readOwnProductCommunityEntry(account, product),
  ).toEqual({ kind: "member", groupUrl: "https://t.me/c/1234567890/1" });
  expect(sent).toHaveLength(1);
  const command = sent[0];
  if (command === undefined)
    throw new Error("Expected a delivered historical community entitlement");
  expect(command.access).toEqual({ kind: "lifetime" });
  const permit = {
    attemptId: randomUUID(),
    contractVersion: "inside.billing-dispatch.v1" as const,
    dispatchContractVersion: "inside.community-entitlement.v2" as const,
    dispatchId: command.operationId,
    effect: "community.ensure_admission" as const,
    effectRef: randomUUID(),
    operation: "dispatch.authorize" as const,
    operationId: randomUUID(),
    payloadDigest: contractDigest(command),
  };
  expect(await community.authorizeDispatch(permit)).toMatchObject({
    ok: true,
    result: { decision: { status: "allowed" } },
  });
  await db.prisma.productAccessExclusion.create({
    data: {
      accountId: account,
      productId: product,
      grantIds: [grantId],
      actorId: account,
      reason: "Product withdrawn",
      revokedAt: now,
    },
  });
  expect(await rights.readOwnProducts(account)).toMatchObject({
    ok: true,
    value: [
      {
        id: product,
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  });
  expect(
    await community.authorizeDispatch({
      ...permit,
      attemptId: randomUUID(),
      operationId: randomUUID(),
    }),
  ).toMatchObject({ ok: true, result: { decision: { status: "denied" } } });
});

test("preserves a historical unscoped support community term across Product exclusions and revocation", async () => {
  const grantId = await historicalGrant(["support"], finish);
  await migrateHistoricalBaseline();
  const original = await db.prisma.accessGrant.findUniqueOrThrow({
    where: { id: grantId },
  });
  const before = await rights.resolveCapabilities(account, {
    productIds: [product],
  });
  expect(
    before.ok &&
      before.capabilities.some(({ capability }) => capability === "community"),
  ).toBe(false);
  await migrateToLatest(db.url);
  expect(
    await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } }),
  ).toEqual({ ...original, coverage: null });
  await db.prisma.productAccessExclusion.create({
    data: {
      accountId: account,
      productId: product,
      grantIds: [grantId],
      actorId: account,
      reason: "Product withdrawn, independent historical group right remains",
      revokedAt: now,
    },
  });
  for (const productId of [product, foreignProduct]) {
    await expectCommunity(productId, finish.toISOString());
  }
  const batch = await rights.resolveCapabilitiesForAccounts([account], {
    productIds: [product],
  });
  expect(batch.ok && batch.accounts.get(account)?.capabilities).toContainEqual({
    capability: "community",
    validUntil: finish.toISOString(),
  });
  await db.prisma.accessGrant.update({
    where: { id: grantId },
    data: { revokedAt: now },
  });
  const revoked = await rights.resolveCapabilities(account, {
    productIds: [product],
  });
  expect(
    revoked.ok &&
      revoked.capabilities.some(({ capability }) => capability === "community"),
  ).toBe(false);
});

test("does not extend a completed historical community term", async () => {
  const grantId = await historicalGrant(
    ["community"],
    new Date("2030-01-10T00:00:00.000Z"),
  );
  await migrateHistoricalBaseline();
  const original = await db.prisma.accessGrant.findUniqueOrThrow({
    where: { id: grantId },
  });
  await migrateToLatest(db.url);
  expect(
    await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } }),
  ).toEqual({ ...original, coverage: null });
  expect(
    await rights.resolveCapabilities(account, { productIds: [product] }),
  ).toMatchObject({ ok: true, capabilities: [] });
});

test("leaves explicit scopes, unjournaled grants, new backdated grants and later decisions unchanged", async () => {
  const explicit = await historicalGrant(["community"]);
  const materialScoped = await historicalGrant(["community"]);
  const allProducts = await historicalGrant(["community"]);
  const noJournal = await historicalGrant(["community"]);
  const editedLater = await historicalGrant(["community"]);
  const noCommunity = await historicalGrant(["materials"], finish);
  await db.prisma.accessGrant.update({
    where: { id: explicit },
    data: { coverage: { productIds: [foreignProduct], materialIds: [] } },
  });
  await db.prisma.accessGrant.update({
    where: { id: materialScoped },
    data: { coverage: { productIds: [], materialIds: [randomUUID()] } },
  });
  await db.prisma.accessGrant.update({
    where: { id: allProducts },
    data: {
      coverage: { productIds: [], materialIds: [], wholePlatform: true },
    },
  });
  await db.prisma.accessChange.deleteMany({ where: { grantId: noJournal } });
  await migrateHistoricalBaseline();
  const cutoff = z
    .array(z.strictObject({ applied_at: z.date() }))
    .parse(
      await db.prisma
        .$queryRaw`SELECT applied_at FROM public.platform_migrations WHERE name = '0090_explicit_community_rights'`,
    );
  const appliedAt = cutoff[0]?.applied_at;
  if (appliedAt === undefined)
    throw new Error("Historical migration boundary missing");
  const later = new Date(appliedAt.getTime() + 60_000);
  const newGrant = await historicalGrant(["community"]);
  await db.prisma.accessChange.updateMany({
    where: { grantId: newGrant },
    data: { recordedAt: later },
  });
  await db.prisma.accessChange.create({
    data: {
      accountId: account,
      grantId: editedLater,
      operationId: randomUUID(),
      kind: "manual_changed",
      reason: "Later explicit decision",
      recordedAt: later,
    },
  });
  const ids = [
    explicit,
    materialScoped,
    allProducts,
    noJournal,
    editedLater,
    noCommunity,
    newGrant,
  ];
  const original = await db.prisma.accessGrant.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
  });
  await migrateToLatest(db.url);
  expect(
    await db.prisma.accessGrant.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(original);
  expect(await migrateToLatest(db.url)).toEqual({ appliedMigrations: [] });
  expect(
    await db.prisma.accessGrant.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(original);
});

test("uses a frozen paid Product scope without modifying purchases or grant terms", async () => {
  const purchaseId = randomUUID();
  const quoteRef = randomUUID();
  const snapshot = JSON.stringify({
    offer: { benefits: [`product:${product}`, "support"] },
  });
  // This fixture reconstructs pre-0090 storage. The current Prisma model already knows
  // 0094's payment_link_id; explicit historical columns must not request that future field.
  await db.prisma.$executeRaw(Prisma.sql`
    INSERT INTO billing.price_quotes
      (id, account_id, operation_id, fingerprint, snapshot, created_at, expires_at)
    VALUES (${quoteRef}::uuid, ${account}::uuid, ${randomUUID()}::uuid,
      ${quoteRef}, ${snapshot}::jsonb, ${start}, ${finish})
  `);
  await db.prisma.$executeRaw(Prisma.sql`
    INSERT INTO billing.purchases
      (id, account_id, kind, quote_ref, state, lifecycle_active, environment,
       terminal_ref, amount_kopecks, snapshot, acceptance, contact, fiscalization,
       created_at, updated_at, confirmed_at)
    VALUES (${purchaseId}::uuid, ${account}::uuid, 'one_time', ${quoteRef}::uuid,
      'confirmed', false, 'test', 'HISTORICAL', 1000, ${snapshot}::jsonb,
      '{}'::jsonb, '{}'::jsonb, 'pending', ${start}, ${start}, ${start})
  `);
  const grantId = await historicalGrant(["community"], finish);
  await db.prisma.accessGrant.update({
    where: { id: grantId },
    data: { source: "paid", sourceRef: `${purchaseId}:community` },
  });
  await migrateHistoricalBaseline();
  const original = await db.prisma.accessGrant.findUniqueOrThrow({
    where: { id: grantId },
  });
  const purchase = await db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseId },
  });
  await migrateToLatest(db.url);
  expect(
    await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } }),
  ).toEqual({
    ...original,
    coverage: { productIds: [product], materialIds: [] },
  });
  expect(
    await db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchaseId },
    }),
  ).toEqual(purchase);
  await expectCommunity(product, finish.toISOString());
  const foreign = await rights.resolveCapabilities(account, {
    productIds: [foreignProduct],
  });
  expect(
    foreign.ok &&
      foreign.capabilities.some(({ capability }) => capability === "community"),
  ).toBe(false);
});
