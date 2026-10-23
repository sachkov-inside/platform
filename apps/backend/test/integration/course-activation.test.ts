import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import { CourseActivation } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import type { BillingPrismaClient } from "../../src/infrastructure/prisma/index.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
let grants: ReturnType<typeof assembleAccessGrants>;
let rights: ReturnType<typeof assembleAccountRights>;
let activation: CourseActivation;
let owner: string;
let now = new Date("2030-01-31T10:00:00.000Z");
const version = "inside.subscription-activation.v1" as const;
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  owner = (
    await bootstrapOwnerAccount(
      db.prisma,
      { issuer: "https://course.test", subject: "owner" },
      "platform:admin",
    )
  ).accountId;
  const catalog = new CoverageCatalog(
    db.prisma,
    new ProductDiscovery(db.prisma),
  );
  grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-course-fingerprint-secret",
    }),
    contentCatalog: catalog,
    recipientLinks: new TelegramAccountLinks(db.prisma),
    clock: () => now,
  });
  rights = assembleAccountRights({ prisma: db.prisma, clock: () => now });
  activation = service(db.prisma);
});
afterAll(async () => db.dispose());
function service(prisma: BillingPrismaClient) {
  return new CourseActivation({
    prisma,
    grants,
    bindings: new TelegramAccountLinks(db.prisma),
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
    readAdmission: () =>
      Promise.resolve({ state: "checking", admissionRestriction: null }),
  });
}
async function setup() {
  now = new Date("2030-01-31T10:00:00.000Z");
  const account = randomUUID(),
    product = randomUUID(),
    identityRef = `telegram:${randomUUID()}`;
  await db.prisma.account.create({
    data: {
      id: account,
      logtoIssuer: "https://course.test",
      logtoSubject: account,
    },
  });
  await db.prisma.product.create({
    data: { id: product, name: "Course", slug: product },
  });
  const rule = {
    id: randomUUID(),
    code: randomUUID(),
    name: "Course source",
    productId: product,
    sourceRef: `course:${randomUUID()}`,
    published: true,
    startsAt: now.toISOString(),
    endsAt: null,
  };
  expect(
    await grants.manageActivationRule(owner, {
      operationId: randomUUID(),
      value: rule,
      reason: "Verified separate Activation Source",
    }),
  ).toMatchObject({ ok: true });
  const attemptId = randomUUID();
  expect(
    await activation.begin({
      contractVersion: version,
      attemptId,
      identityRef,
      code: rule.code,
    }),
  ).toMatchObject({
    ok: true,
    value: { state: "needs_account", enrollment: null },
  });
  await linkTelegramAccount(db.prisma, {
    accountId: account,
    identityRef,
    now,
  });
  const found = await activation.lookupBinding({
    contractVersion: version,
    identityRef,
  });
  if (!found.ok || found.value.state !== "linked")
    throw new Error("Missing binding");
  const evidence = {
    contractVersion: version,
    audience: "inside.platform.subscription-activation" as const,
    evidenceRef: randomUUID(),
    attemptId,
    sourceRef: rule.sourceRef,
    ...found.value.binding,
    ruleId: rule.id,
    ruleRevision: 1,
    checkedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 240_000).toISOString(),
    decision: "member" as const,
  };
  return { account, product, identityRef, rule, evidence };
}
test("verified separate course source grants one lifetime Product Access at actual issuance, repeat and different source never reset it", async () => {
  const f = await setup();
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "required" });
  now = new Date("2030-02-01T10:00:00.000Z");
  const proof = {
    ...f.evidence,
    checkedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 240_000).toISOString(),
  };
  const [first, replay] = await Promise.all([
    activation.accept(proof),
    activation.accept(proof),
  ]);
  expect(first).toEqual(replay);
  expect(first).toMatchObject({
    ok: true,
    value: { state: "active", enrollment: null },
  });
  now = new Date("2031-07-01T10:00:00.000Z");
  const renewedAttempt = randomUUID();
  await activation.begin({
    contractVersion: version,
    attemptId: renewedAttempt,
    identityRef: f.identityRef,
    code: f.rule.code,
  });
  expect(
    await activation.accept({
      ...proof,
      attemptId: renewedAttempt,
      evidenceRef: randomUUID(),
      checkedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 240_000).toISOString(),
    }),
  ).toMatchObject({ ok: true, value: { state: "already_active" } });
  const another = {
    ...f.rule,
    id: randomUUID(),
    code: randomUUID(),
    sourceRef: `course:${randomUUID()}`,
  };
  await grants.manageActivationRule(owner, {
    operationId: randomUUID(),
    value: another,
    reason: "Another verified source same Product",
  });
  const attemptId = randomUUID();
  await activation.begin({
    contractVersion: version,
    attemptId,
    code: another.code,
    identityRef: f.identityRef,
  });
  expect(
    await activation.accept({
      ...proof,
      evidenceRef: randomUUID(),
      attemptId,
      ruleId: another.id,
      sourceRef: another.sourceRef,
      checkedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 240_000).toISOString(),
    }),
  ).toMatchObject({ ok: true, value: { state: "already_active" } });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "active", validUntil: null });
  expect(
    await grants.issueProductAccess(
      { source: "manual", actorId: owner },
      {
        accountId: f.account,
        productId: f.product,
        sourceRef: randomUUID(),
        issuedAt: now.toISOString(),
        reason: "Another source does not reset first issuance",
      },
    ),
  ).toMatchObject({
    ok: true,
    value: { productId: f.product, firstIssuedAt: "2030-02-01T10:00:00.000Z" },
  });
});
test("manual revocation latches across new course proof and only explicit owner restoration returns access", async () => {
  const f = await setup();
  expect(await activation.accept(f.evidence)).toMatchObject({
    ok: true,
    value: { state: "active" },
  });
  expect(
    await grants.revokeProductAccess(owner, {
      accountId: f.account,
      productId: f.product,
      operationId: randomUUID(),
      expectedRevision: 1,
      reason: "Owner withdrawal",
    }),
  ).toMatchObject({ ok: true });
  expect(
    await activation.accept({ ...f.evidence, evidenceRef: randomUUID() }),
  ).toMatchObject({
    ok: true,
    value: { state: "pending_review", enrollment: null },
  });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "required" });
  expect(
    await grants.restoreProductAccess(owner, {
      accountId: f.account,
      productId: f.product,
      operationId: randomUUID(),
      expectedRevision: 2,
      reason: "Explicit owner restoration",
    }),
  ).toMatchObject({ ok: true });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "active", validUntil: null });
});
test("code possession, negative proof, wrong source, stale binding and wrong Account cannot activate", async () => {
  const f = await setup();
  for (const patch of [
    { sourceRef: "wrong-source" },
    { audience: "wrong" },
    { linkRevision: f.evidence.linkRevision + 1 },
    { accountRef: "wrong-account" },
    { validUntil: now.toISOString() },
  ])
    expect(
      await activation.accept({
        ...f.evidence,
        ...patch,
        evidenceRef: randomUUID(),
      }),
    ).toMatchObject({ ok: false });
  expect(
    await activation.accept({
      ...f.evidence,
      decision: "not_member",
      evidenceRef: randomUUID(),
    }),
  ).toMatchObject({ ok: true, value: { state: "rejected" } });
  expect(
    await activation.accept({
      ...f.evidence,
      decision: "unavailable",
      evidenceRef: randomUUID(),
    }),
  ).toMatchObject({ ok: true, value: { state: "unavailable" } });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "required" });
  expect(
    await grants.readActivationContinuation(
      f.evidence.attemptId,
      randomUUID(),
      f.identityRef,
    ),
  ).toEqual({ state: "identity_conflict" });
});
test("lost accepted response replays after expiry, paused rule and unlink without creating another operation", async () => {
  const f = await setup();
  const accepted = await activation.accept(f.evidence);
  await db.prisma.telegramLinkTransaction.updateMany({
    where: { accountId: f.account },
    data: { status: "expired" },
  });
  now = new Date("2030-03-01T10:00:00.000Z");
  await grants.manageActivationRule(owner, {
    operationId: randomUUID(),
    expectedRevision: 1,
    value: { ...f.rule, published: false },
    reason: "Pause rule",
  });
  expect(await activation.accept(f.evidence)).toEqual(accepted);
  expect(
    await activation.accept({ ...f.evidence, decision: "not_member" }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  expect(
    await activation.readContinuation(f.account, f.evidence.attemptId),
  ).toEqual({
    state: "link_required",
    product: { id: f.product, slug: f.product, name: "Course" },
  });
});
test("activation, source, attempt and receipt roll back with Billing's shared transaction and retry grants once", async () => {
  const f = await setup();
  const rollback: BillingPrismaClient = {
    ...db.prisma,
    $transaction: (operation) =>
      db.prisma.$transaction(async (tx) => {
        expect(await operation(tx)).toMatchObject({
          ok: true,
          value: { state: "active" },
        });
        throw new Error("Injected transaction rollback");
      }),
  };
  expect(await service(rollback).accept(f.evidence)).toMatchObject({
    ok: false,
    error: { code: "unavailable" },
  });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "required" });
  expect(await grants.readActivationReceipt(f.evidence)).toBeNull();
  expect(await activation.accept(f.evidence)).toMatchObject({
    ok: true,
    value: { state: "active" },
  });
  expect(await activation.accept(f.evidence)).toMatchObject({
    ok: true,
    value: { state: "active" },
  });
});

