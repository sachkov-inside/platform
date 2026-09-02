import { describe, expect, test } from "vitest";

import {
  accountId as checkedAccountId,
  type AccountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type MaterialResourceFacts,
  type MembershipAccessState,
  type Subject,
  type VideoResourceFacts,
} from "../../src/modules/content-access/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";

const accountId = checkedAccountId("81000000-0000-4000-8000-000000000001");
const decidedAt = "2026-08-27T13:00:00.000Z";
const activeUntil = "2026-08-27T13:05:00.000Z";

interface PolicyActor {
  readonly name: string;
  readonly subject: Subject;
  readonly managesMaterials: boolean;
  readonly membership: MembershipAccessState;
}

interface ExpectedDecision {
  readonly effect: "allow" | "deny";
  readonly reason:
    | "public_resource"
    | "materials_manager"
    | "active_membership"
    | "authentication_required"
    | "membership_required"
    | "membership_expired"
    | "permission_required"
    | "resource_unpublished";
  readonly validUntil?: string;
}

type ExpectedAvailability = "available" | "locked" | "unavailable";

interface ExpectedOutcome {
  readonly decision: ExpectedDecision;
  readonly availability: ExpectedAvailability;
}

interface PolicyMatrixRow {
  readonly name: string;
  readonly facts: MaterialResourceFacts;
  readonly action: "read" | "preview";
  readonly outcomes: readonly ExpectedOutcome[];
}

const policyActors: readonly PolicyActor[] = [
  {
    name: "anonymous",
    subject: { kind: "anonymous" },
    managesMaterials: false,
    membership: { kind: "required" },
  },
  {
    name: "Account without Membership",
    subject: { kind: "account", accountId },
    managesMaterials: false,
    membership: { kind: "required" },
  },
  {
    name: "active member",
    subject: { kind: "account", accountId },
    managesMaterials: false,
    membership: { kind: "active", validUntil: activeUntil },
  },
  {
    name: "expired member",
    subject: { kind: "account", accountId },
    managesMaterials: false,
    membership: { kind: "expired" },
  },
  {
    name: "materials manager",
    subject: { kind: "account", accountId },
    managesMaterials: true,
    membership: { kind: "required" },
  },
];

const publicOutcomes = policyActors.map(() =>
  expectedOutcome("available", "allow", "public_resource"),
);
const protectedReadOutcomes = [
  expectedOutcome("locked", "deny", "authentication_required"),
  expectedOutcome("locked", "deny", "membership_required"),
  expectedOutcome("available", "allow", "active_membership", activeUntil),
  expectedOutcome("locked", "deny", "membership_expired"),
  expectedOutcome("available", "allow", "materials_manager"),
] as const;
const freePreviewOutcomes = previewOutcomes("unavailable");
const membershipPreviewOutcomes = previewOutcomes("locked");
const draftPreviewOutcomes = previewOutcomes("unavailable", "unavailable");
const unpublishedOutcomes = policyActors.map(() =>
  expectedOutcome("unavailable", "deny", "resource_unpublished"),
);

const policyMatrix: readonly PolicyMatrixRow[] = [
  {
    name: "published free read",
    facts: { ...membershipMaterial(20), access: "free" },
    action: "read",
    outcomes: publicOutcomes,
  },
  {
    name: "published membership read",
    facts: membershipMaterial(21),
    action: "read",
    outcomes: protectedReadOutcomes,
  },
  {
    name: "published free Preview",
    facts: { ...membershipMaterial(22), access: "free" },
    action: "preview",
    outcomes: freePreviewOutcomes,
  },
  {
    name: "published membership Preview",
    facts: membershipMaterial(23),
    action: "preview",
    outcomes: membershipPreviewOutcomes,
  },
  {
    name: "draft free Preview",
    facts: {
      ...membershipMaterial(24),
      publicationState: "draft",
      access: "free",
    },
    action: "preview",
    outcomes: draftPreviewOutcomes,
  },
  {
    name: "draft membership Preview",
    facts: { ...membershipMaterial(25), publicationState: "draft" },
    action: "preview",
    outcomes: draftPreviewOutcomes,
  },
  {
    name: "draft free read",
    facts: {
      ...membershipMaterial(26),
      publicationState: "draft",
      access: "free",
    },
    action: "read",
    outcomes: unpublishedOutcomes,
  },
  {
    name: "draft membership read",
    facts: { ...membershipMaterial(27), publicationState: "draft" },
    action: "read",
    outcomes: unpublishedOutcomes,
  },
  {
    name: "unpublished free read",
    facts: {
      ...membershipMaterial(28),
      publicationState: "unpublished",
      access: "free",
    },
    action: "read",
    outcomes: unpublishedOutcomes,
  },
  {
    name: "unpublished membership read",
    facts: { ...membershipMaterial(29), publicationState: "unpublished" },
    action: "read",
    outcomes: unpublishedOutcomes,
  },
];

