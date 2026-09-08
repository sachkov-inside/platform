import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  accountId,
  assembleAccounts,
  bootstrapOwnerAccount,
  type Accounts,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  type AccessGrants,
} from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

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
    return assembleMembershipEntitlements({
      prisma: db.prisma,
      clock: () => now,
      workshopEntitlements: assembleWorkshopEntitlements({
        prisma: db.prisma,
        clock: () => now,
      }),
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
            capabilities: ["materials", "community", "reviews"],
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
    if (!applied.ok || !applied.rows[0]?.result.ok)
      throw new Error(JSON.stringify(applied));
    return { ...applied.rows[0].result, command, applied };
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
    await manual(target);
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
        { capability: "reviews", validUntil: null },
      ],
    });
  });
  test("half-open intervals, future starts and finite bounds are exact", async () => {
    now = new Date(start);
    const target = await member();
    await manual(target, end);
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
          terms: { ...terms, capabilities: [...terms.capabilities] },
        },
        {
          rowKey: "unresolved",
          accountId: randomUUID(),
          source: "manual",
          sourceRef: randomUUID(),
          terms: { ...terms, capabilities: [...terms.capabilities] },
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
          terms: { ...terms, capabilities: [...terms.capabilities] },
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
    expect(await membership().resolveForAccess(accountId(target))).toEqual({
      kind: "active",
      validUntil: null,
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
