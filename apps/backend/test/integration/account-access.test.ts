import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  accountId,
  assembleAccounts,
  bootstrapOwnerAccount,
  type Accounts,
} from "../../src/modules/accounts/index.js";
import { paidPeriodCommandSchema } from "../../src/modules/account-rights/features/apply-paid-period/apply-paid-period.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

import { createQueryEventClient } from "./setup/query-events.js";

const start = "2030-01-01T00:00:00.000Z";
const end = "2030-02-01T00:00:00.000Z";
const issuer = "https://identity.example.test/oidc";
const terms = {
  capabilities: ["materials", "community"] as const,
  startsAt: start,
  validUntil: end,
  reason: "Verified period",
};

describe("independent Account access", () => {
  let db: TestDatabase;
  let accounts: Accounts;
  let grants: AccessGrants;
  let owner: string;
  const workloadFixtures = new Map<number, string[]>();
  let now = new Date(start);
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "account-access-test-fingerprint-key",
    });
    owner = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer, subject: "access-owner" },
        "platform:admin",
      )
    ).accountId;
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    for (const size of [1, 100, 1000]) {
      const ids = Array.from({ length: size }, () => randomUUID());
      await db.prisma.account.createMany({
        data: ids.map((id) => ({ id, logtoIssuer: issuer, logtoSubject: id })),
      });
      workloadFixtures.set(size, ids);
    }
  });
  afterAll(async () => db.dispose());
  async function member() {
    const subject = randomUUID();
    const result = await accounts.establishAccount({
      identity: verifiedAccountSignIn({
        issuer,
        subject,
        verifiedEmail: `${subject}@example.test`,
      }).identity,
    });
    if (!result.ok) throw new Error("Account fixture failed");
    return result.account.accountId;
  }
  function membership() {
    return assembleAccountRights({
      prisma: db.prisma,
      clock: () => now,
    });
  }
  async function manual(target: string, validUntil: string | null = null) {
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "course",
          accountId: target,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            ...terms,
            // Прямое право не открывает материалы: вручную выдаются сопровождение и общая группа.
            capabilities: ["community", "support"],
            validUntil,
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const command = {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["course"],
    };
    const applied = await grants.applyBatch(owner, command);
    const result = applied.ok ? applied.rows[0]?.result : undefined;
    // Строка ручной выдачи отчитывается основанием; классифицированная строка — состоянием Account.
    if (result === undefined || !result.ok || !("grantRef" in result))
      throw new Error(JSON.stringify(applied));
    return { ...result, command, applied };
  }
  /** Материалы открываются тарифом или покупкой: оплаченный период с материалами и общей группой. */
  async function paidMaterials(target: string, validUntil: string | null) {
    const applied = await grants.applyPaidPeriod({
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: target,
      revision: 1,
      revoked: false,
      terms: { ...terms, capabilities: [...terms.capabilities], validUntil },
    });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
  }
  test("paid inbox replays after projector crash, conflicts on changed payload and serializes concurrent delivery", async () => {
    now = new Date(start);
    const target = await member();
    const command = {
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: target,
      revision: 1,
      revoked: false,
      terms: { ...terms, capabilities: [...terms.capabilities] },
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => grants.applyPaidPeriod(command)),
    );
    expect(results[0]?.ok).toBe(true);
    for (const result of results) expect(result).toEqual(results[0]);
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: target } }),
    ).toBe(1);
    expect(
      await db.prisma.accessChange.count({ where: { accountId: target } }),
    ).toBe(1);
    const restarted = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    expect(await restarted.applyPaidPeriod(command)).toEqual(results[0]);
    // A receipt stored before #732 holds the digest of the parsed command's JSON text.
    await db.prisma.accessReceipt.update({
      where: {
        scope_operationId: {
          scope: "paid-period",
          operationId: command.eventRef,
        },
      },
      data: {
        fingerprint: createHash("sha256")
          .update(JSON.stringify(paidPeriodCommandSchema.parse(command)))
          .digest("hex"),
      },
    });
    expect(await restarted.applyPaidPeriod(command)).toEqual(results[0]);
    expect(
      await grants.applyPaidPeriod({
        ...command,
        terms: { ...command.terms, validUntil: "2030-03-01T00:00:00Z" },
      }),
    ).toEqual({ ok: false, error: { code: "operation_conflict" } });
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: end,
    });
    expect(
      await grants.applyPaidPeriod({
        ...command,
        eventRef: randomUUID(),
        revision: 2,
        revoked: true,
      }),
    ).toMatchObject({ ok: true, revision: 2 });
    expect(
      await grants.applyPaidPeriod({ ...command, eventRef: randomUUID() }),
    ).toEqual({ ok: false, error: { code: "revision_conflict" } });
    expect(await restarted.applyPaidPeriod(command)).toEqual(results[0]);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "expired",
    });
  });
  test("lifetime survives paid refund, negative legacy evidence and expiry; capabilities union independently", async () => {
    now = new Date(start);
    const target = await member();
    await paidMaterials(target, null);
    const paid = {
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: target,
      revision: 1,
      revoked: false,
      terms: { ...terms, capabilities: ["materials" as const] },
    };
    expect((await grants.applyPaidPeriod(paid)).ok).toBe(true);
    expect(
      (
        await grants.applyPaidPeriod({
          ...paid,
          eventRef: randomUUID(),
          revision: 2,
          revoked: true,
        })
      ).ok,
    ).toBe(true);
    const principalRef = randomUUID();
    await membership().acceptEvidence({
      accountId: accountId(target),
      deliveryId: randomUUID(),
      source: "link_time",
      evidence: {
        contractVersion: "inside.membership-evidence.v1",
        principalRef,
        decision: "not_member",
        reasonCode: "chat_not_member",
        telegramIdentityRef: "fixture-identity",
        evidenceRef: randomUUID(),
        evidenceVersion: 1,
        checkedAt: start,
        validUntil: "2030-01-01T00:05:00.000Z",
      },
    });
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: null,
    });
    now = new Date(end);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: null,
    });
    expect(await grants.resolveCapabilities(target)).toMatchObject({
      ok: true,
      capabilities: [
        { capability: "community", validUntil: null },
        { capability: "materials", validUntil: null },
      ],
    });
    // Прежняя запись с правом `reviews` его не открывает: ревью не выдаёт ни одно основание (#648).
    await db.prisma.accessGrant.updateMany({
      where: { accountId: target, source: "paid", revokedAt: null },
      data: { capabilities: ["community", "materials", "reviews"] },
    });
    const legacy = await grants.resolveCapabilities(target);
    expect(
      legacy.ok && legacy.capabilities.map((entry) => entry.capability),
    ).toEqual(["community", "materials"]);
  });
  test.each([1, 100, 1000])(
    "Account-set fact reads stay bounded for %i Accounts",
    async (size) => {
      const ids = workloadFixtures.get(size);
      if (ids === undefined) throw new Error("Missing owned workload fixture");
      const measured = createQueryEventClient(db.url);
      try {
        const observed = assembleAccessGrants({
          prisma: measured.prisma,
          accounts,
          clock: () => new Date(start),
        });
        const reading = await measured.measure(() =>
          observed.resolveCapabilitiesForAccounts(ids),
        );
        expect(reading.result.ok && reading.result.accounts.size).toBe(size);
        expect(
          reading.statements.filter((sql) => sql.startsWith("SELECT")).length,
        ).toBe(3 * Math.ceil(size / 500));
        if (reading.result.ok)
          for (const access of reading.result.accounts.values()) {
            expect(access).toEqual({
              capabilities: [],
              revision: 0,
              nextBoundary: null,
            });
          }
      } finally {
        await measured.prisma.$disconnect();
      }
    },
  );
  test("a permitted resource reads no expired-ground or provider-failure history", async () => {
    now = new Date(start);
    const target = await member();
    await paidMaterials(target, end);
    const materialId = randomUUID();
    await db.prisma.accessGrant.updateMany({
      where: { accountId: target },
      data: { coverage: { productIds: [], materialIds: [materialId] } },
    });
    const measured = createQueryEventClient(db.url);
    try {
      const rights = assembleAccountRights({
        prisma: measured.prisma,
        clock: () => now,
      });
      const reading = await measured.measure(() =>
        rights.resolveForAccess(accountId(target), [], materialId),
      );
      expect(reading.result).toEqual({ kind: "active", validUntil: end });
      expect(
        reading.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(2);
    } finally {
      await measured.prisma.$disconnect();
    }
  });
  test.each([
    "overlapping",
    "foreign",
    "future",
    "expired",
    "revoked",
    "active_bridge",
    "expired_bridge",
  ])(
    "resource decisions preserve %s grounds and match complete owner facts",
    async (scenario) => {
      now = new Date(start);
      const target = await member();
      const materialId = randomUUID();
      const otherMaterial = randomUUID();
      const later = "2030-03-01T00:00:00.000Z";
      if (scenario.endsWith("bridge")) {
        await db.prisma.legacyClassification.create({
          data: {
            accountId: target,
            classification: "confirmed_legacy",
            sourceRef: randomUUID(),
            reason: "Bridge fixture",
            verifiedAt: now,
            revision: 1,
            bridgeEnabled: true,
            bridgeCoverage: { productIds: [], materialIds: [materialId] },
            bridgeBenefits: ["materials", "community"],
          },
        });
        const principalRef = randomUUID();
        await db.prisma.membershipBinding.create({
          data: { accountId: target, principalRef, linkedAt: now },
        });
        await db.prisma.membershipProjection.create({
          data: {
            accountId: target,
            principalRef,
            decision: "member",
            evidenceRef: randomUUID(),
            evidenceVersion: 1n,
            evidenceFingerprint: "a".repeat(64),
            checkedAt: new Date("2029-12-31T00:00:00.000Z"),
            validUntil: new Date(scenario === "active_bridge" ? end : start),
            updatedAt: now,
          },
        });
      } else {
        const row = {
          id: randomUUID(),
          accountId: target,
          source: "paid",
          sourceRef: randomUUID(),
          capabilities: ["materials"],
          coverage: {
            productIds: [],
            materialIds: [scenario === "foreign" ? otherMaterial : materialId],
          },
          startsAt: new Date(start),
          validUntil: new Date(scenario === "expired" ? start : end),
          revokedAt: scenario === "revoked" ? now : null,
          revision: 1,
          reason: "Resource fixture",
        };
        await db.prisma.accessGrant.create({
          data: {
            ...row,
            startsAt:
              scenario === "expired"
                ? new Date("2029-12-01T00:00:00.000Z")
                : row.startsAt,
          },
        });
        if (scenario === "overlapping" || scenario === "future")
          await db.prisma.accessGrant.create({
            data: {
              ...row,
              id: randomUUID(),
              sourceRef: randomUUID(),
              validUntil: new Date(later),
              startsAt:
                scenario === "future"
                  ? new Date("2030-01-02T00:00:00.000Z")
                  : now,
            },
          });
      }
      const expected =
        scenario === "expired_bridge"
          ? { kind: "stale" }
          : scenario === "foreign"
            ? { kind: "required" }
            : scenario === "expired" || scenario === "revoked"
              ? { kind: "expired" }
              : {
                  kind: "active",
                  validUntil: scenario === "overlapping" ? later : end,
                };
      expect(
        await membership().resolveForAccess(accountId(target), [], materialId),
      ).toEqual(expected);
      expect(
        await membership().resolveManyForAccess(accountId(target), [
          { productIds: [], materialId },
        ]),
      ).toEqual([expected]);
      if (scenario.endsWith("bridge")) {
        const set = await grants.resolveCapabilitiesForAccounts([target]);
        const single = await grants.resolveCapabilities(target);
        expect(set.ok && single.ok && set.accounts.get(target)).toEqual(
          single.ok
            ? {
                capabilities: single.capabilities,
                revision: single.revision,
                nextBoundary: single.nextBoundary,
              }
            : null,
        );
      }
    },
  );
  test("projects an Account set with the same finite, absent and future rights", async () => {
    now = new Date(start);
    const active = await member();
    const absent = await member();
    const future = await member();
    await paidMaterials(active, end);
    await paidMaterials(future, end);
    await db.prisma.accessGrant.updateMany({
      where: { accountId: future },
      data: { startsAt: new Date("2030-01-02T00:00:00.000Z") },
    });
    const measured = createQueryEventClient(db.url);
    let result;
    try {
      const observed = assembleAccessGrants({
        prisma: measured.prisma,
        accounts,
        clock: () => now,
      });
      const reading = await measured.measure(() =>
        observed.resolveCapabilitiesForAccounts([
          active,
          absent,
          future,
          active,
        ]),
      );
      result = reading.result;
      expect(
        reading.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(3);
    } finally {
      await measured.prisma.$disconnect();
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounts.size).toBe(3);
    for (const id of [active, absent, future]) {
      const single = await grants.resolveCapabilities(id);
      expect(single.ok).toBe(true);
      if (single.ok)
        expect(result.accounts.get(id)).toEqual({
          capabilities: single.capabilities,
          revision: single.revision,
          nextBoundary: single.nextBoundary,
        });
    }
    expect(result.accounts.get(absent)?.capabilities).toEqual([]);
    expect(result.accounts.get(future)?.capabilities).toEqual([]);
  });
  test("half-open intervals, future starts and finite bounds are exact", async () => {
    now = new Date(start);
    const target = await member();
    await paidMaterials(target, end);
    now = new Date(new Date(start).getTime() - 1);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "required",
    });
    now = new Date(start);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: end,
    });
    now = new Date(new Date(end).getTime() - 1);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: end,
    });
    now = new Date(end);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "expired",
    });
  });
  test("preview is read-only; concurrent apply returns each original row result and does not grant twice", async () => {
    now = new Date(start);
    const target = await member();
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "one",
          accountId: target,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            ...terms,
            capabilities: ["community" as const, "support" as const],
          },
        },
        {
          rowKey: "unresolved",
          accountId: randomUUID(),
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            ...terms,
            capabilities: ["community" as const, "support" as const],
          },
        },
      ],
    });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: target } }),
    ).toBe(0);
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(preview.rows.map((row) => row.status)).toEqual([
      "confirmed",
      "not_found",
    ]);
    const command = {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["one"],
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => grants.applyBatch(owner, command)),
    );
    expect(results[0]?.ok).toBe(true);
    for (const result of results) expect(result).toEqual(results[0]);
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: target } }),
    ).toBe(1);
    expect(
      await grants.applyBatch(owner, {
        ...command,
        confirmedRows: ["unresolved"],
      }),
    ).toEqual({ ok: false, error: { code: "operation_conflict" } });
    expect(
      await grants.applyBatch(owner, { ...command, operationId: randomUUID() }),
    ).toEqual({ ok: false, error: { code: "revision_conflict" } });
  });
  test("current owner permission, immutable mapping, preview expiry and row validation fail closed", async () => {
    now = new Date(start);
    const target = await member();
    const command = {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "one",
          accountId: target,
          source: "manual" as const,
          sourceRef: randomUUID(),
          terms: {
            ...terms,
            capabilities: ["community" as const, "support" as const],
          },
        },
      ],
    };
    expect(await grants.previewBatch(target, command)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      await grants.previewBatch(owner, {
        ...command,
        rows: [...command.rows, ...command.rows],
      }),
    ).toEqual({ ok: false, error: { code: "invalid_input" } });
    // Прямая выдача не открывает материалы, не называет отдельный материал и не выдаёт ревью.
    const [row] = command.rows;
    if (row === undefined) throw new Error("Expected one grant row");
    for (const forbidden of [
      { capabilities: ["reviews" as const] },
      { capabilities: ["materials" as const] },
      {
        capabilities: ["support" as const],
        coverage: { productIds: [], materialIds: [randomUUID()] },
      },
    ])
      expect(
        await grants.previewBatch(owner, {
          ...command,
          operationId: randomUUID(),
          rows: [{ ...row, terms: { ...row.terms, ...forbidden } }],
        }),
      ).toEqual({ ok: false, error: { code: "invalid_input" } });
    const preview = await grants.previewBatch(owner, command);
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const apply = {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: 1,
      confirmedRows: ["one"],
    };
    const changedIdentity = assembleAccessGrants({
      prisma: db.prisma,
      accounts: {
        checkPermission: (query) => accounts.checkPermission(query),
        readIdentityForLink: () =>
          Promise.resolve({
            issuer,
            subject: "changed",
            telegramSubjectRef: null,
          }),
      },
      clock: () => now,
    });
    expect(await changedIdentity.applyBatch(owner, apply)).toEqual({
      ok: false,
      error: { code: "identity_changed" },
    });
    now = new Date(preview.expiresAt);
    expect(await grants.applyBatch(owner, apply)).toEqual({
      ok: false,
      error: { code: "preview_expired" },
    });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: target } }),
    ).toBe(0);
  });
  test("extend and revoke are idempotent, revision-checked and affect only their own grant", async () => {
    now = new Date(start);
    const target = await member();
    const finite = await manual(target, end);
    await manual(target);
    const extend = {
      operationId: randomUUID(),
      grantRef: finite.grantRef,
      expectedRevision: 1,
      action: "extend" as const,
      validUntil: "2030-03-01T00:00:00.000Z",
      reason: "Owner extension",
    };
    expect(await grants.changeGrant(owner, extend)).toEqual({
      ok: true,
      grantRef: finite.grantRef,
      revision: 2,
    });
    expect(await grants.changeGrant(owner, extend)).toEqual({
      ok: true,
      grantRef: finite.grantRef,
      revision: 2,
    });
    expect(
      await grants.changeGrant(owner, { ...extend, operationId: randomUUID() }),
    ).toEqual({ ok: false, error: { code: "revision_conflict" } });
    expect(
      (
        await db.prisma.accessReceipt.findUniqueOrThrow({
          where: {
            scope_operationId: {
              scope: owner,
              operationId: extend.operationId,
            },
          },
        })
      ).payload,
    ).toMatchObject({
      validUntil: extend.validUntil,
      expectedRevision: 1,
      reason: extend.reason,
    });
    const revoke = {
      operationId: randomUUID(),
      grantRef: finite.grantRef,
      expectedRevision: 2,
      action: "revoke" as const,
      reason: "Owner revoked only finite grant",
    };
    expect(await grants.changeGrant(owner, revoke)).toEqual({
      ok: true,
      grantRef: finite.grantRef,
      revision: 3,
    });
    expect(await grants.changeGrant(owner, revoke)).toEqual({
      ok: true,
      grantRef: finite.grantRef,
      revision: 3,
    });
    // Отозвано только срочное основание: бессрочное ручное сопровождение и общая группа остаются.
    expect(await grants.resolveCapabilities(target)).toMatchObject({
      ok: true,
      capabilities: [
        { capability: "community", validUntil: null },
        { capability: "support", validUntil: null },
      ],
    });
  });
  test("new joins never become legacy; explicit cohort and classification remain separate from recurring approval", async () => {
    now = new Date(start);
    const target = await member();
    const evidence = {
      contractVersion: "inside.membership-evidence.v1",
      principalRef: randomUUID(),
      decision: "member",
      reasonCode: "chat_member",
      telegramIdentityRef: "fixture-identity",
      evidenceRef: randomUUID(),
      evidenceVersion: 1,
      checkedAt: start,
      validUntil: "2030-01-01T00:05:00.000Z",
    };
    expect(
      (
        await membership().acceptEvidence({
          accountId: accountId(target),
          deliveryId: randomUUID(),
          source: "link_time",
          evidence,
        })
      ).ok,
    ).toBe(true);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "required",
    });
    expect(await grants.readLegacyClassification(target)).toEqual({
      ok: true,
      classification: "unknown",
      revision: 0,
      recurringAllowed: false,
    });
    const classification = {
      operationId: randomUUID(),
      accountId: target,
      expectedRevision: 0,
      classification: "confirmed_legacy" as const,
      sourceRef: "verified-cohort-fixture",
      reason: "Explicit old cohort fixture",
      bridgeEnabled: true,
      tributeStopped: false,
    };
    expect(await grants.classifyLegacy(owner, classification)).toEqual({
      ok: true,
      revision: 1,
    });
    expect(await grants.classifyLegacy(owner, classification)).toEqual({
      ok: true,
      revision: 1,
    });
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: evidence.validUntil,
    });
    expect(await grants.readLegacyClassification(target)).toMatchObject({
      recurringAllowed: false,
    });
    expect(
      await grants.classifyLegacy(owner, {
        ...classification,
        operationId: randomUUID(),
        expectedRevision: 1,
        tributeStopped: true,
      }),
    ).toEqual({ ok: true, revision: 2 });
    expect(await grants.readLegacyClassification(target)).toMatchObject({
      recurringAllowed: true,
    });
    now = new Date(evidence.validUntil);
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "stale",
    });
  });
  test.each(["single", "set"])(
    "%s reads capability and revision from one snapshot while revoke commits",
    async (mode) => {
      now = new Date(start);
      const target = await member();
      const grant = await manual(target);
      async function read() {
        if (mode === "single") return grants.resolveCapabilities(target);
        const result = await grants.resolveCapabilitiesForAccounts([target]);
        if (!result.ok) return result;
        const access = result.accounts.get(target);
        if (access === undefined) throw new Error("Missing Account projection");
        return { ok: true as const, ...access };
      }
      const before = await read();
      const locked = signal();
      const release = signal();
      const blocker = db.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(
          Prisma.sql`lock table account_rights.legacy_classifications in access exclusive mode`,
        );
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      let reading: ReturnType<typeof read> | undefined;
      try {
        reading = read();
        await expect
          .poll(
            async () =>
              z.array(z.object({ waiting: z.boolean() })).parse(
                await db.prisma.$queryRaw(Prisma.sql`
        select exists(select 1 from pg_locks where relation = 'account_rights.legacy_classifications'::regclass and not granted) as waiting
      `),
              )[0]?.waiting,
          )
          .toBe(true);
        expect(
          (
            await grants.changeGrant(owner, {
              operationId: randomUUID(),
              grantRef: grant.grantRef,
              expectedRevision: 1,
              action: "revoke",
              reason: "Concurrent revoke",
            })
          ).ok,
        ).toBe(true);
      } finally {
        release.resolve();
        await blocker;
      }
      expect(await reading).toEqual(before);
      const after = await read();
      expect(after).toMatchObject({ ok: true, capabilities: [] });
      if (!before.ok || !after.ok) throw new Error("Missing snapshot");
      expect(after.revision).toBeGreaterThan(before.revision);
    },
  );

  test("serializes changes to different grants of one Account before allocating audit revisions", async () => {
    now = new Date(start);
    const target = await member();
    const first = await manual(target);
    const second = await manual(target);
    const locked = signal();
    const release = signal();
    const blocker = db.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`lock table account_rights.access_changes in access exclusive mode`,
      );
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const changes: ReturnType<AccessGrants["changeGrant"]>[] = [];
    try {
      changes.push(
        grants.changeGrant(owner, {
          operationId: randomUUID(),
          grantRef: first.grantRef,
          expectedRevision: 1,
          action: "revoke",
          reason: "First decision",
        }),
      );
      await expect
        .poll(
          async () =>
            z.array(z.object({ waiting: z.boolean() })).parse(
              await db.prisma.$queryRaw(Prisma.sql`
        select exists(select 1 from pg_locks where relation = 'account_rights.access_changes'::regclass and not granted) as waiting
      `),
            )[0]?.waiting,
        )
        .toBe(true);
      changes.push(
        grants.changeGrant(owner, {
          operationId: randomUUID(),
          grantRef: second.grantRef,
          expectedRevision: 1,
          action: "revoke",
          reason: "Second decision",
        }),
      );
      await expect
        .poll(
          async () =>
            z.array(z.object({ waiting: z.boolean() })).parse(
              await db.prisma.$queryRaw(Prisma.sql`
        select exists(select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting
      `),
            )[0]?.waiting,
        )
        .toBe(true);
      expect(
        (
          await db.prisma.accessGrant.findUniqueOrThrow({
            where: { id: second.grantRef },
          })
        ).revision,
      ).toBe(1);
    } finally {
      release.resolve();
      await blocker;
    }
    expect((await Promise.all(changes)).every((result) => result.ok)).toBe(
      true,
    );
    const audit = await db.prisma.accessChange.findMany({
      where: { accountId: target, kind: "revoke" },
      orderBy: { revision: "asc" },
    });
    expect(audit.map((row) => row.grantId)).toEqual([
      first.grantRef,
      second.grantRef,
    ]);
  });

  test("receipt failure rolls back paid grant and audit; retry then fulfills once", async () => {
    now = new Date(start);
    const target = await member();
    const command = {
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: target,
      revision: 1,
      revoked: false,
      terms: { ...terms, capabilities: [...terms.capabilities] },
    };
    await db.prisma.$executeRaw(
      Prisma.sql`create function account_rights.reject_test_receipt() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end $$`,
    );
    await db.prisma.$executeRaw(
      Prisma.sql`create trigger reject_test_receipt before insert on account_rights.access_receipts for each row execute function account_rights.reject_test_receipt()`,
    );
    try {
      expect(await grants.applyPaidPeriod(command)).toEqual({
        ok: false,
        error: { code: "unavailable" },
      });
      expect(
        await db.prisma.accessGrant.count({ where: { accountId: target } }),
      ).toBe(0);
      expect(
        await db.prisma.accessChange.count({ where: { accountId: target } }),
      ).toBe(0);
    } finally {
      await db.prisma.$executeRaw(
        Prisma.sql`drop trigger reject_test_receipt on account_rights.access_receipts`,
      );
      await db.prisma.$executeRaw(
        Prisma.sql`drop function account_rights.reject_test_receipt()`,
      );
    }
    expect((await grants.applyPaidPeriod(command)).ok).toBe(true);
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: target } }),
    ).toBe(1);
  });

  test("link revisions retain stable reference, unlink tombstone and historical binding across relink", async () => {
    const target = await member();
    const linkRef = randomUUID();
    const principalRef = randomUUID();
    await db.prisma.telegramLinkTransaction.create({
      data: {
        linkRef,
        accountId: target,
        principalRef,
        returnCorrelation: randomUUID(),
        tokenDigest: "x".repeat(43),
        providerIdentityRef: "telegram-first",
        status: "linked",
        createdAt: new Date(start),
        updatedAt: new Date(start),
        expiresAt: new Date(end),
      },
    });
    const links = new TelegramAccountLinks(db.prisma);
    const initial = await links.readBinding({ accountId: target });
    if (!initial.ok || initial.binding === null)
      throw new Error("Missing link revision");
    expect(initial.binding).toMatchObject({
      linkRevision: 1,
      accountRef: principalRef,
      telegramIdentityRef: "telegram-first",
    });
    await db.prisma.telegramLinkTransaction.update({
      where: { linkRef },
      data: { updatedAt: new Date(end) },
    });
    expect(await links.readBinding({ accountId: target })).toEqual(initial);
    await db.prisma.telegramLinkTransaction.update({
      where: { linkRef },
      data: { status: "expired" },
    });
    expect(await links.readBinding({ accountId: target })).toEqual({
      ok: true,
      binding: {
        linkRef: initial.binding.linkRef,
        linkRevision: 2,
        accountRef: null,
        telegramIdentityRef: null,
      },
    });
    await db.prisma.telegramLinkTransaction.update({
      where: { linkRef },
      data: { status: "linked", providerIdentityRef: "telegram-second" },
    });
    expect(await links.readBinding({ accountId: target })).toEqual({
      ok: true,
      binding: {
        ...initial.binding,
        linkRevision: 3,
        telegramIdentityRef: "telegram-second",
      },
    });
    expect(await links.readBinding({ accountId: target, revision: 1 })).toEqual(
      initial,
    );
  });
});

function signal() {
  let resolve: () => void = () => {
    throw new Error("Signal not initialized");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
