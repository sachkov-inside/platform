import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { SubscriptionActivation } from "../../src/modules/billing/index.js";
import {
  CommunityEntitlements,
  TelegramAccountLinks,
} from "../../src/modules/telegram-membership/index.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import { ownSubscriptionAccessResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let db: TestDatabase;
let grants: AccessGrants;
const now = new Date("2030-01-15T00:00:00.000Z");
beforeEach(async () => {
  db = await createMigratedTestDatabase();
  grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "own-product-fixture-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(db.prisma),
    clock: () => now,
  });
});
afterEach(async () => db.dispose());

test("an oversized Product exclusion set fails explicitly instead of reading an unbounded view", async () => {
  const accountId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.productAccessExclusion.createMany({
    data: Array.from({ length: 1001 }, () => ({
      accountId,
      productId: randomUUID(),
      grantIds: [],
      bridge: true,
      actorId: accountId,
      reason: "Exclusion boundary fixture",
      revokedAt: now,
    })),
  });
  expect(await grants.readOwnProducts(accountId)).toMatchObject({
    ok: false,
    error: { code: "unavailable" },
  });
});

test("a past whole-platform right retains archived Products from its actual period only", async () => {
  const accountId = randomUUID();
  const retained = randomUUID();
  const later = randomUUID();
  const earlier = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.createMany({
    data: [
      {
        id: retained,
        slug: `retained-${retained}`,
        name: "Retained course",
        createdAt: new Date("2029-12-01T00:00:00.000Z"),
        archivedAt: new Date("2030-01-12T00:00:00.000Z"),
      },
      {
        id: later,
        slug: `later-${later}`,
        name: "Later course",
        createdAt: new Date("2030-01-13T00:00:00.000Z"),
      },
      {
        id: earlier,
        slug: `earlier-${earlier}`,
        name: "Earlier course",
        createdAt: new Date("2029-12-01T00:00:00.000Z"),
        archivedAt: new Date("2029-12-20T00:00:00.000Z"),
      },
    ],
  });
  await db.prisma.accessGrant.create({
    data: {
      id: randomUUID(),
      accountId,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities: ["materials", "community"],
      coverage: { productIds: [], materialIds: [], wholePlatform: true },
      startsAt: new Date("2030-01-01T00:00:00.000Z"),
      validUntil: new Date("2030-01-10T00:00:00.000Z"),
      revision: 1,
      reason: "Past subscription fixture",
    },
  });
  const result = await grants.readOwnProducts(accountId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected Product history");
  expect(result.value.some((product) => product.id === retained)).toBe(true);
  expect(
    result.value.some(
      (product) => product.id === later || product.id === earlier,
    ),
  ).toBe(false);
});

test("confirmed legacy source departure reports ended rights", async () => {
  const accountId = randomUUID();
  const productId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: { id: productId, slug: `ended-${productId}`, name: "Ended course" },
  });
  await db.prisma.legacyClassification.create({
    data: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: randomUUID(),
      reason: "Legacy course fixture",
      verifiedAt: now,
      revision: 1,
      bridgeEnabled: true,
      bridgeBenefits: ["materials", "community"],
      bridgeCoverage: { productIds: [productId], materialIds: [] },
    },
  });
  const principalRef = randomUUID();
  await db.prisma.membershipBinding.create({
    data: { accountId, principalRef, linkedAt: now },
  });
  await db.prisma.membershipProjection.create({
    data: {
      accountId,
      principalRef,
      decision: "not_member",
      evidenceRef: randomUUID(),
      evidenceVersion: 1n,
      evidenceFingerprint: "a".repeat(64),
      checkedAt: now,
      validUntil: new Date("2030-01-16T00:00:00.000Z"),
      updatedAt: now,
    },
  });
  expect(await grants.readOwnProducts(accountId)).toMatchObject({
    ok: true,
    value: [
      {
        id: productId,
        materials: { state: "expired" },
        community: { state: "expired" },
      },
    ],
  });
});

test("an excluded legacy Product reports the confirmed revocation without inventing provider expiry", async () => {
  const accountId = randomUUID();
  const productId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: { id: productId, slug: `legacy-${productId}`, name: "Legacy course" },
  });
  await db.prisma.legacyClassification.create({
    data: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: randomUUID(),
      reason: "Legacy course fixture",
      verifiedAt: now,
      revision: 1,
      bridgeEnabled: true,
      bridgeBenefits: ["materials", "community"],
      bridgeCoverage: { productIds: [productId], materialIds: [] },
    },
  });
  await db.prisma.productAccessExclusion.create({
    data: {
      accountId,
      productId,
      grantIds: [],
      bridge: true,
      actorId: accountId,
      reason: "Legacy course withdrawn",
      revokedAt: now,
    },
  });
  expect(await grants.readOwnProducts(accountId)).toMatchObject({
    ok: true,
    value: [
      {
        id: productId,
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  });
});

