import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { productCapability } from "@inside/access-capabilities";
import type { AccountId } from "../../../accounts/index.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import { currentMembershipReceipts } from "../../infrastructure/current-membership-receipts.js";
import { projectAccessCapabilities } from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { MembershipAccessState } from "../../facets/account-rights/account-rights.interface.js";

/** One resource, many Accounts: scoped facts in one coherent snapshot, without per-Account reads. */
export async function resolveMembershipForAccessAccounts(
  prisma: AccountRightsPrismaClient,
  accountIds: readonly AccountId[],
  now: Date,
  productIds?: readonly string[],
  materialId?: string,
): Promise<ReadonlyMap<string, MembershipAccessState>> {
  const requested = z.array(z.uuid()).parse(accountIds);
  const ids = [...new Set(requested.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return new Map();
  const resource =
    productIds === undefined && materialId === undefined
      ? undefined
      : { productIds: productIds ?? [], materialId };
  return prisma.$transaction(async (tx) => {
    await setAccessSnapshotIsolation(tx);
    const results = new Map<string, MembershipAccessState>();
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const grants = await tx.accessGrant.findMany({
        where: {
          accountId: { in: chunk },
          revokedAt: null,
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      });
      const classifications = await tx.legacyClassification.findMany({
        where: { accountId: { in: chunk } },
      });
      const bridgeIds = classifications
        .filter((row) => row.bridgeEnabled)
        .map((row) => row.accountId);
      const projections =
        bridgeIds.length === 0
          ? []
          : await tx.membershipProjection.findMany({
              where: { accountId: { in: bridgeIds } },
            });
      const grantsByAccount = new Map<string, typeof grants>();
      for (const grant of grants) {
        const group = grantsByAccount.get(grant.accountId) ?? [];
        group.push(grant);
        grantsByAccount.set(grant.accountId, group);
      }
      const classificationByAccount = new Map(
        classifications.map((row) => [row.accountId, row]),
      );
      const projectionByAccount = new Map(
        projections.map((row) => [row.accountId, row]),
      );
      const factsFor = (id: string) => ({
        grants: grantsByAccount.get(id) ?? [],
        classification: classificationByAccount.get(id) ?? null,
        projection: projectionByAccount.get(id) ?? null,
        revision: null,
        historicalMaterials: [],
        binding: null,
        last: null,
      });
      const positive = (facts: ReturnType<typeof factsFor>) => {
        const projected = projectAccessCapabilities(facts, now, resource);
        const bounds = projected.capabilities.filter(
          ({ capability }) =>
            capability === "materials" ||
            (productIds ?? []).some(
              (id) => capability === productCapability(id),
            ),
        );
        return bounds.length === 0
          ? undefined
          : {
              kind: "active" as const,
              validUntil: bounds.some((value) => value.validUntil === null)
                ? null
                : (bounds
                    .map((value) => value.validUntil)
                    .sort()
                    .at(-1) ?? null),
            };
      };
      const denied = chunk.filter((id) => {
        try {
          const opened = positive(factsFor(id));
          if (opened) results.set(id, opened);
          return opened === undefined;
        } catch (error) {
          results.set(
            id,
            dependencyFailure(
              {
                module: "account-rights",
                operation: "resolveForAccessAccounts",
              },
              error,
              { kind: "unavailable" as const },
            ),
          );
          return false;
        }
      });
      const historical =
        denied.length === 0
          ? []
          : await tx.accessGrant.findMany({
              where: {
                accountId: { in: denied },
                capabilities: { has: "materials" },
                startsAt: { lte: now },
              },
              select: { accountId: true, coverage: true },
            });
      const unresolvedBridge = bridgeIds.filter(
        (id) => denied.includes(id) && !projectionByAccount.has(id),
      );
      const bindings =
        unresolvedBridge.length === 0
          ? []
          : await tx.membershipBinding.findMany({
              where: { accountId: { in: unresolvedBridge } },
              select: { accountId: true },
            });
      const receipts = await currentMembershipReceipts(tx, unresolvedBridge);
      const historyByAccount = new Map<string, typeof historical>();
      for (const row of historical) {
        const group = historyByAccount.get(row.accountId) ?? [];
        group.push(row);
        historyByAccount.set(row.accountId, group);
      }
      const bindingByAccount = new Map(
        bindings.map((row) => [row.accountId, row]),
      );
      for (const id of denied) {
        try {
          results.set(
            id,
            projectAccessCapabilities(
              {
                ...factsFor(id),
                historicalMaterials: historyByAccount.get(id) ?? [],
                binding: bindingByAccount.get(id) ?? null,
                last: receipts.get(id) ?? null,
              },
              now,
              resource,
            ).membership,
          );
        } catch (error) {
          results.set(
            id,
            dependencyFailure(
              {
                module: "account-rights",
                operation: "resolveForAccessAccounts",
              },
              error,
              { kind: "unavailable" as const },
            ),
          );
        }
      }
    }
    return new Map(
      requested.map((id) => [
        id,
        results.get(id.toLowerCase()) ?? { kind: "unavailable" as const },
      ]),
    );
  });
}