const policyCases = policyMatrix.flatMap((row) =>
  policyActors.map((actor, actorIndex) => {
    const expected = row.outcomes[actorIndex];
    if (expected === undefined) {
      throw new Error(`Incomplete policy matrix row: ${row.name}`);
    }
    return {
      name: `${row.name} / ${actor.name}`,
      facts: row.facts,
      action: row.action,
      actor,
      expected,
    };
  }),
);

type PolicyCase = (typeof policyCases)[number];

function assemblePolicyContentAccess(policyCase: PolicyCase) {
  return assembleContentAccess({
    materialResourceFacts: {
      findMany: () => Promise.resolve([policyCase.facts]),
      findOne: () => Promise.resolve(policyCase.facts),
    },
    accountPermissions: {
      hasMaterialsManage: () =>
        Promise.resolve(policyCase.actor.managesMaterials),
    },
    membershipEntitlements: {
      resolveForAccess: () => Promise.resolve(policyCase.actor.membership),
    },
    clock: () => new Date(decidedAt),
    decisionId: () => "matrix-decision-id",
  });
}

describe("ContentAccess availability", () => {
  test.each(policyCases)("projects $name", async (policyCase) => {
    const contentAccess = assemblePolicyContentAccess(policyCase);

    await expect(
      contentAccess.checkAvailabilityMany({
        subject: policyCase.actor.subject,
        operations: [
          {
            itemId: "matrix-item",
            resource: {
              kind: "material",
              materialId: policyCase.facts.materialId,
            },
            action: policyCase.action,
          },
        ],
        enforcementPoint: policyCase.action === "read"
          ? "published_material_read"
          : "material_preview",
        correlationId: "matrix-correlation-id",
      }),
    ).resolves.toEqual({
      ok: true,
      items: [
        {
          itemId: "matrix-item",
          availability: policyCase.expected.availability,
        },
      ],
    });
  });

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
  test.each([
    {
      name: "free Video",
      facts: { ...membershipMaterial(40), access: "free" as const },
      subject: { kind: "anonymous" as const },
      expected: { effect: "allow", reason: "public_resource" },
    },
    {
      name: "membership Video",
      facts: membershipMaterial(41),
      subject: { kind: "account" as const, accountId },
      expected: { effect: "allow", reason: "active_membership" },
    },
  ])("authorizes play through the referenced Material for a $name", async ({ facts, subject, expected }) => {
    const video = primaryVideo(facts, 1);
    const referencedFacts = { ...facts, primaryVideoId: video.videoId };
    const contentAccess = assembleContentAccess({
      videoResourceFacts: {
        findMany: () => Promise.resolve([video]),
        findOne: () => Promise.resolve(video),
      },
      materialResourceFacts: {
        findMany: () => Promise.resolve([referencedFacts]),
        findOne: () => Promise.resolve(referencedFacts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "active", validUntil: activeUntil }),
      },
      clock: () => new Date(decidedAt),
      decisionId: () => "video-decision-id",
    });

    await expect(contentAccess.authorize({
      subject,
      resource: { kind: "video", videoId: video.videoId },
      action: "play",
      enforcementPoint: "playback_token_issue",
      correlationId: "video-correlation-id",
    })).resolves.toMatchObject(expected);
  });

  test("fails closed when Video facts point at a different access class", async () => {
    const facts = membershipMaterial(42);
    const video = { ...primaryVideo(facts, 2), access: "free" as const };
    const referencedFacts = { ...facts, primaryVideoId: video.videoId };
    const contentAccess = assembleContentAccess({
      videoResourceFacts: {
        findMany: () => Promise.resolve([video]),
        findOne: () => Promise.resolve(video),
      },
      materialResourceFacts: {
        findMany: () => Promise.resolve([referencedFacts]),
        findOne: () => Promise.resolve(referencedFacts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "active", validUntil: activeUntil }),
      },
      clock: () => new Date(decidedAt),
      decisionId: () => "video-mismatch-decision-id",
    });

    await expect(contentAccess.authorize({
      subject: { kind: "account", accountId },
      resource: { kind: "video", videoId: video.videoId },
      action: "play",
      enforcementPoint: "playback_token_issue",
      correlationId: "video-mismatch-correlation-id",
    })).resolves.toMatchObject({ effect: "deny", reason: "resource_mismatch" });
  });

  test("fails closed when Video is no longer the current published primary reference", async () => {
    const facts = membershipMaterial(43);
    const video = primaryVideo(facts, 3);
    const contentAccess = assembleContentAccess({
      videoResourceFacts: {
        findMany: () => Promise.resolve([video]),
        findOne: () => Promise.resolve(video),
      },
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(true) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "active", validUntil: activeUntil }),
      },
    });

    await expect(contentAccess.authorize({
      subject: { kind: "account", accountId },
      resource: { kind: "video", videoId: video.videoId },
      action: "play",
      enforcementPoint: "playback_token_issue",
      correlationId: "stale-video-correlation-id",
    })).resolves.toMatchObject({ effect: "deny", reason: "resource_mismatch" });
  });

  test.each(policyCases)("decides $name", async (policyCase) => {
    const contentAccess = assemblePolicyContentAccess(policyCase);
    const expectedDecision = {
      decisionId: "matrix-decision-id",
      policyVersion: "content-access-v1",
      decidedAt,
      ...policyCase.expected.decision,
      ...(policyCase.expected.decision.effect === "allow"
        ? { checkedContentVersion: policyCase.facts.contentVersion }
        : {}),
    };

    await expect(
      contentAccess.authorize({
        subject: policyCase.actor.subject,
        resource: {
          kind: "material",
          materialId: policyCase.facts.materialId,
        },
        action: policyCase.action,
        enforcementPoint: policyCase.action === "read"
          ? "published_material_read"
          : "material_preview",
        correlationId: "matrix-correlation-id",
      }),
    ).resolves.toEqual(expectedDecision);
  });

  test.each([
    {
      state: { kind: "stale" as const },
      reason: "entitlement_stale" as const,
    },
    {
      state: { kind: "unavailable" as const },
      reason: "dependency_unavailable" as const,
    },
  ])("maps Membership $state.kind to $reason", async ({ state, reason }) => {
    const facts = membershipMaterial(30);
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve(state),
      },
    });

    await expect(
      contentAccess.authorize({
        subject: { kind: "account", accountId },
        resource: { kind: "material", materialId: facts.materialId },
        action: "read",
        enforcementPoint: "published_material_read",
        correlationId: "membership-state-correlation-id",
      }),
    ).resolves.toMatchObject({ effect: "deny", reason });
  });

  test("keeps resource and permission dependency failures ahead of Membership", async () => {
    const facts = membershipMaterial(31);
    let membershipReads = 0;
    const membershipEntitlements = {
      resolveForAccess() {
        membershipReads += 1;
        return Promise.resolve({ kind: "active" as const, validUntil: activeUntil });
      },
    };
    const request = {
      subject: { kind: "account" as const, accountId },
      resource: { kind: "material" as const, materialId: facts.materialId },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "dependency-correlation-id",
    };
    const unavailableResource = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.reject(new Error("Materials unavailable")),
        findOne: () => Promise.reject(new Error("Materials unavailable")),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements,
    });
    const missingResource = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([]),
        findOne: () => Promise.resolve(null),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements,
    });
    const unavailablePermission = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: {
        hasMaterialsManage: () =>
          Promise.reject(new Error("Accounts unavailable")),
      },
      membershipEntitlements,
    });

    await expect(unavailableResource.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "dependency_unavailable",
    });
    await expect(missingResource.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "resource_not_found",
    });
    await expect(unavailablePermission.authorize(request)).resolves.toMatchObject({
      effect: "deny",
      reason: "dependency_unavailable",
    });
    expect(membershipReads).toBe(0);
  });

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

  test("fails closed when resolved facts do not match the requested Material", async () => {
    const requested = membershipMaterial(4);
    const resolved = { ...membershipMaterial(5), access: "free" as const };
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([resolved]),
        findOne: () => Promise.resolve(resolved),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(true) },
      membershipEntitlements: {
        resolveForAccess: () =>
          Promise.resolve({
            kind: "active",
            validUntil: "2026-08-27T13:05:00.000Z",
          }),
      },
      clock: () => new Date("2026-08-27T13:00:00.000Z"),
      decisionId: () => "mismatch-decision-id",
    });

    await expect(
      contentAccess.authorize({
        subject: { kind: "account", accountId },
        resource: { kind: "material", materialId: requested.materialId },
        action: "read",
        enforcementPoint: "published_material_read",
        correlationId: "mismatch-correlation-id",
      }),
    ).resolves.toEqual({
      decisionId: "mismatch-decision-id",
      policyVersion: "content-access-v1",
      decidedAt: "2026-08-27T13:00:00.000Z",
      effect: "deny",
      reason: "resource_mismatch",
    });
  });

  test("re-runs protected Material policy for a body-linked download", async () => {
    const facts = membershipMaterial(6);
    const assetId = "83000000-0000-4000-8000-000000000006";
    let permissionReads = 0;
    let membershipReads = 0;
    const contentAccess = assembleContentAccess({
      assetResourceFacts: {
        findMany: () => Promise.resolve([{ assetId, kind: "file", materialId: facts.materialId }]),
        findOne: () => Promise.resolve({ assetId, kind: "file", materialId: facts.materialId }),
      },
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: {
        hasMaterialsManage() {
          permissionReads += 1;
          return Promise.resolve(true);
        },
      },
      membershipEntitlements: {
        resolveForAccess() {
          membershipReads += 1;
          return Promise.resolve({ kind: "active", validUntil: activeUntil });
        },
      },
      clock: () => new Date(decidedAt),
      decisionId: () => "invalid-action-decision-id",
    });

    await expect(
      contentAccess.authorize({
        subject: { kind: "account", accountId },
        resource: { kind: "asset", assetId },
        action: "download",
        enforcementPoint: "download_delivery",
        correlationId: "invalid-action-correlation-id",
      }),
    ).resolves.toEqual({
      decisionId: "invalid-action-decision-id",
      policyVersion: "content-access-v1",
      decidedAt,
      effect: "allow",
      reason: "materials_manager",
      checkedContentVersion: facts.contentVersion,
    });
    await expect(
      contentAccess.checkAvailabilityMany({
        subject: { kind: "account", accountId },
        operations: [
          {
            itemId: "invalid-action-item",
            resource: { kind: "asset", assetId },
            action: "download",
          },
        ],
        enforcementPoint: "download_delivery",
        correlationId: "invalid-action-correlation-id",
      }),
    ).resolves.toEqual({
      ok: true,
      items: [
        { itemId: "invalid-action-item", availability: "available" },
      ],
    });
    expect({ permissionReads, membershipReads }).toEqual({
      permissionReads: 2,
      membershipReads: 0,
    });
  });

  test("observes permission grant and revoke on the next protected operation", async () => {
    const facts = membershipMaterial(7);
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

  test("denies Preview without materials:manage before reading Membership", async () => {
    const facts = membershipMaterial(8);
    let membershipReads = 0;
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([facts]),
        findOne: () => Promise.resolve(facts),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess() {
          membershipReads += 1;
          throw new Error("Membership projection is unavailable");
        },
      },
      clock: () => new Date("2026-08-27T13:00:00.000Z"),
      decisionId: () => "preview-decision-id",
    });

    await expect(
      contentAccess.authorize({
        subject: { kind: "account", accountId },
        resource: { kind: "material", materialId: facts.materialId },
        action: "preview",
        enforcementPoint: "material_preview",
        correlationId: "preview-correlation-id",
      }),
    ).resolves.toEqual({
      decisionId: "preview-decision-id",
      policyVersion: "content-access-v1",
      decidedAt: "2026-08-27T13:00:00.000Z",
      effect: "deny",
      reason: "permission_required",
    });
    expect(membershipReads).toBe(0);
  });

  test("does not reuse an active Membership decision across Accounts", async () => {
    const facts = membershipMaterial(9);
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
    primaryVideoId: null,
  };
}

function primaryVideo(
  material: MaterialResourceFacts,
  index: number,
): VideoResourceFacts {
  return {
    videoId: `84000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    materialId: material.materialId,
    access: material.access,
  };
}

function expectedOutcome(
  availability: ExpectedAvailability,
  effect: ExpectedDecision["effect"],
  reason: ExpectedDecision["reason"],
  validUntil?: string,
): ExpectedOutcome {
  return {
    availability,
    decision: {
      effect,
      reason,
      ...(validUntil === undefined ? {} : { validUntil }),
    },
  };
}

function previewOutcomes(
  deniedAvailability: "locked" | "unavailable",
  managerAvailability: "available" | "unavailable" = "available",
): readonly ExpectedOutcome[] {
  return [
    expectedOutcome(deniedAvailability, "deny", "authentication_required"),
    expectedOutcome(deniedAvailability, "deny", "permission_required"),
    expectedOutcome(deniedAvailability, "deny", "permission_required"),
    expectedOutcome(deniedAvailability, "deny", "permission_required"),
    expectedOutcome(managerAvailability, "allow", "materials_manager"),
  ];
}