test("own Products retain expired and revoked rights and separate materials from community", async () => {
  const accountId = randomUUID();
  const otherAccountId = randomUUID();
  await db.prisma.account.createMany({
    data: [accountId, otherAccountId].map((id) => ({
      id,
      logtoIssuer: "https://own-products.test",
      logtoSubject: id,
    })),
  });
  const [active, expired, revoked, foreign] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  if (
    active === undefined ||
    expired === undefined ||
    revoked === undefined ||
    foreign === undefined
  )
    throw new Error("Missing Product fixture");
  await db.prisma.product.createMany({
    data: [active, expired, revoked, foreign].map((id, index) => ({
      id,
      slug: `own-product-${id}`,
      name:
        ["Active course", "Expired course", "Revoked course", "Foreign course"][
          index
        ] ?? "Course",
    })),
  });
  await db.prisma.accessGrant.createMany({
    data: [
      {
        product: active,
        capabilities: ["materials"],
        until: null,
        revokedAt: null,
        accountId,
      },
      {
        product: active,
        capabilities: ["community"],
        until: new Date("2030-01-10T00:00:00.000Z"),
        revokedAt: null,
        accountId,
      },
      {
        product: expired,
        capabilities: ["materials", "community"],
        until: new Date("2030-01-10T00:00:00.000Z"),
        revokedAt: null,
        accountId,
      },
      {
        product: revoked,
        capabilities: ["materials", "community"],
        until: null,
        revokedAt: new Date("2030-01-12T00:00:00.000Z"),
        accountId,
      },
      {
        product: foreign,
        capabilities: ["materials", "community"],
        until: null,
        revokedAt: null,
        accountId: otherAccountId,
      },
    ].map((entry) => ({
      id: randomUUID(),
      accountId: entry.accountId,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities: entry.capabilities,
      coverage: { productIds: [entry.product], materialIds: [] },
      startsAt: new Date("2030-01-01T00:00:00.000Z"),
      validUntil: entry.until,
      revokedAt: entry.revokedAt,
      revision: 1,
      reason: "Own Product fixture",
    })),
  });
  const result = await grants.readOwnProducts(accountId);
  expect(result).toEqual({
    ok: true,
    value: [
      {
        id: active,
        slug: `own-product-${active}`,
        name: "Active course",
        materials: { state: "available" },
        community: { state: "expired" },
      },
      {
        id: expired,
        slug: `own-product-${expired}`,
        name: "Expired course",
        materials: { state: "expired" },
        community: { state: "expired" },
      },
      {
        id: revoked,
        slug: `own-product-${revoked}`,
        name: "Revoked course",
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  });
});

test("a Product exclusion retains its name while showing the revoked scoped right", async () => {
  const accountId = randomUUID();
  const productId = randomUUID();
  const grantId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: {
      id: productId,
      slug: `excluded-${productId}`,
      name: "Excluded course",
    },
  });
  await db.prisma.accessGrant.create({
    data: {
      id: grantId,
      accountId,
      source: "manual",
      sourceRef: grantId,
      capabilities: ["materials", "community"],
      coverage: { productIds: [productId], materialIds: [] },
      startsAt: new Date("2030-01-01T00:00:00.000Z"),
      revision: 1,
      reason: "Own Product fixture",
    },
  });
  await db.prisma.productAccessExclusion.create({
    data: {
      accountId,
      productId,
      grantIds: [grantId],
      bridge: false,
      actorId: accountId,
      reason: "Course withdrawn",
      revokedAt: now,
    },
  });
  expect(await grants.readOwnProducts(accountId)).toMatchObject({
    ok: true,
    value: [
      {
        id: productId,
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  });
});

test("a stale own-access callback cannot start synchronous community preparation", async () => {
  const accountId = randomUUID();
  const identityRef = `telegram:${randomUUID()}`;
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  const accountRef = await linkTelegramAccount(db.prisma, {
    accountId,
    identityRef,
    now,
  });
  const links = new TelegramAccountLinks(db.prisma);
  const binding = await links.readBinding({ accountId });
  if (!binding.ok || binding.binding === null)
    throw new Error("Missing binding");
  const preparations: boolean[] = [];
  const activation = new SubscriptionActivation({
    prisma: db.prisma,
    grants,
    bindings: links,
    readAdmission: (_accountId, prepare) => {
      if (prepare === true) preparations.push(prepare);
      return Promise.resolve({ state: "checking", admissionRestriction: null });
    },
  });
  expect(
    await activation.readOwn({
      contractVersion: "inside.subscription-activation.v1",
      accountRef,
      identityRef,
      linkRef: binding.binding.linkRef,
      linkRevision: binding.binding.linkRevision + 1,
      prepareCommunity: true,
    }),
  ).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
  expect(preparations).toEqual([]);
});

test("own-access explicitly requests Product navigation and preserves the previous response by default", async () => {
  const accountId = randomUUID();
  const productId = randomUUID();
  const identityRef = `telegram:${randomUUID()}`;
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: {
      id: productId,
      slug: `engineering-${productId}`,
      name: "Engineering",
    },
  });
  await db.prisma.accessGrant.create({
    data: {
      id: randomUUID(),
      accountId,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities: [`product:${productId}`],
      startsAt: now,
      revision: 1,
      reason: "Direct Product access",
    },
  });
  const accountRef = await linkTelegramAccount(db.prisma, {
    accountId,
    identityRef,
    now,
  });
  const links = new TelegramAccountLinks(db.prisma);
  const binding = await links.readBinding({ accountId });
  if (!binding.ok || binding.binding === null)
    throw new Error("Missing binding");
  const activation = new SubscriptionActivation({
    prisma: db.prisma,
    grants,
    bindings: links,
    siteOrigin: "https://sachkov.dev",
    readAdmission: () =>
      Promise.resolve({ state: "checking", admissionRestriction: null }),
  });
  const query = {
    contractVersion: "inside.subscription-activation.v1",
    accountRef,
    identityRef,
    linkRef: binding.binding.linkRef,
    linkRevision: binding.binding.linkRevision,
  };
  const previous = ownSubscriptionAccessResponseSchema.parse(
    await activation.readOwn(query),
  );
  expect(previous.ok).toBe(true);
  if (!previous.ok) throw new Error("Expected own-access response");
  expect("products" in previous.value).toBe(false);
  const result = ownSubscriptionAccessResponseSchema.parse(
    await activation.readOwn({ ...query, includeProducts: true }),
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      products: [
        {
          id: productId,
          name: "Engineering",
          programmeUrl: `https://sachkov.dev/products/engineering-${productId}/programme`,
          materials: { state: "available" },
          community: { state: "unavailable" },
        },
      ],
    },
  });
});

