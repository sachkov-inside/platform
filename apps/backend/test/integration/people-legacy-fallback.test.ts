import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const fixed = new Date("2030-01-01T00:00:00.000Z");
describe("People conservative candidates preserve complete snapshot-codec fallback", () => {
  let db: TestDatabase | undefined;
  let grants: AccessGrants;
  let owner: string;
  let expectedActive: string[];
  let expectedEnded: string[];
  let offerId: string;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer: "https://legacy-people.test", subject: "owner" },
        "platform:admin",
      )
    ).accountId;
    const base = {
      id: randomUUID(),
      revision: 1,
      name: "Тариф",
      benefits: ["materials"],
      benefitPeriods: [{ capability: "materials", months: 1 }],
      coverage: { productIds: [randomUUID()], materialIds: [] },
    };
    offerId = base.id;
    const cases = [
      { ...base, extra: true },
      { ...base, name: " \t\n" },
      { ...base, name: "\u00a0\ufeff" },
      {
        ...base,
        benefitPeriods: [...base.benefitPeriods, ...base.benefitPeriods],
      },
      { ...base, benefitPeriods: [{ capability: "support", months: 1 }] },
      {
        ...base,
        coverage: {
          wholePlatform: true,
          productIds: base.coverage.productIds,
          materialIds: [],
        },
      },
      {
        ...base,
        coverage: {
          productIds: [
            ...base.coverage.productIds,
            ...base.coverage.productIds,
          ],
          materialIds: [],
        },
      },
      { ...base, benefitPeriods: "nested malformed scalar" },
      { ...base, benefitPeriods: [[{ months: "wrong number" }]] },
      {
        ...base,
        benefitPeriods: [{ capability: "materials", months: { nested: 1 } }],
      },
      { ...base, benefitPeriods: [{ capability: "materials", months: 1201 }] },
      { ...base, benefitPeriods: [{ capability: "materials", months: 1.5 }] },
      { ...base, revision: [1] },
      { ...base, benefits: { nested: [] } },
      { ...base, coverage: { productIds: { nested: [] }, materialIds: [] } },
      { id: base.id, revision: 1, name: "Legacy", benefits: ["materials"] },
    ];
    expectedActive = [];
    for (const snapshot of cases) {
      const accountId = randomUUID();
      expectedActive.push(accountId);
      await db.prisma.account.create({
        data: {
          id: accountId,
          logtoIssuer: "https://legacy-people.test",
          logtoSubject: accountId,
        },
      });
      const enrollmentId = randomUUID();
      await db.prisma.tariffAssignment.create({
        data: {
          id: enrollmentId,
          accountId,
          tierId: base.id,
          tierRevision: 1,
          snapshot,
          origin: "manual",
          sourceRef: accountId,
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          endPolicy: "fixed",
          revision: 1,
          reason: "Fallback fixture",
        },
      });
      await db.prisma.accessGrant.create({
        data: {
          id: randomUUID(),
          accountId,
          enrollmentId,
          source: "manual",
          sourceRef: accountId,
          capabilities: ["materials"],
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          validUntil: new Date("2001-01-01T00:00:00.000Z"),
          revision: 1,
          reason: "Expired fixture",
        },
      });
    }
    for (const kind of [
      "no_grants",
      "null_and_finite",
      "platform_payment",
    ] as const) {
      const accountId = randomUUID();
      expectedActive.push(accountId);
      await db.prisma.account.create({
        data: {
          id: accountId,
          logtoIssuer: "https://legacy-people.test",
          logtoSubject: accountId,
        },
      });
      const enrollmentId = randomUUID();
      await db.prisma.tariffAssignment.create({
        data: {
          id: enrollmentId,
          accountId,
          tierId: base.id,
          tierRevision: 1,
          snapshot: base,
          origin: kind === "platform_payment" ? "platform_payment" : "manual",
          sourceRef: accountId,
          billingRef: kind === "platform_payment" ? randomUUID() : null,
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          endsAt:
            kind === "platform_payment"
              ? new Date("2030-02-01T00:00:00.000Z")
              : null,
          endPolicy: "fixed",
          revision: 1,
          reason: "Source fixture",
        },
      });
      if (kind !== "no_grants")
        for (const [index, validUntil] of (kind === "null_and_finite"
          ? [null, new Date("2001-01-01T00:00:00.000Z")]
          : [new Date("2001-01-01T00:00:00.000Z")]
        ).entries()) {
          await db.prisma.accessGrant.create({
            data: {
              id: randomUUID(),
              accountId,
              enrollmentId,
              source: "manual",
              sourceRef: `${accountId}:${index}`,
              capabilities: ["materials"],
              startsAt: new Date("2000-01-01T00:00:00.000Z"),
              validUntil,
              revision: 1,
              reason: "Source term fixture",
            },
          });
        }
    }
    // More than one internal candidate batch: exact codec fallback rejects these old rows.
    const excluded = Array.from({ length: 105 }, (_, index) => ({
      accountId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      enrollmentId: randomUUID(),
    }));
    await db.prisma.account.createMany({
      data: excluded.map(({ accountId }) => ({
        id: accountId,
        logtoIssuer: "https://legacy-people.test",
        logtoSubject: accountId,
      })),
    });
    await db.prisma.tariffAssignment.createMany({
      data: excluded.map(({ accountId, enrollmentId }) => ({
        id: enrollmentId,
        accountId,
        tierId: base.id,
        tierRevision: 1,
        snapshot: { ...base, extra: true },
        origin: "manual",
        sourceRef: accountId,
        startsAt: new Date("2000-01-01T00:00:00.000Z"),
        endsAt: new Date("2001-01-01T00:00:00.000Z"),
        endPolicy: "fixed",
        revision: 1,
        reason: "Rejected legacy candidate",
      })),
    });
    await db.prisma.accessGrant.createMany({
      data: excluded.map(({ accountId, enrollmentId }) => ({
        id: randomUUID(),
        accountId,
        enrollmentId,
        source: "manual",
        sourceRef: accountId,
        capabilities: ["materials"],
        startsAt: new Date("2000-01-01T00:00:00.000Z"),
        validUntil: new Date("2001-01-01T00:00:00.000Z"),
        revision: 1,
        reason: "Expired legacy term",
      })),
    });
    expectedEnded = [];
    for (const kind of [
      "maximum_active",
      "recently_ended",
      "recently_revoked",
      "old_revoked",
    ] as const) {
      const accountId = randomUUID();
      const enrollmentId = randomUUID();
      if (kind === "maximum_active") expectedActive.push(accountId);
      if (kind === "recently_ended" || kind === "recently_revoked")
        expectedEnded.push(accountId);
      await db.prisma.account.create({
        data: {
          id: accountId,
          logtoIssuer: "https://legacy-people.test",
          logtoSubject: accountId,
        },
      });
      await db.prisma.tariffAssignment.create({
        data: {
          id: enrollmentId,
          accountId,
          tierId: base.id,
          tierRevision: 1,
          snapshot: base,
          origin: "manual",
          sourceRef: accountId,
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          revokedAt:
            kind === "recently_revoked"
              ? new Date("2029-12-31T00:00:00.000Z")
              : kind === "old_revoked"
                ? new Date("2001-01-01T00:00:00.000Z")
                : null,
          endPolicy: "fixed",
          revision: 1,
          reason: "Window parity",
        },
      });
      await db.prisma.accessGrant.createMany({
        data: [
          new Date("2001-01-01T00:00:00.000Z"),
          new Date(
            kind === "recently_ended"
              ? "2029-12-31T00:00:00.000Z"
              : "2030-02-01T00:00:00.000Z",
          ),
        ].map((validUntil, index) => ({
          id: randomUUID(),
          accountId,
          enrollmentId,
          source: "manual",
          sourceRef: `${accountId}:${index}`,
          capabilities: ["materials"],
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          validUntil,
          revision: 1,
          reason: "Maximum retained term",
        })),
      });
    }
    expectedEnded.sort();
    expectedActive.sort();
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "legacy-people-codec-fixture-fingerprint-key",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: new TelegramAccountLinks(db.prisma),
      clock: () => fixed,
    });
  });
  afterAll(async () => db?.dispose());
  test("a valid uppercase Offer UUID preserves assignment eligibility", async () => {
    const read = await grants.listAccessHolders(
      owner,
      {
        operationId: randomUUID(),
        offerId: offerId.toUpperCase(),
        state: "active",
        limit: 100,
      },
      { offerPurchaseRefs: [] },
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.items.map((item) => item.accountId)).toEqual(
      expectedActive,
    );
  });
  test("malformed/refinement-failed and legacy snapshots retain legacy access without database coercion failures", async () => {
    const read = await grants.listAccessHolders(
      owner,
      { operationId: randomUUID(), state: "active", limit: 100 },
      { offerPurchaseRefs: [] },
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.items.map((item) => item.accountId)).toEqual(
      expectedActive,
    );
    expect(read.value.nextCursor).toBeNull();
  });
  test("filtered continuation fills the page, repeats exactly and preserves recent revoke/end windows", async () => {
    const operationId = randomUUID();
    const first = await grants.listAccessHolders(
      owner,
      { operationId, state: "active", limit: 7 },
      { offerPurchaseRefs: [] },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((item) => item.accountId)).toEqual(
      expectedActive.slice(0, 7),
    );
    expect(first.value.nextCursor).toBe(expectedActive[6]);
    const cursor = first.value.nextCursor;
    if (cursor === null) throw new Error("Missing continuation");
    const query = { operationId, state: "active", limit: 7, cursor };
    const second = await grants.listAccessHolders(owner, query, {
      offerPurchaseRefs: [],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items.map((item) => item.accountId)).toEqual(
      expectedActive.slice(7, 14),
    );
    expect(
      await grants.listAccessHolders(owner, query, { offerPurchaseRefs: [] }),
    ).toEqual(second);
    const ended = await grants.listAccessHolders(
      owner,
      { operationId, state: "ended", limit: 100 },
      { offerPurchaseRefs: [] },
    );
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.value.items.map((item) => item.accountId)).toEqual(
      expectedEnded,
    );
    expect(ended.value.nextCursor).toBeNull();
  });
  test("a failed binding set returns explicit failure and the same page remains retryable", async () => {
    if (db === undefined) throw new Error("Missing fixture database");
    const query = { operationId: randomUUID(), state: "active", limit: 7 };
    const expected = await grants.listAccessHolders(owner, query, {
      offerPurchaseRefs: [],
    });
    await db.prisma
      .$executeRaw`ALTER TABLE telegram_membership.account_link_states RENAME TO failed_people_bindings`;
    try {
      expect(
        await grants.listAccessHolders(owner, query, { offerPurchaseRefs: [] }),
      ).toMatchObject({ ok: false, error: { code: "unavailable" } });
    } finally {
      await db.prisma
        .$executeRaw`ALTER TABLE telegram_membership.failed_people_bindings RENAME TO account_link_states`;
    }
    expect(
      await grants.listAccessHolders(owner, query, { offerPurchaseRefs: [] }),
    ).toEqual(expected);
  });
});
