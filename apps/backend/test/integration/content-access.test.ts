import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  accountId as checkedAccountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  assembleDeterministicMembershipEntitlements,
  type MaterialResourceFacts,
} from "../../src/modules/content-access/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const accountId = checkedAccountId("83000000-0000-4000-8000-000000000001");
const material: MaterialResourceFacts = {
  materialId: materialId("83000000-0000-4000-8000-000000000002"),
  publicationState: "published",
  access: "membership",
  contentVersion: 7,
  primaryVideoId: null,
};

describe("ContentAccess current Platform facts", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.account.create({
      data: {
        id: accountId,
        logtoIssuer: "https://identity.example.test/oidc",
        logtoSubject: "content-access-account",
      },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("observes a PostgreSQL permission grant and revoke on the next operation", async () => {
    const accounts = assembleAccounts({
      prisma: testDatabase.prisma,
      emailFingerprintKey: "content-access-test-fingerprint-key",
    });
    const permissionRead = vi.spyOn(
      testDatabase.prisma.accountPermission,
      "findUnique",
    );
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([material]),
        findOne: () => Promise.resolve(material),
      },
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      membershipEntitlements:
        assembleDeterministicMembershipEntitlements(),
    });
    const request = {
      subject: { kind: "account" as const, accountId },
      resource: { kind: "material" as const, materialId: material.materialId },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "83000000-0000-4000-8000-000000000003",
    };

    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    await testDatabase.prisma.accountPermission.create({
      data: { accountId, permission: "materials:manage" },
    });
    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "allow",
      reason: "materials_manager",
      checkedContentVersion: 7,
    });
    await expect(
      contentAccess.checkAvailabilityMany({
        subject: request.subject,
        operations: [
          {
            itemId: "membership-card",
            resource: request.resource,
            action: "read",
          },
        ],
        enforcementPoint: "published_material_read",
        correlationId: request.correlationId,
      }),
    ).resolves.toEqual({
      ok: true,
      items: [{ itemId: "membership-card", availability: "available" }],
    });
    await testDatabase.prisma.accountPermission.delete({
      where: {
        accountId_permission: {
          accountId,
          permission: "materials:manage",
        },
      },
    });
    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    expect(permissionRead).toHaveBeenCalledTimes(4);
    permissionRead.mockRestore();
  });

  test("observes bounded Membership grant and removal on the next operation", async () => {
    const currentTime = new Date("2030-01-01T00:00:00.000Z");
    const accounts = assembleAccounts({
      prisma: testDatabase.prisma,
      emailFingerprintKey: "content-access-test-fingerprint-key",
    });
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: testDatabase.prisma,
      workshopEntitlements: assembleWorkshopEntitlements({
        prisma: testDatabase.prisma,
        clock: () => currentTime,
      }),
      clock: () => currentTime,
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([material]),
        findOne: () => Promise.resolve(material),
      },
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      membershipEntitlements,
      clock: () => currentTime,
      decisionId: () => "membership-decision-id",
    });
    const request = {
      subject: { kind: "account" as const, accountId },
      resource: { kind: "material" as const, materialId: material.materialId },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "83000000-0000-4000-8000-000000000004",
    };

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId,
        deliveryId: "content-access-member-link",
        source: "link_time",
        evidence: observedEvidence("member", 1),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(contentAccess.authorize(request)).resolves.toEqual({
      decisionId: "membership-decision-id",
      policyVersion: "content-access-v1",
      decidedAt: "2030-01-01T00:00:00.000Z",
      effect: "allow",
      reason: "active_membership",
      validUntil: "2030-01-01T00:05:00.000Z",
      checkedContentVersion: 7,
    });

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId,
        deliveryId: "content-access-member-removal",
        source: "member_status_event",
        evidence: observedEvidence("not_member", 2),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(contentAccess.authorize(request)).resolves.toEqual({
      decisionId: "membership-decision-id",
      policyVersion: "content-access-v1",
      decidedAt: "2030-01-01T00:00:00.000Z",
      effect: "deny",
      reason: "membership_expired",
    });
  });
});

function observedEvidence(
  decision: "member" | "not_member",
  evidenceVersion: number,
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef: "content-access-principal",
    decision,
    reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
    checkedAt: "2030-01-01T00:00:00Z",
    validUntil: "2030-01-01T00:05:00Z",
    telegramIdentityRef: "content-access-telegram",
    evidenceRef: `content-access-${String(evidenceVersion)}`,
    evidenceVersion,
  };
}
