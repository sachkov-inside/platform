import { describe, expect, test } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import {
  assembleWorkshopAccess,
  type WorkshopAccessDependencies,
  type WorkshopAccessRequest,
  type WorkshopEntitlementState,
  type WorkshopResource,
  type WorkshopResourceFacts,
  type WorkshopSubject,
} from "../../src/modules/workshop/index.js";

const learnerAccountId = accountId("88000000-0000-4000-8000-000000000001");
const decidedAt = "2030-03-01T10:00:00.000Z";
const validUntil = "2030-03-01T10:05:00.000Z";

const anonymous: WorkshopSubject = { kind: "anonymous" };
const account: WorkshopSubject = { kind: "account", accountId: learnerAccountId };

const track = resource("track_outline", "kafka");
const publicLaboratory = resource("laboratory", "kafka-local-v1");
const protectedLaboratory = resource("laboratory", "kafka-recovery-v1");
const protectedCase = resource("production_case", "notification-delivery-v1");
const protectedLaboratoryAsset = resource(
  "laboratory_artifact",
  "kafka-local-compose-v1",
);
const protectedCaseAsset = resource(
  "production_case_artifact",
  "notification-starter-dotnet-v1",
);

const facts: readonly WorkshopResourceFacts[] = [
  published(track, "public"),
  published(publicLaboratory, "public"),
  published(protectedLaboratory, "workshop"),
  published(protectedCase, "workshop"),
  published(protectedLaboratoryAsset, "workshop"),
  published(protectedCaseAsset, "workshop"),
];

const protectedRequests = [
  request(anonymous, protectedLaboratory, "read", "laboratory_read"),
  request(anonymous, protectedCase, "read", "production_case_read"),
  request(anonymous, protectedLaboratoryAsset, "read", "workshop_artifact_delivery"),
  request(anonymous, protectedCaseAsset, "download", "workshop_artifact_delivery"),
] as const;

const actors: readonly Readonly<{
  name: string;
  subject: WorkshopSubject;
  entitlement: WorkshopEntitlementState;
  expected: Readonly<{
    effect: "allow" | "deny";
    reason:
      | "authentication_required"
      | "workshop_access_required"
      | "workshop_access_expired"
      | "entitlement_stale"
      | "active_workshop";
    validUntil?: string;
  }>;
}>[] = [
  {
    name: "anonymous",
    subject: anonymous,
    entitlement: { kind: "required" },
    expected: { effect: "deny", reason: "authentication_required" },
  },
  {
    name: "signed-in without grant",
    subject: account,
    entitlement: { kind: "required" },
    expected: { effect: "deny", reason: "workshop_access_required" },
  },
  {
    name: "active subscriber",
    subject: account,
    entitlement: { kind: "active", validUntil },
    expected: { effect: "allow", reason: "active_workshop", validUntil },
  },
  {
    name: "expired grant",
    subject: account,
    entitlement: { kind: "expired" },
    expected: { effect: "deny", reason: "workshop_access_expired" },
  },
  {
    name: "stale positive evidence",
    subject: account,
    entitlement: { kind: "stale" },
    expected: { effect: "deny", reason: "entitlement_stale" },
  },
];

