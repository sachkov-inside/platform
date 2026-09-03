import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type MaterialResourceFacts,
} from "../../src/modules/content-access/index.js";
import { materialId } from "../../src/modules/materials/index.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshop } from "../../src/modules/workshop/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerAccountId = accountId("86000000-0000-4000-8000-000000000001");
const learnerAccountId = accountId("86000000-0000-4000-8000-000000000002");
const concurrentLearnerAccountId = accountId(
  "86000000-0000-4000-8000-000000000003",
);
const workshopScope = "production-workshop-v1";

describe("Workshop foundation", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.account.createMany({
      data: [
        {
          id: ownerAccountId,
          logtoIssuer: "https://identity.example.test/oidc",
          logtoSubject: "workshop-owner",
        },
        {
          id: learnerAccountId,
          logtoIssuer: "https://identity.example.test/oidc",
          logtoSubject: "workshop-learner",
        },
        {
          id: concurrentLearnerAccountId,
          logtoIssuer: "https://identity.example.test/oidc",
          logtoSubject: "workshop-concurrent-learner",
        },
      ],
    });
  });

  test("serializes the Membership decision with a concurrent entitlement change", async () => {
    const now = new Date("2030-02-01T00:00:00.000Z");
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: database.prisma,
      clock: () => now,
    });
    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: concurrentLearnerAccountId,
        deliveryId: "concurrent-member-link",
        source: "link_time",
        evidence: membershipEvidence(
          "member",
          1,
          now,
          "workshop-concurrent-learner-principal",
        ),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });

    let signalGrantReachedMembership!: () => void;
    const grantReachedMembership = new Promise<void>((resolve) => {
      signalGrantReachedMembership = resolve;
    });
    let releaseMembershipResolution!: () => void;
    const membershipResolutionReleased = new Promise<void>((resolve) => {
      releaseMembershipResolution = resolve;
    });
    const workshop = assembleWorkshop({
      prisma: database.prisma,
      membershipEntitlements: {
        async resolveForAccess(account) {
          signalGrantReachedMembership();
          await membershipResolutionReleased;
          return membershipEntitlements.resolveForAccess(account);
        },
      },
      ownerPolicy: { canManageWorkshop: () => Promise.resolve(true) },
      materialCatalog: { findMany: () => Promise.resolve([]) },
      sourceArchives: {
        store: () => Promise.reject(new Error("not used by this slice")),
      },
      clock: () => now,
      id: () => "86000000-0000-4000-8000-000000000090",
    });

    const grant = workshop.grantEntitlement({
      actorAccountId: ownerAccountId,
      targetAccountId: concurrentLearnerAccountId,
      workshopScope: "concurrent-grant-workshop-v1",
      startsAt: now.toISOString(),
      validUntil: "2030-02-02T00:00:00.000Z",
      grantSource: "owner_beta",
      idempotencyKey: "concurrent-membership-grant",
    });
    await grantReachedMembership;
    const membershipRemoval = membershipEntitlements.acceptEvidence({
      accountId: concurrentLearnerAccountId,
      deliveryId: "concurrent-member-removal",
      source: "member_status_event",
      evidence: membershipEvidence(
        "not_member",
        2,
        now,
        "workshop-concurrent-learner-principal",
      ),
    });

    try {
      await waitForBlockedAdvisoryLock(database);
    } finally {
      releaseMembershipResolution();
    }
    await expect(grant).resolves.toMatchObject({ ok: true });
    await expect(membershipRemoval).resolves.toMatchObject({
      ok: true,
      outcome: "applied",
    });
    await expect(
      membershipEntitlements.resolveForAccess(concurrentLearnerAccountId),
    ).resolves.toMatchObject({ kind: "expired" });
    await expect(
      workshop.resolveAccess({
        accountId: concurrentLearnerAccountId,
        workshopScope: "concurrent-grant-workshop-v1",
      }),
    ).resolves.toMatchObject({ kind: "active" });
  });

  afterAll(async () => {
    await database.dispose();
  });

  test("keeps a bounded grant independent from later Membership changes and requires explicit regrant after expiry", async () => {
    let now = new Date("2030-01-01T00:00:00.000Z");
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: database.prisma,
      clock: () => now,
    });
    let ownerAllowed = true;
    let nextEntitlementId = 10;
    const workshop = assembleWorkshop({
      prisma: database.prisma,
      membershipEntitlements,
      ownerPolicy: { canManageWorkshop: () => Promise.resolve(ownerAllowed) },
      materialCatalog: { findMany: () => Promise.resolve([]) },
      sourceArchives: {
        store: () => Promise.reject(new Error("not used by this slice")),
      },
      clock: () => now,
      id: () =>
        `86000000-0000-4000-8000-${String(nextEntitlementId++).padStart(12, "0")}`,
    });

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-member-link",
        source: "link_time",
        evidence: membershipEvidence("member", 1, now),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });

    const command = {
      actorAccountId: ownerAccountId,
      targetAccountId: learnerAccountId,
      workshopScope,
      startsAt: "2030-01-01T00:00:00.000Z",
      validUntil: "2030-01-02T00:00:00.000Z",
      grantSource: "owner_beta" as const,
      idempotencyKey: "grant-learner-first-window",
    };
    const [first, concurrentGrantReplay] = await Promise.all([
      workshop.grantEntitlement(command),
      workshop.grantEntitlement(command),
    ]);
    expect(first).toMatchObject({
      ok: true,
      value: {
        startsAt: command.startsAt,
        validUntil: command.validUntil,
        workshopScope,
      },
    });
    expect(concurrentGrantReplay).toEqual(first);
    await expect(workshop.grantEntitlement(command)).resolves.toEqual(first);
    await expect(
      workshop.grantEntitlement({
        ...command,
        validUntil: "2030-01-03T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
    ownerAllowed = false;
    await expect(
      workshop.grantEntitlement({
        ...command,
        idempotencyKey: "grant-forbidden-owner",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    ownerAllowed = true;

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-member-removal",
        source: "member_status_event",
        evidence: membershipEvidence("not_member", 2, now),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      workshop.resolveAccess({ accountId: learnerAccountId, workshopScope }),
    ).resolves.toEqual({
      kind: "active",
      startsAt: command.startsAt,
      validUntil: command.validUntil,
    });

    now = new Date("2030-01-02T00:00:00.000Z");
    await expect(
      workshop.resolveAccess({ accountId: learnerAccountId, workshopScope }),
    ).resolves.toEqual({ kind: "expired" });
    await expect(
      workshop.grantEntitlement({
        ...command,
        startsAt: "2030-01-02T00:00:00.000Z",
        validUntil: "2030-01-03T00:00:00.000Z",
        idempotencyKey: "grant-without-current-membership",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "membership_required" },
    });

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-member-rejoin",
        source: "member_status_event",
        evidence: membershipEvidence("member", 3, now),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      workshop.grantEntitlement({
        ...command,
        startsAt: "2030-01-02T00:00:00.000Z",
        validUntil: "2030-01-03T00:00:00.000Z",
        idempotencyKey: "grant-second-window",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      workshop.resolveAccess({ accountId: learnerAccountId, workshopScope }),
    ).resolves.toMatchObject({
      kind: "active",
      validUntil: "2030-01-03T00:00:00.000Z",
    });
  });

  test("publishes an immutable synthetic CaseSpec idempotently and keeps the current pointer on artifact failure", async () => {
    const now = new Date("2030-01-04T00:00:00.000Z");
    const caseSpec = {
      caseId: "partner-webhooks",
      learningOutcome: "Deliver partner webhooks without losing accepted events",
      version: "fixture-v1",
    };
    const contentDigest = sha256(JSON.stringify(caseSpec));
    let archiveFailure = false;
    let materialCatalogMode: "different" | "duplicate" | "requested" = "requested";
    let ownerAllowed = true;
    let nextId = 100;
    const workshop = assembleWorkshop({
      prisma: database.prisma,
      membershipEntitlements: { resolveForAccess: () => Promise.resolve({ kind: "required" }) },
      ownerPolicy: { canManageWorkshop: () => Promise.resolve(ownerAllowed) },
      materialCatalog: {
        findMany: (materialIds) =>
          Promise.resolve(
            materialIds.map((materialId, index) => ({
              materialId:
                materialCatalogMode === "different"
                  ? `87000000-0000-4000-8000-${String(index).padStart(12, "0")}`
                  : materialCatalogMode === "duplicate"
                    ? (materialIds.at(0) ?? materialId)
                    : materialId,
              access: "workshop" as const,
              publicationState: "published" as const,
            })),
          ),
      },
      sourceArchives: {
        store(input) {
          if (archiveFailure) {
            return Promise.resolve({
              ok: false as const,
              error: { code: "dependency_unavailable" as const },
            });
          }
          const digest = sha256(input.body);
          return Promise.resolve({
            ok: true as const,
            value: {
              key: `workshop/source-archives/${digest}`,
              digest,
              byteSize: input.body.byteLength,
              retentionTime: input.retentionTime,
            },
          });
        },
      },
      clock: () => now,
      id: () =>
        `86000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    });
    const firstCommand = {
      actorAccountId: ownerAccountId,
      caseSlug: "partner-webhooks",
      workshopScope,
      caseVersion: "fixture-v1",
      schemaVersion: "inside.workshop.case-spec.synthetic-v1",
      sourceRepository: "synthetic/workshop-foundation",
      sourceCommit: "1111111111111111111111111111111111111111",
      caseSpec,
      contentDigest,
      artifacts: [
        {
          name: "starter",
          body: new TextEncoder().encode("synthetic starter archive"),
          contentType: "application/gzip",
          retentionTime: "2031-01-04T00:00:00.000Z",
        },
      ],
      materials: [
        {
          materialId: "86000000-0000-4000-8000-000000000201",
          role: "prerequisite" as const,
          ordinal: 1,
          releasePolicy: { kind: "immediate" as const },
        },
        {
          materialId: "86000000-0000-4000-8000-000000000202",
          role: "hint" as const,
          ordinal: 2,
          releasePolicy: {
            kind: "hint_reveal" as const,
            hintKey: "delivery-retries",
          },
        },
        {
          materialId: "86000000-0000-4000-8000-000000000203",
          role: "exact_solution" as const,
          ordinal: 3,
          releasePolicy: { kind: "solution_reveal" as const },
        },
      ],
      idempotencyKey: "publish-synthetic-v1",
    };

    const [first, concurrentPublicationReplay] = await Promise.all([
      workshop.publishCase(firstCommand),
      workshop.publishCase(firstCommand),
    ]);
    expect(first).toMatchObject({
      ok: true,
      value: {
        caseSlug: "partner-webhooks",
        caseVersion: "fixture-v1",
        contentDigest,
      },
    });
    expect(concurrentPublicationReplay).toEqual(first);
    await expect(workshop.publishCase(firstCommand)).resolves.toEqual(first);
    await expect(
      workshop.publishCase({
        ...firstCommand,
        idempotencyKey: "publish-synthetic-v1-retry",
      }),
    ).resolves.toEqual(first);
    await expect(
      workshop.publishCase({
        ...firstCommand,
        caseVersion: "fixture-v1-conflict",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
    ownerAllowed = false;
    await expect(
      workshop.publishCase({
        ...firstCommand,
        sourceCommit: "4444444444444444444444444444444444444444",
        idempotencyKey: "publish-forbidden-owner",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    ownerAllowed = true;

    const published = await workshop.loadCurrentCase("partner-webhooks");
    expect(published).toEqual(first);
    if (!first.ok) throw new Error("Synthetic publication unexpectedly failed");
    await expect(
      database.prisma.workshopCaseVersion.update({
        where: { id: first.value.caseVersionId },
        data: { caseSpec: { tampered: true } },
      }),
    ).rejects.toThrow("Workshop CaseVersion is immutable");

    archiveFailure = true;
    await expect(
      workshop.publishCase({
        ...firstCommand,
        caseVersion: "fixture-v2",
        sourceCommit: "2222222222222222222222222222222222222222",
        caseSpec: { ...caseSpec, version: "fixture-v2" },
        contentDigest: sha256(
          JSON.stringify({ ...caseSpec, version: "fixture-v2" }),
        ),
        idempotencyKey: "publish-synthetic-v2",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "artifact_unavailable" },
    });
    await expect(workshop.loadCurrentCase("partner-webhooks")).resolves.toEqual(
      published,
    );

    materialCatalogMode = "different";
    await expect(
      workshop.publishCase({
        ...firstCommand,
        caseVersion: "fixture-v3",
        sourceCommit: "3333333333333333333333333333333333333333",
        caseSpec: { ...caseSpec, version: "fixture-v3" },
        contentDigest: sha256(
          JSON.stringify({ ...caseSpec, version: "fixture-v3" }),
        ),
        idempotencyKey: "publish-synthetic-v3",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_material" },
    });
    await expect(workshop.loadCurrentCase("partner-webhooks")).resolves.toEqual(
      published,
    );

    materialCatalogMode = "duplicate";
    await expect(
      workshop.publishCase({
        ...firstCommand,
        caseVersion: "fixture-v4",
        sourceCommit: "5555555555555555555555555555555555555555",
        caseSpec: { ...caseSpec, version: "fixture-v4" },
        contentDigest: sha256(
          JSON.stringify({ ...caseSpec, version: "fixture-v4" }),
        ),
        idempotencyKey: "publish-synthetic-v4",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_material" },
    });
  });

  test("applies one entitlement and reveal decision to direct Material, asset and Video access", async () => {
    let now = new Date("2030-01-04T00:00:00.000Z");
    let nextId = 300;
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: database.prisma,
      clock: () => now,
    });
    const workshop = assembleWorkshop({
      prisma: database.prisma,
      membershipEntitlements,
      ownerPolicy: { canManageWorkshop: () => Promise.resolve(true) },
      materialCatalog: { findMany: () => Promise.resolve([]) },
      sourceArchives: {
        store: () => Promise.reject(new Error("not used by this slice")),
      },
      clock: () => now,
      id: () =>
        `86000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    });
    const currentCase = await workshop.loadCurrentCase("partner-webhooks");
    if (!currentCase.ok) throw new Error("Synthetic Case fixture is missing");

    await expect(
      membershipEntitlements.acceptEvidence({
        accountId: learnerAccountId,
        deliveryId: "workshop-member-current-window",
        source: "member_status_event",
        evidence: membershipEvidence("member", 4, now),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      workshop.grantEntitlement({
        actorAccountId: ownerAccountId,
        targetAccountId: learnerAccountId,
        workshopScope,
        startsAt: now.toISOString(),
        validUntil: "2030-01-05T00:00:00.000Z",
        grantSource: "owner_beta",
        idempotencyKey: "grant-content-access-window",
      }),
    ).resolves.toMatchObject({ ok: true });

    const immediateMaterialId = materialId(
      "86000000-0000-4000-8000-000000000201",
    );
    const hintMaterialId = materialId(
      "86000000-0000-4000-8000-000000000202",
    );
    const solutionMaterialId = materialId(
      "86000000-0000-4000-8000-000000000203",
    );
    await expect(
      workshop.materialAccess.resolve(learnerAccountId, immediateMaterialId),
    ).resolves.toMatchObject({ availability: "available" });
    await expect(
      workshop.materialAccess.resolve(learnerAccountId, hintMaterialId),
    ).resolves.toEqual({ availability: "locked" });
    await expect(
      workshop.materialAccess.resolve(learnerAccountId, solutionMaterialId),
    ).resolves.toEqual({ availability: "locked" });

    const hintFacts: MaterialResourceFacts = {
      materialId: hintMaterialId,
      publicationState: "published",
      access: "workshop",
      contentVersion: 9,
      primaryVideoId: "86000000-0000-4000-8000-000000000212",
    };
    const assetId = "86000000-0000-4000-8000-000000000211";
    const videoId = "86000000-0000-4000-8000-000000000212";
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([hintFacts]),
        findOne: () => Promise.resolve(hintFacts),
      },
      assetResourceFacts: {
        findMany: () =>
          Promise.resolve([
            { assetId, kind: "file", materialId: hintMaterialId },
          ]),
        findOne: () =>
          Promise.resolve({ assetId, kind: "file", materialId: hintMaterialId }),
      },
      videoResourceFacts: {
        findMany: () =>
          Promise.resolve([
            { videoId, materialId: hintMaterialId, access: "workshop" },
          ]),
        findOne: () =>
          Promise.resolve({
            videoId,
            materialId: hintMaterialId,
            access: "workshop",
          }),
      },
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () =>
          Promise.resolve({
            kind: "active",
            validUntil: "2030-01-04T00:05:00.000Z",
          }),
      },
      workshopMaterialAccess: workshop.materialAccess,
      clock: () => now,
      decisionId: () => "workshop-content-decision",
    });
    const directRequests = [
      {
        resource: { kind: "material" as const, materialId: hintMaterialId },
        action: "read" as const,
        enforcementPoint: "published_material_read" as const,
      },
      {
        resource: { kind: "asset" as const, assetId },
        action: "download" as const,
        enforcementPoint: "download_delivery" as const,
      },
      {
        resource: { kind: "video" as const, videoId },
        action: "play" as const,
        enforcementPoint: "playback_token_issue" as const,
      },
      {
        resource: { kind: "video" as const, videoId },
        action: "play" as const,
        enforcementPoint: "video_authorization_callback" as const,
      },
    ];
    const materialRequest = directRequests[0];
    if (materialRequest === undefined) throw new Error("Material access fixture is missing");
    for (const request of directRequests) {
      await expect(
        contentAccess.authorize({
          ...request,
          subject: { kind: "account", accountId: learnerAccountId },
          correlationId: "workshop-content-matrix",
        }),
      ).resolves.toMatchObject({
        effect: "deny",
        reason: "workshop_material_locked",
      });
    }
    await expect(
      contentAccess.authorize({
        ...materialRequest,
        subject: { kind: "account", accountId: ownerAccountId },
        correlationId: "membership-without-workshop-entitlement",
      }),
    ).resolves.toMatchObject({
      effect: "deny",
      reason: "workshop_access_required",
    });

    const hintRevealCommand = {
      accountId: learnerAccountId,
      caseVersionId: currentCase.value.caseVersionId,
      hintKey: "delivery-retries",
      idempotencyKey: "reveal-delivery-retries",
    };
    const [hintReveal, concurrentHintReplay] = await Promise.all([
      workshop.revealHint(hintRevealCommand),
      workshop.revealHint(hintRevealCommand),
    ]);
    expect(hintReveal).toMatchObject({ ok: true });
    expect(concurrentHintReplay).toEqual(hintReveal);
    await expect(workshop.revealHint(hintRevealCommand)).resolves.toEqual(
      hintReveal,
    );
    await expect(
      workshop.revealHint({
        accountId: learnerAccountId,
        caseVersionId: currentCase.value.caseVersionId,
        hintKey: "different-hint",
        idempotencyKey: "reveal-delivery-retries",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
    for (const request of directRequests) {
      await expect(
        contentAccess.authorize({
          ...request,
          subject: { kind: "account", accountId: learnerAccountId },
          correlationId: "workshop-content-matrix",
        }),
      ).resolves.toMatchObject({
        effect: "allow",
        reason: "active_workshop",
        validUntil: "2030-01-05T00:00:00.000Z",
        checkedContentVersion: 9,
      });
    }

    const solutionRevealCommand = {
      accountId: learnerAccountId,
      caseVersionId: currentCase.value.caseVersionId,
      idempotencyKey: "reveal-synthetic-solution",
    };
    const [solutionReveal, concurrentSolutionReplay] = await Promise.all([
      workshop.revealSolution(solutionRevealCommand),
      workshop.revealSolution(solutionRevealCommand),
    ]);
    expect(solutionReveal).toMatchObject({
      ok: true,
      value: { reason: "learner_requested" },
    });
    expect(concurrentSolutionReplay).toEqual(solutionReveal);
    await expect(
      workshop.revealSolution(solutionRevealCommand),
    ).resolves.toEqual(solutionReveal);
    await expect(
      workshop.materialAccess.resolve(learnerAccountId, solutionMaterialId),
    ).resolves.toMatchObject({ availability: "available" });

    if (!hintReveal.ok || !solutionReveal.ok) {
      throw new Error("Reveal fixture unexpectedly failed");
    }
    await expect(
      database.prisma.workshopHintReveal.update({
        where: { id: hintReveal.value.revealId },
        data: { revealedAt: new Date("2030-01-04T01:00:00.000Z") },
      }),
    ).rejects.toThrow("Workshop record is immutable");
    await expect(
      database.prisma.workshopSolutionReveal.update({
        where: { id: solutionReveal.value.revealId },
        data: { reason: "after_attempt" },
      }),
    ).rejects.toThrow("Workshop record is immutable");

    now = new Date("2030-01-05T00:00:00.000Z");
    await expect(
      workshop.materialAccess.resolve(learnerAccountId, hintMaterialId),
    ).resolves.toEqual({ availability: "unavailable" });
    await expect(
      workshop.revealHint({
        accountId: learnerAccountId,
        caseVersionId: currentCase.value.caseVersionId,
        hintKey: "delivery-retries",
        idempotencyKey: "reveal-hint-after-expiry",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "access_required" },
    });
    await expect(
      workshop.revealSolution({
        accountId: learnerAccountId,
        caseVersionId: currentCase.value.caseVersionId,
        idempotencyKey: "reveal-solution-after-expiry",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "access_required" },
    });

    await database.prisma.workshopCaseVersion.update({
      where: { id: currentCase.value.caseVersionId },
      data: { withdrawnAt: now },
    });
    await expect(
      workshop.loadCurrentCase("partner-webhooks"),
    ).resolves.toEqual({ ok: false, error: { code: "case_not_found" } });
  });
});

function membershipEvidence(
  decision: "member" | "not_member",
  evidenceVersion: number,
  checkedAt: Date,
  principalRef = "workshop-learner-principal",
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef,
    decision,
    reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
    checkedAt: checkedAt.toISOString(),
    validUntil: new Date(checkedAt.getTime() + 5 * 60 * 1_000).toISOString(),
    telegramIdentityRef: `${principalRef}-telegram`,
    evidenceRef: `${principalRef}-${String(evidenceVersion)}`,
    evidenceVersion,
  };
}

async function waitForBlockedAdvisoryLock(database: TestDatabase): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await database.prisma.$queryRaw<readonly { count: bigint }[]>(
      Prisma.sql`
        select count(*) as count
        from pg_stat_activity
        where datname = current_database()
          and wait_event = 'advisory'
      `,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Membership update did not wait on the grant advisory lock");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
