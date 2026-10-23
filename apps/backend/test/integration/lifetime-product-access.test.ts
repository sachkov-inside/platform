import { concurrentAccessCommands } from "./setup/hold-access-command.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { transactionHandle } from "../../src/infrastructure/prisma/transaction-handle.js";
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
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
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
test("caller rollback leaves neither a right nor a source receipt, and immutable source bindings reject cross-Account replay", async () => {
  const target = randomUUID();
  await db.prisma.account.create({
    data: {
      id: target,
      logtoIssuer: "https://identity.test",
      logtoSubject: target,
    },
  });
  const command = {
    accountId: target,
    productId: product,
    sourceRef: randomUUID(),
    issuedAt: now.toISOString(),
    reason: "Atomic payment fulfillment",
  };
  await expect(
    db.prisma.$transaction(async (tx) => {
      const result = await grants.issueProductAccess(
        { source: "purchase" },
        command,
        transactionHandle(tx),
      );
      expect(result).toMatchObject({ ok: true, outcome: "issued" });
      throw new Error("Outer fulfillment failed");
    }),
  ).rejects.toThrow("Outer fulfillment failed");
  expect(await rights.resolveForAccess(accountId(target), [product])).toEqual({
    kind: "required",
  });
  expect(
    await grants.issueProductAccess({ source: "purchase" }, command),
  ).toMatchObject({ ok: true, outcome: "issued" });
  expect(
    await grants.issueProductAccess(
      { source: "purchase" },
      { ...command, accountId: buyer },
    ),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  expect(
    await grants.issueProductAccess(
      { source: "manual", actorId: buyer },
      { ...command, sourceRef: randomUUID() },
    ),
  ).toMatchObject({ ok: false, error: { code: "forbidden" } });
});
test("owner history keeps both sources while paginating multiple Products of one Account without omissions", async () => {
  const target = randomUUID();
  await db.prisma.account.create({
    data: {
      id: target,
      logtoIssuer: "https://identity.test",
      logtoSubject: target,
    },
  });
  const command = {
    accountId: target,
    productId: product,
    sourceRef: randomUUID(),
    issuedAt: now.toISOString(),
    reason: "Initial payment",
  };
  await grants.issueProductAccess({ source: "purchase" }, command);
  await grants.issueProductAccess(
    { source: "course_activation" },
    { ...command, sourceRef: randomUUID(), reason: "Verified course" },
  );
  await grants.issueProductAccess(
    { source: "manual", actorId: owner },
    {
      ...command,
      productId: second,
      sourceRef: randomUUID(),
      reason: "Other Product",
    },
  );
  expect(
    await grants.readProductAccess(buyer, {
      accountId: target,
      productId: product,
    }),
  ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  const record = await grants.readProductAccess(owner, {
    accountId: target,
    productId: product,
  });
  if (!record.ok) throw new Error(record.error.code);
  expect(record.value.sources.map((source) => source.source).sort()).toEqual([
    "course_activation",
    "purchase",
  ]);
  expect(record.value.actions.map((action) => action.kind).sort()).toEqual([
    "issue",
    "source_recorded",
  ]);
  const first = await grants.listProductAccess(owner, {
    accountId: target,
    limit: 1,
  });
  if (!first.ok) throw new Error(first.error.code);
  expect(first.value).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const next = await grants.listProductAccess(owner, {
    accountId: target,
    limit: 1,
    cursor: first.nextCursor,
  });
  if (!next.ok) throw new Error(next.error.code);
  expect(next.value).toHaveLength(1);
  expect(
    new Set([...first.value, ...next.value].map((row) => row.productId)),
  ).toEqual(new Set([product, second]));
  expect(next.nextCursor).toBeNull();
  expect(
    await grants.listProductAccess(owner, { cursor: "malformed:cursor" }),
  ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
});
test("manual issuance uses actual free issuance time and requires a real Product on the caller transaction", async () => {
  const target = randomUUID();
  await db.prisma.account.create({
    data: {
      id: target,
      logtoIssuer: "https://identity.test",
      logtoSubject: target,
    },
  });
  const command = {
    accountId: target,
    productId: product,
    sourceRef: randomUUID(),
    issuedAt: "2000-01-01T00:00:00.000Z",
    reason: "Actual free issuance",
  };
  expect(
    await grants.issueProductAccess(
      { source: "manual", actorId: owner },
      command,
    ),
  ).toMatchObject({ ok: true, value: { firstIssuedAt: now.toISOString() } });
  expect(
    await grants.issueProductAccess(
      { source: "manual", actorId: owner },
      { ...command, productId: randomUUID(), sourceRef: randomUUID() },
    ),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});
test("manual Product validation reads an uncommitted owning Product on the exact transaction and rolls back together", async () => {
  const productId = randomUUID(),
    sourceRef = randomUUID();
  await expect(
    db.prisma.$transaction(async (tx) => {
      await tx.product.create({
        data: { id: productId, name: "Uncommitted Product", slug: productId },
      });
      expect(
        await grants.issueManualProductAccess(
          owner,
          {
            accountId: buyer,
            productId,
            sourceRef,
            reason: "Transactional issuance",
          },
          transactionHandle(tx),
        ),
      ).toMatchObject({ ok: true, outcome: "issued" });
      throw new Error("Roll back Product and issuance");
    }),
  ).rejects.toThrow("Roll back Product and issuance");
  expect(await rights.resolveForAccess(accountId(buyer), [productId])).toEqual({
    kind: "required",
  });
  expect(
    await grants.issueManualProductAccess(owner, {
      accountId: buyer,
      productId,
      sourceRef,
      reason: "Transactional issuance",
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(
    await grants.issueManualProductAccess(owner, {
      accountId: buyer,
      productId: product,
      sourceRef,
      reason: "No backdate",
      issuedAt: "2000-01-01T00:00:00.000Z",
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
});

test("concurrent identical owner commands replay one receipt while changed payload and stale revisions remain conflicts", async () => {
  const target = randomUUID();
  await db.prisma.account.create({
    data: {
      id: target,
      logtoIssuer: "https://identity.test",
      logtoSubject: target,
    },
  });
  const issued = await grants.issueManualProductAccess(owner, {
    accountId: target,
    productId: product,
    sourceRef: randomUUID(),
    reason: "Concurrent command fixture",
  });
  if (!issued.ok) throw new Error(issued.error.code);
  for (const [action, revision] of [
    ["revoke", issued.value.revision],
    ["restore", issued.value.revision + 1],
  ] as const) {
    const command = {
      accountId: target,
      productId: product,
      operationId: randomUUID(),
      expectedRevision: revision,
      reason: "Concurrent owner command",
    };
    const invoke =
      action === "revoke"
        ? grants.revokeProductAccess
        : grants.restoreProductAccess;
    const results = await concurrentAccessCommands(
      db,
      { accountId: target },
      () => invoke(owner, command),
    );
    expect(results[0]).toMatchObject({
      ok: true,
      value: { revision: revision + 1 },
    });
    for (const result of results) expect(result).toEqual(results[0]);
    expect(
      await invoke(owner, { ...command, reason: "Changed payload" }),
    ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
    expect(
      await invoke(owner, { ...command, operationId: randomUUID() }),
    ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
  }
  const detail = await grants.readProductAccess(owner, {
    accountId: target,
    productId: product,
  });
  if (!detail.ok) throw new Error(detail.error.code);
  expect(detail.value.actions.map((action) => action.kind).sort()).toEqual([
    "issue",
    "restore",
    "revoke",
  ]);
  expect(detail.value.sources).toHaveLength(1);
  await grants.issueManualProductAccess(owner, {
    accountId: target,
    productId: second,
    sourceRef: randomUUID(),
    reason: "Cross-target receipt fixture",
  });
  const operationId = randomUUID();
  const outcomes = await Promise.all([
    grants.revokeProductAccess(owner, {
      accountId: target,
      productId: product,
      operationId,
      expectedRevision: 3,
      reason: "One operation identity",
    }),
    grants.revokeProductAccess(owner, {
      accountId: target,
      productId: second,
      operationId,
      expectedRevision: 1,
      reason: "One operation identity",
    }),
  ]);
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
  expect(outcomes.find((result) => !result.ok)).toMatchObject({
    ok: false,
    error: { code: "operation_conflict" },
  });
});
test("Product-scoped capabilities see an uncommitted issuance only through the caller handle and roll back with it", async () => {
  const target = randomUUID();
  await db.prisma.account.create({
    data: {
      id: target,
      logtoIssuer: "https://identity.test",
      logtoSubject: target,
    },
  });
  await expect(
    db.prisma.$transaction(async (tx) => {
      const handle = transactionHandle(tx);
      expect(
        await grants.issueManualProductAccess(
          owner,
          {
            accountId: target,
            productId: product,
            sourceRef: randomUUID(),
            reason: "Atomic holder check",
          },
          handle,
        ),
      ).toMatchObject({ ok: true });
      const matching = await grants.resolveCapabilities(
        target,
        { productIds: [product] },
        handle,
      );
      if (!matching.ok) throw new Error(matching.error.code);
      expect(matching.capabilities).toContainEqual({
        capability: `product:${product}`,
        validUntil: null,
      });
      expect(
        await grants.resolveCapabilities(
          target,
          { productIds: [second] },
          handle,
        ),
      ).toMatchObject({
        ok: true,
        capabilities: [{ capability: `product:${product}`, validUntil: null }],
      });
      throw new Error("Rollback holder check");
    }),
  ).rejects.toThrow("Rollback holder check");
  expect(
    await grants.resolveCapabilities(target, { productIds: [product] }),
  ).toMatchObject({ ok: true, capabilities: [] });
});