describe("WorkshopAccess", () => {
  test.each(
    actors.flatMap((actor) =>
      protectedRequests.map((baseRequest) => ({
        actor,
        baseRequest,
        name: `${actor.name} / ${baseRequest.resource.kind} ${baseRequest.action}`,
      })),
    ),
  )("uses stable protected-resource reasons for $name", async ({ actor, baseRequest }) => {
    const workshopAccess = assembleAccess(actor.entitlement);

    await expect(
      workshopAccess.authorize({ ...baseRequest, subject: actor.subject }),
    ).resolves.toMatchObject(actor.expected);
  });

  test("opens published Track outline and public Laboratory without entitlement lookup", async () => {
    let entitlementReads = 0;
    const workshopAccess = assembleAccess(
      { kind: "unavailable" },
      facts,
      () => {
        entitlementReads += 1;
      },
    );

    await expect(
      workshopAccess.authorize(
        request(anonymous, track, "read", "track_outline_read"),
      ),
    ).resolves.toMatchObject({ effect: "allow", reason: "public_resource" });
    await expect(
      workshopAccess.authorize(
        request(anonymous, publicLaboratory, "read", "laboratory_read"),
      ),
    ).resolves.toMatchObject({ effect: "allow", reason: "public_resource" });
    expect(entitlementReads).toBe(0);
  });

  test("requires sign-in for durable public progress and preserves historical progress after expiry", async () => {
    const expiredAccess = assembleAccess({ kind: "expired" });

    await expect(
      expiredAccess.authorize(
        request(
          anonymous,
          publicLaboratory,
          "write_progress",
          "laboratory_progress_write",
        ),
      ),
    ).resolves.toMatchObject({
      effect: "deny",
      reason: "authentication_required",
    });
    await expect(
      expiredAccess.authorize(
        request(
          account,
          publicLaboratory,
          "write_progress",
          "laboratory_progress_write",
        ),
      ),
    ).resolves.toMatchObject({
      effect: "allow",
      reason: "authenticated_account",
    });
    await expect(
      expiredAccess.authorize(
        request(
          account,
          protectedLaboratory,
          "read_progress",
          "laboratory_progress_read",
        ),
      ),
    ).resolves.toMatchObject({
      effect: "allow",
      reason: "authenticated_account",
    });
    await expect(
      expiredAccess.authorize(
        request(
          account,
          protectedLaboratory,
          "write_progress",
          "laboratory_progress_write",
        ),
      ),
    ).resolves.toMatchObject({
      effect: "deny",
      reason: "workshop_access_expired",
    });
  });

  test("projects only canonical target availability for Track Items", async () => {
    const withdrawnCase = {
      kind: "production_case" as const,
      resourceId: "withdrawn-case-v1",
    };
    const workshopAccess = assembleAccess(
      { kind: "required" },
      [
        ...facts,
        {
          resource: withdrawnCase,
          publicationState: "withdrawn",
          access: "public",
        },
      ],
    );
    const forgedTrackItem = {
      itemId: "case",
      resource: protectedCase,
      action: "read" as const,
      access: "public" as const,
    };

    await expect(
      workshopAccess.checkAvailabilityMany({
        operations: [
          { itemId: "track", resource: track, action: "read" },
          { itemId: "lab", resource: publicLaboratory, action: "read" },
          forgedTrackItem,
          { itemId: "withdrawn", resource: withdrawnCase, action: "read" },
        ],
        enforcementPoint: "track_outline_read",
        correlationId: "availability-correlation",
      }),
    ).resolves.toEqual({
      ok: true,
      items: [
        { itemId: "track", availability: "public" },
        { itemId: "lab", availability: "public" },
        { itemId: "case", availability: "included" },
        { itemId: "withdrawn", availability: "unavailable" },
      ],
    });
  });

  test("fails closed for direct resource, action and dependency errors", async () => {
    const mismatchedFacts = published(
      resource("production_case", "different-case-v1"),
      "workshop",
    );
    const missingAccess = assembleAccess({ kind: "active", validUntil }, []);
    const mismatchAccess = assembleAccess(
      { kind: "active", validUntil },
      [mismatchedFacts],
      undefined,
      () => Promise.resolve(mismatchedFacts),
    );
    const unavailableAccess = assembleAccess(
      { kind: "active", validUntil },
      facts,
      undefined,
      () => Promise.reject(new Error("database unavailable")),
    );

    await expect(
      missingAccess.authorize(
        request(account, protectedCase, "read", "production_case_read"),
      ),
    ).resolves.toMatchObject({ effect: "deny", reason: "resource_not_found" });
    await expect(
      mismatchAccess.authorize(
        request(account, protectedCase, "read", "production_case_read"),
      ),
    ).resolves.toMatchObject({ effect: "deny", reason: "resource_mismatch" });
    await expect(
      unavailableAccess.authorize(
        request(account, protectedCase, "read", "production_case_read"),
      ),
    ).resolves.toMatchObject({
      effect: "deny",
      reason: "dependency_unavailable",
    });
    await expect(
      assembleAccess({ kind: "active", validUntil }).authorize(
        request(account, protectedLaboratory, "download", "laboratory_read"),
      ),
    ).resolves.toMatchObject({
      effect: "deny",
      reason: "resource_action_invalid",
    });
  });

  test("validates availability batch shape before loading resources", async () => {
    let reads = 0;
    const dependencies = dependenciesFor({ kind: "required" }, facts, () => {
      throw new Error("entitlements must not be read by availability");
    }, undefined, () => {
      reads += 1;
    });
    const workshopAccess = assembleWorkshopAccess(dependencies);
    const base = {
      enforcementPoint: "track_outline_read" as const,
      correlationId: "batch-validation",
    };

    await expect(
      workshopAccess.checkAvailabilityMany({ ...base, operations: [] }),
    ).resolves.toEqual({ ok: false, error: { code: "empty_batch" } });
    await expect(
      workshopAccess.checkAvailabilityMany({
        ...base,
        operations: Array.from({ length: 101 }, (_, index) => ({
          itemId: `item-${String(index)}`,
          resource: track,
          action: "read" as const,
        })),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "batch_too_large" } });
    await expect(
      workshopAccess.checkAvailabilityMany({
        ...base,
        operations: [
          { itemId: "duplicate", resource: track, action: "read" },
          { itemId: "duplicate", resource: publicLaboratory, action: "read" },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "duplicate_item_id" },
    });
    expect(reads).toBe(0);
  });
});

function assembleAccess(
  entitlement: WorkshopEntitlementState,
  availableFacts = facts,
  onEntitlementRead?: () => void,
  findOne?: WorkshopAccessDependencies["resourceFacts"]["findOne"],
  onResourceRead?: () => void,
) {
  return assembleWorkshopAccess(
    dependenciesFor(
      entitlement,
      availableFacts,
      onEntitlementRead,
      findOne,
      onResourceRead,
    ),
  );
}

function dependenciesFor(
  entitlement: WorkshopEntitlementState,
  availableFacts: readonly WorkshopResourceFacts[],
  onRead?: () => void,
  findOne?: WorkshopAccessDependencies["resourceFacts"]["findOne"],
  onResourceRead?: () => void,
): WorkshopAccessDependencies {
  return {
    resourceFacts: {
      findMany: () => {
        onResourceRead?.();
        return Promise.resolve(availableFacts);
      },
      findOne: findOne ?? ((requested) => {
        onResourceRead?.();
        return Promise.resolve(
          availableFacts.find(
            ({ resource: candidate }) =>
              candidate.kind === requested.kind &&
              candidate.resourceId === requested.resourceId,
          ) ?? null,
        );
      }),
    },
    workshopEntitlements: {
      resolveForAccess: () => {
        onRead?.();
        return Promise.resolve(entitlement);
      },
    },
    clock: () => new Date(decidedAt),
    decisionId: () => "workshop-decision-id",
  };
}

function request(
  subject: WorkshopSubject,
  target: WorkshopResource,
  action: WorkshopAccessRequest["action"],
  enforcementPoint: WorkshopAccessRequest["enforcementPoint"],
): WorkshopAccessRequest {
  return {
    subject,
    resource: target,
    action,
    enforcementPoint,
    correlationId: "workshop-correlation-id",
  };
}

function resource(
  kind: WorkshopResource["kind"],
  resourceId: string,
): WorkshopResource {
  return { kind, resourceId };
}

function published(
  target: WorkshopResource,
  access: "public" | "workshop",
): WorkshopResourceFacts {
  if (target.kind === "track_outline") {
    return { resource: { ...target, kind: target.kind }, publicationState: "published", access: "public" };
  }
  return {
    resource: {
      ...target,
      kind: target.kind,
    },
    publicationState: "published",
    access,
  };
}
