import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
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
): Promise<AccessCapabilities> {
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
    for (const capability of accessCapabilitySchema.options)
      include(capability, projection.validUntil.toISOString());
    futureBoundaries.push(projection.validUntil.getTime());
  }
  return {
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
