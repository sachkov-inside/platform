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
};

describe("ContentAccess current Account facts", () => {
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
});
