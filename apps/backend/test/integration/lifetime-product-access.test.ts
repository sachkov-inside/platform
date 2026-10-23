import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
let grants: ReturnType<typeof assembleAccessGrants>;
let rights: ReturnType<typeof assembleAccountRights>;
const owner = randomUUID(),
  buyer = randomUUID(),
  other = randomUUID(),
  product = randomUUID(),
  second = randomUUID();
let now = new Date("2030-01-31T10:00:00.000Z");
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  for (const id of [owner, buyer, other])
    await db.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
    });
  await db.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  for (const id of [product, second])
    await db.prisma.product.create({
      data: { id, name: "Lifetime product", slug: id },
    });
  grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-product-access-fingerprint-key",
    }),
    clock: () => now,
  });
  rights = assembleAccountRights({ prisma: db.prisma, clock: () => now });
});
afterAll(async () => {
  await db.dispose();
});
test("one lifetime Product Access survives repeated and concurrent sources and the support anniversary", async () => {
  const command = {
    accountId: buyer,
    productId: product,
    sourceRef: randomUUID(),
    issuedAt: now.toISOString(),
    reason: "payment_confirmed",
  };
  const results = await Promise.all([
    grants.issueProductAccess({ source: "purchase" }, command),
    grants.issueProductAccess({ source: "purchase" }, command),
  ]);
  expect(results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ok: true, outcome: "issued" }),
      expect.objectContaining({ ok: true, outcome: "already_active" }),
    ]),
  );
  now = new Date("2031-08-01T10:00:00.000Z");
  expect(
    await grants.issueProductAccess(
      { source: "course_activation" },
      { ...command, sourceRef: randomUUID(), issuedAt: now.toISOString() },
    ),
  ).toMatchObject({
    ok: true,
    outcome: "already_active",
    value: { firstIssuedAt: "2030-01-31T10:00:00.000Z", access: "active" },
  });
  expect(await rights.resolveForAccess(accountId(buyer), [product])).toEqual({
    kind: "active",
    validUntil: null,
  });
  expect(await rights.resolveForAccess(accountId(buyer), [second])).toEqual({
    kind: "required",
  });
  expect(await rights.resolveForAccess(accountId(other), [product])).toEqual({
    kind: "required",
  });
});
test("revocation latches across automatic sources until an explicit authorized restore, without touching other Products", async () => {
  const issuedAt = now.toISOString();
  const first = await grants.issueProductAccess(
    { source: "manual", actorId: owner },
    {
      accountId: other,
      productId: product,
      sourceRef: randomUUID(),
      issuedAt,
      reason: "Free issuance",
    },
  );
  if (!first.ok) throw new Error(first.error.code);
  await grants.issueProductAccess(
    { source: "manual", actorId: owner },
    {
      accountId: other,
      productId: second,
      sourceRef: randomUUID(),
      issuedAt,
      reason: "Second product",
    },
  );
  const revoke = {
    accountId: other,
    productId: product,
    operationId: randomUUID(),
    expectedRevision: first.value.revision,
    reason: "Owner withdrawal",
  };
  expect(await grants.revokeProductAccess(owner, revoke)).toMatchObject({
    ok: true,
    value: { access: "revoked" },
  });
  expect(await rights.resolveForAccess(accountId(other), [product])).toEqual({
    kind: "required",
  });
  expect(await rights.resolveForAccess(accountId(other), [second])).toEqual({
    kind: "active",
    validUntil: null,
  });
  const attempted = await grants.issueProductAccess(
    { source: "course_activation" },
    {
      accountId: other,
      productId: product,
      sourceRef: randomUUID(),
      issuedAt,
      reason: "Repeated course",
    },
  );
  expect(attempted).toMatchObject({
    ok: true,
    outcome: "revoked",
    value: { firstIssuedAt: issuedAt, access: "revoked" },
  });
  if (!attempted.ok) throw new Error(attempted.error.code);
  const restore = {
    accountId: other,
    productId: product,
    operationId: randomUUID(),
    expectedRevision: attempted.value.revision,
    reason: "Explicit restore",
  };
  expect(await grants.restoreProductAccess(buyer, restore)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(await grants.restoreProductAccess(owner, restore)).toMatchObject({
    ok: true,
    value: { access: "active", firstIssuedAt: issuedAt },
  });
  expect(await grants.restoreProductAccess(owner, restore)).toMatchObject({
    ok: true,
    value: { access: "active", firstIssuedAt: issuedAt },
  });
  expect(await rights.resolveForAccess(accountId(other), [product])).toEqual({
    kind: "active",
    validUntil: null,
  });
});
