import { productCapability } from "@inside/access-capabilities";
import type { MembershipAccessState } from "../../facets/account-rights/account-rights.interface.js";
import type { AccountId } from "../../../accounts/index.js";
import type { AccountRightsPrisma } from "../../infrastructure/prisma.js";
import type { AccessCapability } from "../../domain/access-grant.js";
export type AccessCapabilities = Readonly<{
  capabilities: readonly {
    readonly capability: AccessCapability;
    readonly validUntil: string | null;
  }[];
  revision: number;
  nextBoundary: string | null;
}>;
type CapabilityFacts = {
  access: Awaited<ReturnType<AccountRightsPrisma["productAccess"]["findMany"]>>;
  revision: { revision: number } | null;
};
export async function readAccessCapabilityFacts(
  prisma: AccountRightsPrisma,
  accountId: AccountId,
  _now: Date,
  _resource?: {
    productIds: readonly string[];
    materialId?: string | undefined;
  },
  options: {
    readonly includeRevision: boolean;
    readonly maximumExclusions?: number;
  } = { includeRevision: false },
): Promise<CapabilityFacts> {
  const access = await prisma.productAccess.findMany({
    where: { accountId },
    take: 1001,
  });
  if (access.length > 1000)
    throw new Error("Product Access exceeds supported bound");
  const revision = options.includeRevision
    ? await prisma.accessChange.findFirst({
        where: { accountId },
        orderBy: { revision: "desc" },
        select: { revision: true },
      })
    : null;
  return { access, revision };
}
export function projectAccessCapabilities(
  facts: CapabilityFacts,
  _now: Date,
  resource?: { productIds: readonly string[]; materialId?: string | undefined },
): AccessCapabilities & { readonly membership: MembershipAccessState } {
  const active = facts.access.filter((row) => row.revokedAt === null);
  const matching =
    resource === undefined
      ? active
      : active.filter((row) =>
          resource.productIds.some((id) => id.toLowerCase() === row.productId),
        );
  const capabilities: { capability: AccessCapability; validUntil: null }[] =
    active.map((row) => ({
      capability: productCapability(row.productId),
      validUntil: null,
    }));
  if (matching.length > 0)
    capabilities.push(
      { capability: "materials", validUntil: null },
      { capability: "community", validUntil: null },
    );
  return {
    capabilities: capabilities.sort((a, b) =>
      a.capability.localeCompare(b.capability),
    ),
    revision: facts.revision?.revision ?? 0,
    nextBoundary: null,
    membership:
      matching.length > 0
        ? { kind: "active", validUntil: null }
        : { kind: "required" },
  };
}
export async function resolveAccessCapabilities(
  prisma: AccountRightsPrisma,
  accountId: AccountId,
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string | undefined },
  options: { readonly includeRevision: boolean } = { includeRevision: false },
) {
  return projectAccessCapabilities(
    await readAccessCapabilityFacts(prisma, accountId, now, resource, options),
    now,
    resource,
  );
}
export async function resolveAccessCapabilitiesForAccounts(
  prisma: AccountRightsPrisma,
  accountIds: readonly string[],
  now: Date,
  resource?: { productIds: readonly string[]; materialId?: string },
) {
  const result = new Map<string, AccessCapabilities>();
  for (let offset = 0; offset < accountIds.length; offset += 500) {
    const ids = accountIds.slice(offset, offset + 500);
    const access = await prisma.productAccess.findMany({
      where: { accountId: { in: ids } },
    });
    const revisions = await prisma.accessChange.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids } },
      _max: { revision: true },
    });
    for (const id of ids)
      result.set(
        id,
        projectAccessCapabilities(
          {
            access: access.filter((row) => row.accountId === id.toLowerCase()),
            revision: {
              revision:
                revisions.find((row) => row.accountId === id.toLowerCase())
                  ?._max.revision ?? 0,
            },
          },
          now,
          resource,
        ),
      );
  }
  return result;
}
