import { productIdFromCapability } from "@inside/access-capabilities";
import {
  coverageSchema,
  productCapability,
  isProductCapability,
  scopeOpensResource,
} from "@inside/access-capabilities";
import type { MembershipAccessState } from "../../facets/account-rights/account-rights.interface.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipAccessPrisma } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
  capabilitiesOpenedBy,
  withheldAccessCapabilities,
  type AccessCapability,
} from "../../domain/access-grant.js";

export type AccessCapabilities = Readonly<{
  capabilities: readonly {
    readonly capability: AccessCapability;
    readonly validUntil: string | null;
  }[];
  revision: number;
  nextBoundary: string | null;
}>;
export async function resolveAccessCapabilities(
  prisma: MembershipAccessPrisma,
  accountId: AccountId,
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string | undefined },
  // Public capability callers use the revision to reject stale projection snapshots.
  options: { readonly includeRevision: boolean } = { includeRevision: false },
): Promise<
  AccessCapabilities & { readonly membership: MembershipAccessState }
> {
  return projectAccessCapabilities(
    await readAccessCapabilityFacts(prisma, accountId, now, resource, options),
    now,
    resource,
  );
}
type CapabilityFacts = {
  grants: Awaited<
    ReturnType<MembershipAccessPrisma["accessGrant"]["findMany"]>
  >;
  exclusions: Awaited<
    ReturnType<MembershipAccessPrisma["productAccessExclusion"]["findMany"]>
  >;
  classification: Awaited<
    ReturnType<MembershipAccessPrisma["legacyClassification"]["findUnique"]>
  >;
  projection: Awaited<
    ReturnType<MembershipAccessPrisma["membershipProjection"]["findUnique"]>
  >;
  revision: { revision: number } | null;
  historicalMaterials: {
    coverage: Awaited<
      ReturnType<MembershipAccessPrisma["accessGrant"]["findMany"]>
    >[number]["coverage"];
  }[];
  binding: { accountId: string } | null;
  last: { decision: string | null } | null;
};
export async function readAccessCapabilityFacts(
  prisma: MembershipAccessPrisma,
  accountId: AccountId,
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string | undefined },
  options: {
    readonly includeRevision: boolean;
    readonly maximumExclusions?: number;
  } = { includeRevision: false },
): Promise<CapabilityFacts> {
  const grants = await prisma.accessGrant.findMany({
    where: {
      accountId,
      revokedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
  });
  const exclusions = await prisma.productAccessExclusion.findMany({
    where: { accountId },
    ...(options.maximumExclusions === undefined
      ? {}
      : { take: options.maximumExclusions + 1 }),
  });
  if (
    options.maximumExclusions !== undefined &&
    exclusions.length > options.maximumExclusions
  )
    throw new Error("Product exclusion set exceeds supported size");
  const classification = await prisma.legacyClassification.findUnique({
    where: { accountId },
  });
  const projection =
    classification?.bridgeEnabled === true
      ? await prisma.membershipProjection.findUnique({ where: { accountId } })
      : null;
  const revision =
    resource !== undefined && !options.includeRevision
      ? null
      : await prisma.accessChange.findFirst({
          where: { accountId },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
  // A positive resource decision needs no expired-ground or provider-failure history.
  const positiveResource: boolean =
    resource !== undefined &&
    projectAccessCapabilities(
      {
        grants,
        exclusions,
        classification,
        projection,
        revision,
        historicalMaterials: [],
        binding: null,
        last: null,
      },
      now,
      resource,
    ).capabilities.some(
      ({ capability }) =>
        capability === "materials" ||
        resource.productIds.some((id) => capability === productCapability(id)),
    );
  const historicalMaterials = positiveResource
    ? []
    : await prisma.accessGrant.findMany({
        where: {
          accountId,
          capabilities: { has: "materials" },
          startsAt: { lte: now },
        },
        select: { coverage: true },
      });
  const binding = positiveResource
    ? null
    : await prisma.membershipBinding.findUnique({
        where: { accountId },
        select: { accountId: true },
      });
  const last = positiveResource
    ? null
    : await prisma.membershipEvidenceReceipt.findFirst({
        where: { accountId, outcome: "accepted_without_entitlement" },
        orderBy: [{ receivedAt: "desc" }, { deliveryId: "desc" }],
        select: { decision: true },
      });
  return {
    grants,
    exclusions,
    classification,
    projection,
    revision,
    historicalMaterials,
    binding,
    last,
  };
}
export function projectAccessCapabilities(
  {
    grants,
    exclusions,
    classification,
    projection,
    revision,
    historicalMaterials,
    binding,
    last,
  }: CapabilityFacts,
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string | undefined },
): AccessCapabilities & { readonly membership: MembershipAccessState } {
  const bounds = new Map<AccessCapability, string | null>();
  const futureBoundaries: number[] = [];
  function include(capability: AccessCapability, until: string | null) {
    const existing = bounds.get(capability);
    if (
      existing === undefined ||
      until === null ||
      (existing !== null && until > existing)
    )
      bounds.set(capability, until);
  }
  for (const grant of grants) {
    if (grant.startsAt > now) {
      futureBoundaries.push(grant.startsAt.getTime());
      continue;
    }
    if (grant.validUntil !== null)
      futureBoundaries.push(grant.validUntil.getTime());
    const validUntil = grant.validUntil?.toISOString() ?? null;
    const excluded = exclusions
      .filter((entry) => entry.grantIds.includes(grant.id))
      .map((entry) => entry.productId);
    for (const value of grant.capabilities) {
      const granted = accessCapabilitySchema.parse(value);
      if (
        isProductCapability(granted) &&
        excluded.includes(
          productIdFromCapability(accessCapabilitySchema.parse(granted)) ?? "",
        )
      )
        continue;
      const scope =
        grant.coverage === null ? null : coverageSchema.parse(grant.coverage);
      if (
        !isProductCapability(granted) &&
        scope !== null &&
        scope.wholePlatform !== true &&
        scope.productIds.length > 0 &&
        scope.materialIds.length === 0 &&
        scope.productIds.every((id) => excluded.includes(id))
      )
        continue;
      // Прежняя запись может называть право, которое не выдаёт ни одно основание (#648).
      if (withheldAccessCapabilities.includes(granted)) continue;
      if (
        resource !== undefined &&
        (granted === "materials" ||
          (granted === "community" && grant.coverage !== null))
      ) {
        const scope = coverageSchema.parse(
          grant.coverage ?? { productIds: [], materialIds: [] },
        );
        if (
          !scopeOpensResource(scope, {
            ...resource,
            productIds: resource.productIds.filter(
              (id) => !excluded.includes(id),
            ),
          })
        )
          continue;
      }
      for (const capability of capabilitiesOpenedBy(granted))
        include(capability, validUntil);
    }
  }
  if (projection?.decision === "member" && projection.validUntil > now) {
    for (const capability of (
      classification?.bridgeBenefits ?? ["materials", "community"]
    ).map((value) => accessCapabilitySchema.parse(value))) {
      if (withheldAccessCapabilities.includes(capability)) continue;
      if (
        resource !== undefined &&
        resource.productIds.length > 0 &&
        resource.productIds.every((id) =>
          exclusions.some((entry) => entry.productId === id && entry.bridge),
        )
      )
        continue;
      if (
        resource !== undefined &&
        (capability === "materials" || classification?.bridgeCoverage != null)
      ) {
        const scope = coverageSchema.parse(
          classification?.bridgeCoverage ?? {
            productIds: [],
            materialIds: [],
          },
        );
        if (
          !scopeOpensResource(scope, {
            ...resource,
            productIds: resource.productIds.filter(
              (id) =>
                !exclusions.some(
                  (entry) => entry.productId === id && entry.bridge,
                ),
            ),
          })
        )
          continue;
      }
      // The bridge exposes only its explicit capabilities.
      for (const opened of capabilitiesOpenedBy(capability))
        include(opened, projection.validUntil.toISOString());
    }
    futureBoundaries.push(projection.validUntil.getTime());
  }
  let membership: MembershipAccessState;
  if (bounds.has("materials")) {
    membership = {
      kind: "active",
      validUntil: bounds.get("materials") ?? null,
    };
  } else if (classification?.bridgeEnabled !== true) {
    const expired = historicalMaterials.some((grant) => {
      if (resource === undefined) return true;
      const scope = coverageSchema.parse(
        grant.coverage ?? { productIds: [], materialIds: [] },
      );
      return scopeOpensResource(scope, resource);
    });
    membership = { kind: expired ? "expired" : "required" };
  } else if (projection !== null) {
    membership = {
      kind: projection.decision === "not_member" ? "expired" : "stale",
    };
  } else {
    membership = {
      kind:
        binding !== null ||
        last?.decision === "unavailable" ||
        last?.decision === "identity_conflict"
          ? "unavailable"
          : "required",
    };
  }
  return {
    membership,
    capabilities: [...bounds]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([capability, validUntil]) => ({ capability, validUntil })),
    revision: revision?.revision ?? 0,
    nextBoundary:
      futureBoundaries.length === 0
        ? null
        : new Date(Math.min(...futureBoundaries)).toISOString(),
  };
}

/** Account-set projection: one caller-owned snapshot, no per-Account history reads. */
export async function resolveAccessCapabilitiesForAccounts(
  prisma: MembershipAccessPrisma,
  accountIds: readonly string[],
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string },
): Promise<Map<string, AccessCapabilities>> {
  const result = new Map<string, AccessCapabilities>();
  for (let offset = 0; offset < accountIds.length; offset += 500) {
    const chunk = accountIds.slice(offset, offset + 500);
    const grants = await prisma.accessGrant.findMany({
      where: {
        accountId: { in: chunk },
        revokedAt: null,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
    });
    const exclusions = await prisma.productAccessExclusion.findMany({
      where: { accountId: { in: chunk } },
    });
    const classifications = await prisma.legacyClassification.findMany({
      where: { accountId: { in: chunk } },
    });
    const bridgeIds = classifications
      .filter((row) => row.bridgeEnabled)
      .map((row) => row.accountId);
    const projections =
      bridgeIds.length === 0
        ? []
        : await prisma.membershipProjection.findMany({
            where: { accountId: { in: bridgeIds } },
          });
    const revisions = await prisma.accessChange.groupBy({
      by: ["accountId"],
      where: { accountId: { in: chunk } },
      _max: { revision: true },
    });
    const grantsByAccount = new Map<string, typeof grants>();
    for (const grant of grants) {
      const grouped = grantsByAccount.get(grant.accountId) ?? [];
      grouped.push(grant);
      grantsByAccount.set(grant.accountId, grouped);
    }
    const exclusionsByAccount = new Map<string, typeof exclusions>();
    for (const exclusion of exclusions) {
      const grouped = exclusionsByAccount.get(exclusion.accountId) ?? [];
      grouped.push(exclusion);
      exclusionsByAccount.set(exclusion.accountId, grouped);
    }
    const classificationByAccount = new Map(
      classifications.map((row) => [row.accountId, row]),
    );
    const projectionByAccount = new Map(
      projections.map((row) => [row.accountId, row]),
    );
    const revisionByAccount = new Map(
      revisions.map((row) => [
        row.accountId,
        { revision: row._max.revision ?? 0 },
      ]),
    );
    for (const id of chunk) {
      const canonicalId = id.toLowerCase();
      const { capabilities, revision, nextBoundary } =
        projectAccessCapabilities(
          {
            grants: grantsByAccount.get(canonicalId) ?? [],
            exclusions: exclusionsByAccount.get(canonicalId) ?? [],
            classification: classificationByAccount.get(canonicalId) ?? null,
            projection: projectionByAccount.get(canonicalId) ?? null,
            revision: revisionByAccount.get(canonicalId) ?? null,
            historicalMaterials: [],
            binding: null,
            last: null,
          },
          now,
          resource,
        );
      result.set(id, { capabilities, revision, nextBoundary });
    }
  }
  return result;
}
