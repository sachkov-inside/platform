import { describe, expect, test } from "vitest";

import {
  accountId as checkedAccountId,
  type AccountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type MaterialResourceFacts,
} from "../../src/modules/content-access/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";

const accountId = checkedAccountId("81000000-0000-4000-8000-000000000001");

describe("ContentAccess availability", () => {
  test.each([1, 100])(
    "loads Material and subject facts a fixed number of times for N=%i",
    async (size) => {
      let materialReads = 0;
      let permissionReads = 0;
      let membershipReads = 0;
      const facts = Array.from({ length: size }, (_, index) =>
        membershipMaterial(index),
      );
      const contentAccess = assembleContentAccess({
        materialResourceFacts: {
          findMany(materialIds) {
            materialReads += 1;
            return Promise.resolve(
              facts.filter(({ materialId }) =>
                materialIds.includes(materialId),
              ),
            );
          },
          findOne(materialId) {
            materialReads += 1;
            return Promise.resolve(
              facts.find((item) => item.materialId === materialId) ?? null,
            );
          },
        },
        accountPermissions: {
          hasMaterialsManage() {
            permissionReads += 1;
            return Promise.resolve(false);
          },
        },
        membershipEntitlements: {
          resolveForAccess() {
            membershipReads += 1;
            return Promise.resolve({
              kind: "active" as const,
              validUntil: "2026-08-27T13:05:00.000Z",
            });
          },
        },
        clock: () => new Date("2026-08-27T13:00:00.000Z"),
        decisionId: () => "decision-id",
      });

      const result = await contentAccess.checkAvailabilityMany({
        subject: { kind: "account", accountId },
        operations: facts.map(({ materialId }, index) => ({
          itemId: `item-${index}`,
          resource: { kind: "material", materialId },
          action: "read",
        })),
        enforcementPoint: "published_material_read",
        correlationId: "correlation-id",
      });

      expect(result).toEqual({
        ok: true,
        items: facts.map((_, index) => ({
          itemId: `item-${index}`,
          availability: "available",
        })),
      });
      expect({ materialReads, permissionReads, membershipReads }).toEqual({
        materialReads: 1,
        permissionReads: 1,
        membershipReads: 1,
      });
    },
  );

  test("validates batch limits before I/O and rejects duplicate item IDs", async () => {
    let reads = 0;
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany() {
          reads += 1;
          return Promise.resolve([]);
        },
        findOne: () => Promise.resolve(null),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "required" }),
      },
    });
    const base = {
      subject: { kind: "anonymous" as const },
      enforcementPoint: "published_material_read" as const,
      correlationId: "correlation-id",
    };

    await expect(
      contentAccess.checkAvailabilityMany({ ...base, operations: [] }),
    ).resolves.toEqual({ ok: false, error: { code: "empty_batch" } });
    await expect(
      contentAccess.checkAvailabilityMany({
        ...base,
        operations: Array.from({ length: 101 }, (_, index) => ({
          itemId: `item-${index}`,
          resource: {
            kind: "material" as const,
            materialId: membershipMaterial(index).materialId,
          },
          action: "read" as const,
        })),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "batch_too_large" } });
    await expect(
      contentAccess.checkAvailabilityMany({
        ...base,
        operations: [0, 1].map((index) => ({
          itemId: "duplicate",
          resource: {
            kind: "material" as const,
            materialId: membershipMaterial(index).materialId,
          },
          action: "read" as const,
        })),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "duplicate_item_id" } });
    expect(reads).toBe(0);
  });

  test("preserves input order while deduplicating Material lookups", async () => {
    const first = membershipMaterial(1);
    const second = { ...membershipMaterial(2), access: "free" as const };
    let requestedIds: readonly string[] = [];
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany(materialIds) {
          requestedIds = materialIds;
          return Promise.resolve([second, first]);
        },
        findOne: () => Promise.resolve(null),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "required" }),
      },
    });

    const result = await contentAccess.checkAvailabilityMany({
      subject: { kind: "anonymous" },
      operations: [first, second, first].map((facts, index) => ({
        itemId: `item-${index}`,
        resource: { kind: "material", materialId: facts.materialId },
        action: "read",
      })),
      enforcementPoint: "published_material_read",
      correlationId: "correlation-id",
    });

    expect(requestedIds).toEqual([first.materialId, second.materialId]);
    expect(result).toEqual({
      ok: true,
      items: [
        { itemId: "item-0", availability: "locked" },
        { itemId: "item-1", availability: "available" },
        { itemId: "item-2", availability: "locked" },
      ],
    });
  });
});

