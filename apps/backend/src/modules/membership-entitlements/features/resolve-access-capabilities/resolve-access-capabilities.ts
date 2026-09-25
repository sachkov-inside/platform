import { contentScopeSchema, scopeOpensResource } from "@inside/access-capabilities";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";
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
  resource?: { guideIds: readonly string[]; materialId?: string | undefined },
): Promise<
  AccessCapabilities & { readonly membership: MembershipAccessState }
> {
  return projectAccessCapabilities(await readAccessCapabilityFacts(prisma, accountId, now), now, resource);
}
export async function readAccessCapabilityFacts(prisma: MembershipAccessPrisma, accountId: AccountId, now: Date) {
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
    const historicalMaterials = await prisma.accessGrant.findMany({
      where: {
        accountId,
        capabilities: { has: "materials" },
        startsAt: { lte: now },
      },
      select: { contentScope: true },
    });
    const binding = await prisma.membershipBinding.findUnique({
      where: { accountId },
      select: { accountId: true },
    });
    const last = await prisma.membershipEvidenceReceipt.findFirst({
      where: { accountId, outcome: "accepted_without_entitlement" },
      orderBy: [{ receivedAt: "desc" }, { deliveryId: "desc" }],
      select: { decision: true },
    });
  return { grants, classification, projection, revision, historicalMaterials, binding, last };
}
export function projectAccessCapabilities({ grants, classification, projection, revision, historicalMaterials, binding, last }: Awaited<ReturnType<typeof readAccessCapabilityFacts>>, now: Date, resource?: { guideIds: readonly string[]; materialId?: string | undefined }): AccessCapabilities & { readonly membership: MembershipAccessState } {
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
    for (const value of grant.capabilities) {
      const granted = accessCapabilitySchema.parse(value);
      // Прежняя запись может называть право, которое не выдаёт ни одно основание (#648).
      if (withheldAccessCapabilities.includes(granted)) continue;
      if (granted === "materials" && resource !== undefined) {
        const scope = contentScopeSchema.parse(grant.contentScope ?? { guideIds: [], materialIds: [] });
        if (!scopeOpensResource(scope, resource)) continue;
      }
      for (const capability of capabilitiesOpenedBy(granted))
        include(capability, validUntil);
    }
  }
  if (projection?.decision === "member" && projection.validUntil > now) {
    for (const capability of (classification?.bridgeBenefits ?? ["materials", "community"]).map(value => accessCapabilitySchema.parse(value))) {
      if (withheldAccessCapabilities.includes(capability)) continue;
      if (capability === "materials" && resource !== undefined) {
        const scope = contentScopeSchema.parse(classification?.bridgeContentScope ?? { guideIds: [], materialIds: [] });
        if (!scopeOpensResource(scope, resource)) continue;
      }
      // Мост открывает то же, что и выданное право: сопровождение приводит в общую группу.
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
    const expired = historicalMaterials.some(grant => {
      if (resource === undefined) return true;
      const scope = contentScopeSchema.parse(grant.contentScope ?? { guideIds: [], materialIds: [] });
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
