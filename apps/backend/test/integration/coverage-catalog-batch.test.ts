import {
  CommunityEntitlements,
  TelegramAccountLinks,
} from "../../src/modules/telegram-membership/index.js";
import { disabledCommunityEntitlementProvider } from "../../src/modules/telegram-membership/ports/community-entitlement-provider.js";
import { randomUUID } from "node:crypto";
import {
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { BillingPayments } from "../../src/modules/billing/index.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { PrismaClient } from "../../src/infrastructure/prisma/generated/client.js";
import { createPrismaPgAdapter } from "../../src/infrastructure/prisma/prisma-adapter.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

const active = "10000000-0000-4000-8000-000000000001";
const archived = "10000000-0000-4000-8000-000000000002";
const missing = "10000000-0000-4000-8000-000000000003";
let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
function createTrackedPrisma(url: string) {
  return new PrismaClient({
    adapter: createPrismaPgAdapter(url),
    log: [{ emit: "event", level: "query" }],
  });
}
let prisma: ReturnType<typeof createTrackedPrisma>;
let catalog: CoverageCatalog;
let queries = 0;
let mappingReads = 0;

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  prisma = createTrackedPrisma(database.url);
  prisma.$on("query", (event) => {
    queries += 1;
    if (event.query.includes("product_communities")) mappingReads += 1;
  });
  catalog = new CoverageCatalog(prisma);
  await prisma.product.createMany({
    data: [
      { id: active, name: "Active", slug: "active" },
      {
        id: archived,
        name: "Archived",
        slug: "archived",
        archivedAt: new Date("2030-01-01T00:00:00Z"),
      },
    ],
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  await database.dispose();
});

test("resolves multiple scopes in one SQL read without mixing archived Products", async () => {
  const scopes = [
    { productIds: [missing, active, archived], materialIds: [] },
    { productIds: [], materialIds: [], wholePlatform: true },
    { productIds: [archived], materialIds: [] },
  ];
  queries = 0;
  const individual = await Promise.all(
    scopes.map((scope) => catalog.resolve(scope)),
  );
  expect(queries).toBe(3);
  queries = 0;
  const batch = await catalog.resolveMany(scopes);
  expect(queries).toBe(1);
  expect(batch).toEqual(individual);
  expect(batch[0]?.map((entry) => entry.id)).toEqual([
    missing,
    active,
    archived,
  ]);
  expect(batch[1]?.map((entry) => entry.id)).toEqual([active]);
  expect(batch[2]?.map((entry) => entry.id).sort()).toEqual([archived]);
});

test("history reads its purchase window once and batches metadata, fulfillment and current access", async () => {
  const buyer = randomUUID();
  const now = new Date("2030-01-01T00:00:00Z");
  await prisma.account.create({
    data: {
      id: buyer,
      logtoIssuer: "https://identity.example.test",
      logtoSubject: buyer,
    },
  });
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "synthetic-fingerprint-key-000000000000",
  });
  const grants = assembleAccessGrants({
    prisma,
    accounts,
    contentCatalog: catalog,
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  const contact = new BillingContact({
    prisma,
    protection: undefined,
    sendCode: undefined,
    documents: [],
    now: () => now,
  });
  const payments = new BillingPayments({
    prisma,
    grants,
    contact,
    bank: undefined,
    contentCatalog: catalog,
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  const offerId = randomUUID();
  const snapshot = {
    currency: "RUB",
    timezone: "Europe/Moscow",
    firstPriceKopecks: 1000,
    renewalPriceKopecks: 1000,
    promotion: null,
    offer: {
      id: offerId,
      revision: 1,
      name: "Product",
      benefits: [`product:${active}`],
      archived: false,
      coverage: { productIds: [active], materialIds: [] },
    },
    paymentOption: {
      id: randomUUID(),
      offerId,
      revision: 1,
      months: 1,
      mode: "one_time",
      priceKopecks: 1000,
      archived: false,
    },
  };
  const quoteIds = Array.from({ length: 50 }, () => randomUUID());
  await prisma.billingPriceQuote.createMany({
    data: quoteIds.map((id) => ({
      id,
      accountId: buyer,
      operationId: randomUUID(),
      fingerprint: "synthetic",
      snapshot,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    })),
  });
  const purchases = quoteIds.map((quoteRef) => ({
    id: randomUUID(),
    quoteRef,
    accountId: buyer,
    kind: "one_time",
    lifecycleActive: false,
    state: "confirmed",
    environment: "demo",
    terminalRef: "synthetic",
    amountKopecks: 1000n,
    snapshot,
    acceptance: {},
    contact: {},
    fiscalization: "pending",
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  await prisma.billingPurchase.createMany({ data: purchases.slice(0, 1) });
  queries = 0;
  expect(await payments.history(buyer)).toMatchObject({ ok: true });
  const singleQueries = queries;
  await prisma.billingPurchase.createMany({ data: purchases.slice(1, 10) });
  queries = 0;
  expect(await payments.history(buyer)).toMatchObject({ ok: true });
  expect(queries).toBe(singleQueries);
  await prisma.billingPurchase.createMany({ data: purchases.slice(10) });
  queries = 0;
  const result = await payments.history(buyer);
  expect(result).toMatchObject({
    ok: true,
    value: Array.from({ length: 50 }, () => ({
      access: "unavailable",
      content: [{ id: active }],
      productAccess: [{ productId: active, access: "unavailable" }],
    })),
  });
  // Includes the Account Rights snapshot transaction; the budget is independent of payment count.
  expect(queries).toBe(singleQueries);
  expect(queries).toBeLessThanOrEqual(15);
});

test("a community sweep shares its Product mapping read and refreshes it on the next sweep", async () => {
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "synthetic-fingerprint-key-000000000000",
  });
  const grants = assembleAccessGrants({
    prisma,
    accounts,
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  const app = new CommunityEntitlements({
    prisma,
    accounts,
    grants,
    links: new TelegramAccountLinks(prisma),
    provider: disabledCommunityEntitlementProvider,
    botStartUrl: "https://t.me/synthetic_bot",
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  const accountIds = Array.from({ length: 3 }, () => randomUUID());
  await prisma.account.createMany({
    data: accountIds.map((id) => ({
      id,
      logtoIssuer: "https://identity.example.test",
      logtoSubject: id,
    })),
  });
  const retries = () =>
    prisma.telegramCommunityProjectionRetry.createMany({
      data: accountIds.map((accountId) => ({
        accountId,
        attemptId: randomUUID(),
        nextAttemptAt: new Date("2030-01-01T00:00:00Z"),
        updatedAt: new Date("2030-01-01T00:00:00Z"),
      })),
    });
  await retries();
  mappingReads = 0;
  expect(await app.sweep()).toMatchObject({ failed: 0, projected: 3 });
  expect(mappingReads).toBe(1);
  await retries();
  mappingReads = 0;
  expect(await app.sweep()).toMatchObject({ failed: 0 });
  expect(mappingReads).toBe(1);
});

test("the Account access view resolves all grant scopes in one metadata read", async () => {
  const buyer = randomUUID();
  const now = new Date("2030-01-01T00:00:00Z");
  await prisma.account.create({
    data: {
      id: buyer,
      logtoIssuer: "https://identity.example.test",
      logtoSubject: buyer,
    },
  });
  await prisma.accessGrant.createMany({
    data: Array.from({ length: 10 }, () => ({
      id: randomUUID(),
      accountId: buyer,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities: [`product:${active}`],
      coverage: { productIds: [active], materialIds: [] },
      startsAt: now,
      revision: 1,
      reason: "Synthetic grant",
    })),
  });
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "synthetic-fingerprint-key-000000000000",
  });
  const grants = assembleAccessGrants({
    prisma,
    accounts,
    contentCatalog: catalog,
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  queries = 0;
  expect(await grants.readOwnAccess(buyer)).toMatchObject({
    ok: true,
    value: {
      grounds: Array.from({ length: 10 }, () => ({
        content: [{ id: active }],
      })),
    },
  });
  expect(queries).toBe(3);
});

test("catalog overflow refuses the composition instead of returning a partial scope", async () => {
  const products = Array.from({ length: 1999 }, (_, index) => ({
    id: randomUUID(),
    name: `Overflow ${index}`,
    slug: `overflow-${index}`,
  }));
  await prisma.product.createMany({ data: products });
  try {
    await expect(
      catalog.resolveMany([
        { productIds: [], materialIds: [], wholePlatform: true },
        { productIds: [missing], materialIds: [] },
      ]),
    ).rejects.toThrow("exceeds supported size");
    const extra = {
      id: randomUUID(),
      name: "Overflow extra",
      slug: "overflow-extra",
    };
    products.push(extra);
    await prisma.product.create({ data: extra });
    await expect(
      catalog.resolveMany([
        { productIds: [], materialIds: [], wholePlatform: true },
      ]),
    ).rejects.toThrow("exceeds supported size");
  } finally {
    await prisma.product.deleteMany({
      where: { id: { in: products.map((product) => product.id) } },
    });
  }
  queries = 0;
  await expect(
    catalog.resolveMany(
      Array.from({ length: 1001 }, () => ({
        productIds: [active],
        materialIds: [],
      })),
    ),
  ).rejects.toThrow("exceeds supported size");
  expect(queries).toBe(0);
});

test("a mixed Product resource cannot recover a revoked legacy bridge through another Product", async () => {
  const buyer = randomUUID();
  const now = new Date("2030-01-01T00:00:00Z");
  await prisma.account.create({
    data: {
      id: buyer,
      logtoIssuer: "https://identity.example.test",
      logtoSubject: buyer,
    },
  });
  await prisma.legacyClassification.create({
    data: {
      accountId: buyer,
      classification: "confirmed_legacy",
      sourceRef: "synthetic",
      reason: "Synthetic bridge",
      verifiedAt: now,
      revision: 1,
      bridgeEnabled: true,
      bridgeCoverage: { productIds: [active], materialIds: [] },
      bridgeBenefits: ["materials", "community"],
    },
  });
  await prisma.membershipBinding.create({
    data: { accountId: buyer, principalRef: buyer, linkedAt: now },
  });
  await prisma.membershipProjection.create({
    data: {
      accountId: buyer,
      principalRef: buyer,
      decision: "member",
      evidenceRef: "synthetic",
      evidenceVersion: 1n,
      evidenceFingerprint: "a".repeat(64),
      checkedAt: now,
      updatedAt: now,
      validUntil: new Date("2030-02-01T00:00:00Z"),
    },
  });
  await prisma.productAccessExclusion.create({
    data: {
      accountId: buyer,
      productId: active,
      actorId: buyer,
      bridge: true,
      grantIds: [],
      reason: "Synthetic revoke",
      revokedAt: now,
    },
  });
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "synthetic-fingerprint-key-000000000000",
  });
  const grants = assembleAccessGrants({ prisma, accounts, clock: () => now });
  expect(
    await grants.resolveCapabilities(buyer, { productIds: [active, archived] }),
  ).toMatchObject({ ok: true, capabilities: [] });
  expect(
    await grants.resolveCapabilitiesMany(buyer, [
      { productIds: [active] },
      { productIds: [archived] },
    ]),
  ).toMatchObject({
    ok: true,
    values: [{ capabilities: [] }, { capabilities: [] }],
  });
});