describe("ContentAccess authorization", () => {
  test("authorizes a free published Material without private subject facts", async () => {
    let permissionReads = 0;
    let membershipReads = 0;
    const facts = { ...membershipMaterial(3), access: "free" as const };
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: {
        hasMaterialsManage() {
          permissionReads += 1;
          return Promise.resolve(false);
        },
      },
      membershipEntitlements: {
        resolveForAccess() {
          membershipReads += 1;
          return Promise.resolve({ kind: "required" });
        },
      },
      clock: () => new Date("2026-08-27T13:00:00.000Z"),
      decisionId: () => "decision-id",
    });

    await expect(
      contentAccess.authorize({
        subject: { kind: "anonymous" },
        resource: { kind: "material", materialId: facts.materialId },
        action: "read",
        enforcementPoint: "published_material_read",
        correlationId: "correlation-id",
      }),
    ).resolves.toEqual({
      decisionId: "decision-id",
      policyVersion: "content-access-v1",
      decidedAt: "2026-08-27T13:00:00.000Z",
      effect: "allow",
      reason: "public_resource",
      checkedContentVersion: 1,
    });
    expect({ permissionReads, membershipReads }).toEqual({
      permissionReads: 0,
      membershipReads: 0,
    });
  });

  test("observes permission grant and revoke on the next protected operation", async () => {
    const facts = membershipMaterial(4);
    let managesMaterials = false;
    let permissionReads = 0;
    let membershipReads = 0;
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: {
        hasMaterialsManage() {
          permissionReads += 1;
          return Promise.resolve(managesMaterials);
        },
      },
      membershipEntitlements: {
        resolveForAccess() {
          membershipReads += 1;
          return Promise.resolve({ kind: "required" });
        },
      },
    });
    const request = {
      subject: { kind: "account" as const, accountId },
      resource: { kind: "material" as const, materialId: facts.materialId },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "correlation-id",
    };

    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    managesMaterials = true;
    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "allow",
      reason: "materials_manager",
      checkedContentVersion: 1,
    });
    managesMaterials = false;
    await expect(contentAccess.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    expect({ permissionReads, membershipReads }).toEqual({
      permissionReads: 3,
      membershipReads: 2,
    });
  });

  test("does not reuse an active Membership decision across Accounts", async () => {
    const facts = membershipMaterial(5);
    const activeAccountId = checkedAccountId(
      "81000000-0000-4000-8000-000000000002",
    );
    const requiredAccountId = checkedAccountId(
      "81000000-0000-4000-8000-000000000003",
    );
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess(accountIdValue) {
          return Promise.resolve(
            accountIdValue === activeAccountId
              ? {
                  kind: "active" as const,
                  validUntil: "2026-08-27T13:05:00.000Z",
                }
              : { kind: "required" as const },
          );
        },
      },
    });
    const authorizeFor = (accountIdValue: AccountId) =>
      contentAccess.authorize({
        subject: { kind: "account", accountId: accountIdValue },
        resource: { kind: "material", materialId: facts.materialId },
        action: "read",
        enforcementPoint: "published_material_read",
        correlationId: accountIdValue,
      });

    await expect(authorizeFor(activeAccountId)).resolves.toMatchObject({
      effect: "allow",
      reason: "active_membership",
      validUntil: "2026-08-27T13:05:00.000Z",
    });
    await expect(authorizeFor(requiredAccountId)).resolves.toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
  });
});

function membershipMaterial(index: number): MaterialResourceFacts {
  return {
    materialId: materialId(
      `82000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    ),
    publicationState: "published",
    access: "membership",
    contentVersion: 1,
  };
}
