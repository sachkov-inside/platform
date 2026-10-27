import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  accountId as checkedAccountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  assembleDeterministicAccountRights,
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
  access: "closed",
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
      "findFirst",
    );
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([material]),
        findOne: () => Promise.resolve(material),
      },
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      accountRights: assembleDeterministicAccountRights(),
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

  test("observes lifetime Product issuance and explicit owner withdrawal on the next operation", async () => {
    const productId = "83000000-0000-4000-8000-000000000009";
    await testDatabase.prisma.product.create({
      data: { id: productId, slug: productId, name: "Content access" },
    });
    const rights = assemblePriorParticipantsFixture({
      prisma: testDatabase.prisma,
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () =>
          Promise.resolve([{ ...material, productIds: [productId] }]),
        findOne: () =>
          Promise.resolve({ ...material, productIds: [productId] }),
      },
      accountPermissions: assembleCurrentAccountPermissions(
        assembleAccounts({
          prisma: testDatabase.prisma,
          emailFingerprintKey: "content-access-test-fingerprint-key",
        }),
      ),
      accountRights: rights,
    });
    const request = {
      subject: { kind: "account" as const, accountId },
      resource: { kind: "material" as const, materialId: material.materialId },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "83000000-0000-4000-8000-000000000004",
    };
    const target = await grantProductFixture(
      testDatabase.prisma,
      accountId,
      productId,
    );
    expect(await contentAccess.authorize(request)).toMatchObject({
      effect: "allow",
      validUntil: null,
      checkedContentVersion: 7,
    });
    await revokeProductFixture(testDatabase.prisma, target);
    expect(await contentAccess.authorize(request)).toMatchObject({
      effect: "deny",
    });
  });
});
