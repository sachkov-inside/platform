import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
  globalAccessCapabilities,
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
  prisma: MembershipEntitlementsPrisma,
  accountId: AccountId,
  now: Date,
): Promise<
  AccessCapabilities & { readonly membership: MembershipAccessState }
> {
  const grants = await prisma.accessGrant.findMany({
    where: {
      accountId,
      revokedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
  });
  const classification = await prisma.legacyClassification.findUnique({
    where: { accountId },
  });
  const projection =
    classification?.bridgeEnabled === true
      ? await prisma.membershipProjection.findUnique({ where: { accountId } })
      : null;
  const revision = await prisma.accessChange.findFirst({
    where: { accountId },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
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
    for (const value of grant.capabilities)
      include(
        accessCapabilitySchema.parse(value),
        grant.validUntil?.toISOString() ?? null,
      );
  }
  if (projection?.decision === "member" && projection.validUntil > now) {
    for (const capability of globalAccessCapabilities)
      include(capability, projection.validUntil.toISOString());
    futureBoundaries.push(projection.validUntil.getTime());
  }
  let membership: MembershipAccessState;
  if (bounds.has("materials")) {
    membership = {
      kind: "active",
      validUntil: bounds.get("materials") ?? null,
    };
  } else if (classification?.bridgeEnabled !== true) {
    const expired = await prisma.accessGrant.findFirst({
      where: {
        accountId,
        capabilities: { has: "materials" },
        startsAt: { lte: now },
      },
      select: { id: true },
    });
    membership = { kind: expired === null ? "required" : "expired" };
  } else if (projection !== null) {
    membership = {
      kind: projection.decision === "not_member" ? "expired" : "stale",
    };
  } else {
    const binding = await prisma.membershipBinding.findUnique({
      where: { accountId },
      select: { accountId: true },
    });
    const last = await prisma.membershipEvidenceReceipt.findFirst({
      where: { accountId, outcome: "accepted_without_entitlement" },
      orderBy: [{ receivedAt: "desc" }, { deliveryId: "desc" }],
      select: { decision: true },
    });
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