test("only configured Products expose community access and several Products share the same actual group", async () => {
  const accountId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://own-products.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.createMany({
    data: ids.map((id) => ({
      id,
      slug: `mapping-${id}`,
      name: `Product ${id}`,
    })),
  });
  await db.prisma.accessGrant.create({
    data: {
      id: randomUUID(),
      accountId,
      source: "manual",
      sourceRef: randomUUID(),
      capabilities: ["materials", "community"],
      coverage: { productIds: ids, materialIds: [] },
      startsAt: now,
      revision: 1,
      reason: "Product community mapping fixture",
    },
  });
  await db.prisma.productCommunity.createMany({
    data: ids.slice(0, 2).map((productId) => ({
      productId,
      groupRef: "primary",
      updatedBy: accountId,
      updatedAt: now,
    })),
  });
  const identityRef = `mapping:${randomUUID()}`;
  const accountRef = await linkTelegramAccount(db.prisma, {
    accountId,
    identityRef,
    now,
  });
  const links = new TelegramAccountLinks(db.prisma);
  const binding = await links.readBinding({ accountId });
  if (!binding.ok || binding.binding === null)
    throw new Error("Missing binding");
  const community = new CommunityEntitlements({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "own-product-fixture-fingerprint-key",
    }),
    grants,
    links,
    botStartUrl: "https://t.me/inside_test_bot",
    clock: () => now,
    provider: {
      set: () => Promise.resolve({ kind: "unavailable" }),
      status: () => Promise.resolve({ kind: "unavailable" }),
    },
  });
  let rejectOwnerBoundary = false;
  const activation = new SubscriptionActivation({
    prisma: db.prisma,
    grants,
    bindings: links,
    siteOrigin: "https://sachkov.dev",
    readAdmission: () =>
      Promise.resolve({ state: "ready", admissionRestriction: "none" }),
    readConfiguredProductIds: (productIds) =>
      rejectOwnerBoundary
        ? Promise.reject(new Error("Synthetic owner capability rejection"))
        : community.readConfiguredProductIds(productIds),
  });
  const result = ownSubscriptionAccessResponseSchema.parse(
    await activation.readOwn({
      contractVersion: "inside.subscription-activation.v1",
      accountRef,
      identityRef,
      linkRef: binding.binding.linkRef,
      linkRevision: binding.binding.linkRevision,
      includeProducts: true,
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Missing own access");
  for (const id of ids.slice(0, 2))
    expect(
      result.value.products?.find((product) => product.id === id)?.community
        .state,
    ).toBe("available");
  expect(
    result.value.products?.find((product) => product.id === ids[2])?.community
      .state,
  ).toBe("unavailable");
  const configured = await community.readConfiguredProductIds(ids);
  expect(configured.ok).toBe(true);
  if (!configured.ok) throw new Error("Missing configured Product groups");
  expect(configured.value.toSorted()).toEqual(ids.slice(0, 2).toSorted());
  const storageFailure = vi
    .spyOn(db.prisma.productCommunity, "findMany")
    .mockRejectedValueOnce(
      new Error("Synthetic Product community storage outage"),
    );
  try {
    await expect(
      activation.readOwn({
        contractVersion: "inside.subscription-activation.v1",
        accountRef,
        identityRef,
        linkRef: binding.binding.linkRef,
        linkRevision: binding.binding.linkRevision,
        includeProducts: true,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
  } finally {
    storageFailure.mockRestore();
  }
  rejectOwnerBoundary = true;
  await expect(
    activation.readOwn({
      contractVersion: "inside.subscription-activation.v1",
      accountRef,
      identityRef,
      linkRef: binding.binding.linkRef,
      linkRevision: binding.binding.linkRevision,
      includeProducts: true,
    }),
  ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
});
