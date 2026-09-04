import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const learnerAccountId = accountId("89000000-0000-4000-8000-000000000001");

describe("WorkshopEntitlements Membership projection", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.account.create({
      data: {
        id: learnerAccountId,
        logtoIssuer: "https://identity.example.test/oidc",
        logtoSubject: "workshop-entitlement-learner",
      },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  test("activation, renewal, expiry and reconciliation keep separate grants consistent", async () => {
    let now = new Date("2030-04-01T00:00:00.000Z");
    const workshopEntitlements = assembleWorkshopEntitlements({
      prisma: database.prisma,
      clock: () => now,
    });
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: database.prisma,
      workshopEntitlements,
      clock: () => now,
    });

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-access-activation",
        source: "link_time",
        evidence: evidence("member", 1, now, "2030-04-01T00:05:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied", state: "active" });
    await expect(
      Promise.all([
        membershipEntitlements.resolveForAccess(learnerAccountId),
        workshopEntitlements.resolveForAccess(learnerAccountId),
      ]),
    ).resolves.toEqual([
      { kind: "active", validUntil: "2030-04-01T00:05:00.000Z" },
      { kind: "active", validUntil: "2030-04-01T00:05:00.000Z" },
    ]);

    now = new Date("2030-04-01T00:04:00.000Z");
    const renewal = {
      accountId: learnerAccountId,
      deliveryId: "workshop-access-renewal",
      source: "reconciliation" as const,
      evidence: evidence("member", 2, now, "2030-04-01T00:09:00.000Z"),
    };
    await expect(
      Promise.all([
        membershipEntitlements.acceptEvidence(renewal),
        membershipEntitlements.acceptEvidence(renewal),
      ]),
    ).resolves.toEqual([
      { ok: true, outcome: "applied", state: "active", evidenceVersion: 2 },
      { ok: true, outcome: "applied", state: "active", evidenceVersion: 2 },
    ]);
    await expect(
      database.prisma.workshopMembershipEntitlementProjection.findUniqueOrThrow({
        where: { accountId: learnerAccountId },
      }),
    ).resolves.toMatchObject({
      decision: "member",
      evidenceVersion: 2n,
      validUntil: new Date("2030-04-01T00:09:00.000Z"),
    });

    now = new Date("2030-04-01T00:09:00.000Z");
    await expect(
      Promise.all([
        membershipEntitlements.resolveForAccess(learnerAccountId),
        workshopEntitlements.resolveForAccess(learnerAccountId),
      ]),
    ).resolves.toEqual([{ kind: "stale" }, { kind: "stale" }]);

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-access-expiry-reconciliation",
        source: "reconciliation",
        evidence: evidence("not_member", 3, now, "2030-04-01T00:14:00.000Z"),
      }),
    ).resolves.toMatchObject({
      ok: true,
      outcome: "applied",
      state: "non_member",
    });
    await expect(
      Promise.all([
        membershipEntitlements.resolveForAccess(learnerAccountId),
        workshopEntitlements.resolveForAccess(learnerAccountId),
      ]),
    ).resolves.toEqual([{ kind: "expired" }, { kind: "expired" }]);

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-access-delayed-replay",
        source: "reconciliation",
        evidence: evidence(
          "member",
          2,
          now,
          "2030-04-01T00:14:00.000Z",
        ),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "replayed_evidence" } });
    await expect(
      database.prisma.workshopMembershipEntitlementProjection.findUniqueOrThrow({
        where: { accountId: learnerAccountId },
      }),
    ).resolves.toMatchObject({ decision: "not_member", evidenceVersion: 3n });
  });

  test("rolls back Membership acceptance when Workshop projection is unavailable", async () => {
    const now = new Date("2030-04-02T00:00:00.000Z");
    const deliveryId = "workshop-access-atomic-retry";
    const command = {
      accountId: accountId("89000000-0000-4000-8000-000000000002"),
      deliveryId,
      source: "link_time" as const,
      evidence: evidence(
        "member",
        1,
        now,
        "2030-04-02T00:05:00.000Z",
        "workshop-atomic-principal",
      ),
    };
    await database.prisma.account.create({
      data: {
        id: command.accountId,
        logtoIssuer: "https://identity.example.test/oidc",
        logtoSubject: "workshop-atomic-learner",
      },
    });
    const unavailableMembership = assembleMembershipEntitlements({
      prisma: database.prisma,
      workshopEntitlements: {
        applyAcceptedMembershipEvidence: () =>
          Promise.reject(new Error("Workshop projection unavailable")),
      },
      clock: () => now,
    });

    await expect(
      unavailableMembership.acceptEvidence(command),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    await expect(
      Promise.all([
        database.prisma.membershipEvidenceReceipt.findUnique({
          where: { deliveryId },
        }),
        database.prisma.membershipProjection.findUnique({
          where: { accountId: command.accountId },
        }),
        database.prisma.workshopMembershipEntitlementProjection.findUnique({
          where: { accountId: command.accountId },
        }),
      ]),
    ).resolves.toEqual([null, null, null]);

    const workshopEntitlements = assembleWorkshopEntitlements({
      prisma: database.prisma,
      clock: () => now,
    });
    const availableMembership = assembleMembershipEntitlements({
      prisma: database.prisma,
      workshopEntitlements,
      clock: () => now,
    });
    await expect(
      availableMembership.acceptEvidence(command),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      workshopEntitlements.resolveForAccess(command.accountId),
    ).resolves.toEqual({
      kind: "active",
      validUntil: "2030-04-02T00:05:00.000Z",
    });
  });
});

function evidence(
  decision: "member" | "not_member",
  evidenceVersion: number,
  checkedAt: Date,
  validUntil: string,
  principalRef = "workshop-access-principal",
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef,
    decision,
    reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
    checkedAt: checkedAt.toISOString(),
    validUntil,
    telegramIdentityRef: `${principalRef}-telegram`,
    evidenceRef: `${principalRef}-${String(evidenceVersion)}`,
    evidenceVersion,
  };
}