test("a pre-Product rollout receipt with a legacy Enrollment snapshot and v1 fingerprint replays passively without issuing access", async () => {
  const f = await setup();
  const input = {
    contractVersion: f.evidence.contractVersion,
    audience: f.evidence.audience,
    evidenceRef: f.evidence.evidenceRef,
    attemptId: f.evidence.attemptId,
    sourceRef: f.evidence.sourceRef,
    identityRef: f.evidence.identityRef,
    accountRef: f.evidence.accountRef,
    linkRef: f.evidence.linkRef,
    linkRevision: f.evidence.linkRevision,
    ruleId: f.evidence.ruleId,
    ruleRevision: f.evidence.ruleRevision,
    checkedAt: f.evidence.checkedAt,
    validUntil: f.evidence.validUntil,
    decision: f.evidence.decision,
  };
  const legacy = {
    contractVersion: version,
    attemptId: input.attemptId,
    state: "active",
    enrollment: {
      id: randomUUID(),
      accountId: f.account,
      tier: {
        id: randomUUID(),
        revision: 1,
        name: "Historical course",
        benefits: [`product:${f.product}`],
        coverage: { productIds: [f.product], materialIds: [] },
      },
      origin: "course",
      startsAt: "2029-08-01T10:00:00.000Z",
      endsAt: null,
      endPolicy: "fixed",
      revision: 1,
      state: "active",
      renewal: "not_applicable",
      nextChargeAt: null,
    },
  };
  // Version 1 persisted the schema-ordered bare JSON digest. This is an independent historical fixture.
  await db.prisma.accessReceipt.create({
    data: {
      scope: "source-evidence",
      operationId: input.evidenceRef,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      payload: input,
      result: legacy,
      createdAt: now,
    },
  });
  now = new Date("2030-02-20T10:00:00.000Z");
  expect(await activation.accept(input)).toEqual({ ok: true, value: legacy });
  expect(
    await rights.resolveForAccess(accountId(f.account), [f.product]),
  ).toEqual({ kind: "required" });
  expect(
    await activation.accept({ ...input, decision: "not_member" }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
});
