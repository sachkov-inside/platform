import { describe, expect, test, vi } from "vitest";

import {
  accountId as checkedAccountId,
  type AccountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type ContentAccess,
  type GuideArtifactResourceFacts,
  type MaterialResourceFactsAdapter,
  type MembershipAccessState,
  type Subject,
} from "../../src/modules/content-access/index.js";

const accountId = checkedAccountId("81000000-0000-4000-8000-000000000001");
const artifactId = "82000000-0000-4000-8000-000000000001";
const guideId = "83000000-0000-4000-8000-000000000001";
const anonymous: Subject = { kind: "anonymous" };
const member: Subject = { accountId, kind: "account" };

const freeArtifact: GuideArtifactResourceFacts = {
  access: "free",
  archived: false,
  artifactId,
  guideIds: [guideId],
  version: 3,
};
const membershipArtifact: GuideArtifactResourceFacts = {
  ...freeArtifact,
  access: "membership",
};

describe("ContentAccess for Guide Artifacts", () => {
  test("hands a visitor a free artifact and reports the version it decided on", async () => {
    const access = contentAccess(freeArtifact);
    await expect(
      access.authorize(download(anonymous)),
    ).resolves.toMatchObject({
      checkedContentVersion: 3,
      effect: "allow",
      reason: "public_resource",
    });
  });

  test("locks a membership artifact for a visitor and opens it for an active member", async () => {
    const locked = contentAccess(membershipArtifact);
    await expect(locked.authorize(download(anonymous))).resolves.toMatchObject({
      effect: "deny",
      reason: "authentication_required",
    });

    const open = contentAccess(membershipArtifact, {
      kind: "active",
      validUntil: null,
    });
    await expect(open.authorize(download(member))).resolves.toMatchObject({
      effect: "allow",
      reason: "active_membership",
    });
  });

  test("refuses an archived artifact even for a member who paid for its Guide", async () => {
    const access = contentAccess(
      { ...membershipArtifact, archived: true },
      { kind: "active", validUntil: null },
    );
    await expect(access.authorize(download(member))).resolves.toMatchObject({
      effect: "deny",
      reason: "resource_unpublished",
    });
  });

  // Negative fixture: an artifact is downloaded, never read like a Material.
  // Widening this pair without deciding it would fail here first.
  test("refuses every action a Guide Artifact does not answer", async () => {
    const access = contentAccess(freeArtifact);
    for (const action of ["read", "play"] as const) {
      await expect(
        access.authorize({ ...download(anonymous), action }),
      ).resolves.toMatchObject({
        effect: "deny",
        reason: "resource_action_invalid",
      });
    }
  });

  test("decides an artifact-only batch without reading any Material facts", async () => {
    const materialResourceFacts = {
      findMany: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
    } satisfies MaterialResourceFactsAdapter;
    const access = assembleContentAccess({
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      guideArtifactResourceFacts: {
        findMany: () => Promise.resolve([freeArtifact]),
        findOne: () => Promise.resolve(freeArtifact),
      },
      materialResourceFacts,
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "required" }),
      },
    });

    await expect(
      access.checkAvailabilityMany({
        correlationId: "batch",
        enforcementPoint: "guide_artifact_read",
        operations: [
          {
            action: "download",
            itemId: "free",
            resource: { artifactId, kind: "guideArtifact" },
          },
        ],
        subject: anonymous,
      }),
    ).resolves.toEqual({
      items: [{ availability: "available", itemId: "free" }],
      ok: true,
    });
    expect(materialResourceFacts.findMany).not.toHaveBeenCalled();
  });
});

function contentAccess(
  artifact: GuideArtifactResourceFacts,
  membership: MembershipAccessState = { kind: "required" },
): ContentAccess {
  return assembleContentAccess({
    accountPermissions: {
      hasMaterialsManage: (id: AccountId) => Promise.resolve(id !== accountId),
    },
    guideArtifactResourceFacts: {
      findMany: () => Promise.resolve([artifact]),
      findOne: () => Promise.resolve(artifact),
    },
    materialResourceFacts: {
      findMany: () => Promise.resolve([]),
      findOne: () => Promise.resolve(null),
    },
    membershipEntitlements: { resolveForAccess: () => Promise.resolve(membership) },
  });
}

function download(subject: Subject) {
  return {
    action: "download" as const,
    correlationId: "decision",
    enforcementPoint: "guide_artifact_delivery" as const,
    resource: { artifactId, kind: "guideArtifact" as const },
    subject,
  };
}
