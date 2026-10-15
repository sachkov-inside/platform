import { z } from "zod";
import {
  coverageSchema,
  productCapability,
  tariffCoverage,
  scopeIncludesProduct,
} from "@inside/access-capabilities";
import { accountId } from "../../../accounts/index.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import {
  accessFailure,
  type AccessFailure,
} from "../../domain/access-grant.js";
import {
  readAccessCapabilityFacts,
  projectAccessCapabilities,
} from "../resolve-access-capabilities/resolve-access-capabilities.js";

const availabilitySchema = z.strictObject({
  state: z.enum(["available", "expired", "revoked", "unavailable"]),
});
export const ownProductSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().nullable(),
  name: z.string(),
  materials: availabilitySchema,
  community: availabilitySchema,
});
type OwnProduct = z.infer<typeof ownProductSchema>;
type Availability = OwnProduct["materials"]["state"];

/** Retained Product metadata and current rights share the existing capability decision. */
export async function readOwnProducts(
  prisma: AccountRightsPrismaClient,
  targetAccountId: string,
  now: Date,
  catalog: CoverageCatalog | undefined,
): Promise<
  | AccessFailure<"invalid_input" | "unavailable">
  | { ok: true; value: OwnProduct[] }
> {
  if (!z.uuid().safeParse(targetAccountId).success)
    return accessFailure("invalid_input");
  const snapshot = await prisma.$transaction(async (transaction) => {
    await setAccessSnapshotIsolation(transaction);
    const history = await transaction.accessGrant.findMany({
      where: { accountId: targetAccountId },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 1001,
    });
    if (history.length > 1000) return null;
    const facts = await readAccessCapabilityFacts(
      transaction,
      accountId(targetAccountId),
      now,
      undefined,
      { includeRevision: false, maximumExclusions: 1000 },
    );
    return { history: history.filter((grant) => grant.startsAt <= now), facts };
  });
  if (snapshot === null) return accessFailure("unavailable");
  const { history, facts } = snapshot;
  const empty = { productIds: [], materialIds: [] };
  const scopes = history.map((grant) =>
    tariffCoverage(
      grant.capabilities,
      coverageSchema.parse(grant.coverage ?? empty),
    ),
  );
  if (facts.classification?.bridgeCoverage != null)
    scopes.push(coverageSchema.parse(facts.classification.bridgeCoverage));
  if (scopes.length === 0) return { ok: true, value: [] };
  if (catalog === undefined) return accessFailure("unavailable");
  const productIds = [...new Set(scopes.flatMap((scope) => scope.productIds))];
  if (productIds.length > 1000) return accessFailure("unavailable");
  // Explicit references retain archived Products even beside a whole-platform grant.
  const periods = history.flatMap((grant, index) =>
    scopes[index]?.wholePlatform === true
      ? [
          {
            startsAt: grant.startsAt,
            endsAt: new Date(
              Math.min(
                now.getTime(),
                grant.revokedAt?.getTime() ?? Infinity,
                grant.validUntil?.getTime() ?? Infinity,
              ),
            ),
          },
        ]
      : [],
  );
  if (
    facts.classification?.bridgeCoverage != null &&
    coverageSchema.parse(facts.classification.bridgeCoverage).wholePlatform ===
      true
  )
    periods.push({ startsAt: facts.classification.verifiedAt, endsAt: now });
  if (periods.length > 0 && catalog.resolveWholePlatformProducts === undefined)
    return accessFailure("unavailable");
  const entries = await catalog.resolveMany([{ productIds, materialIds: [] }]);
  const historical =
    periods.length === 0
      ? []
      : ((await catalog.resolveWholePlatformProducts?.(periods)) ?? []);
  const products = new Map(
    [...entries.flat(), ...historical]
      .filter((entry) => entry.kind === "product")
      .map((entry) => [entry.id, entry]),
  );
  if (products.size > 1000) return accessFailure("unavailable");
  return {
    ok: true,
    value: [...products.values()]
      .sort((a, b) => {
        const titleOrder = a.title.localeCompare(b.title);
        return titleOrder === 0 ? a.id.localeCompare(b.id) : titleOrder;
      })
      .map((product) => {
        const current = projectAccessCapabilities(facts, now, {
          productIds: [product.id],
        });
        const has = (capability: string) =>
          current.capabilities.some((entry) => entry.capability === capability);
        function state(capability: "materials" | "community"): Availability {
          if (!product.available) return "unavailable";
          if (
            has(capability) ||
            (capability === "materials" && has(productCapability(product.id)))
          )
            return "available";
          const bridge = facts.classification;
          const bridgeCovers =
            bridge?.bridgeBenefits.includes(capability) === true &&
            scopeIncludesProduct(
              coverageSchema.parse(bridge.bridgeCoverage ?? empty),
              product.id,
            );
          if (
            bridgeCovers &&
            facts.exclusions.some(
              (entry) => entry.productId === product.id && entry.bridge,
            )
          )
            return "revoked";
          if (
            bridgeCovers &&
            bridge.bridgeEnabled &&
            facts.projection?.decision === "not_member"
          )
            return "expired";
          if (
            bridge?.bridgeEnabled === true &&
            bridgeCovers &&
            (facts.projection === null ||
              facts.projection.decision === "unavailable" ||
              (facts.projection.decision === "member" &&
                facts.projection.validUntil <= now))
          )
            return "unavailable";
          const previous = history.filter(
            (grant, index) =>
              (grant.capabilities.includes(capability) ||
                (capability === "materials" &&
                  grant.capabilities.includes(
                    productCapability(product.id),
                  ))) &&
              (scopeIncludesProduct(scopes[index] ?? empty, product.id) ||
                (capability === "community" && grant.coverage === null)),
          );
          if (
            previous.some((grant) =>
              facts.exclusions.some(
                (entry) =>
                  entry.productId === product.id &&
                  entry.grantIds.includes(grant.id),
              ),
            )
          )
            return "revoked";
          const ended = previous
            .flatMap<{ at: number; state: "revoked" | "expired" }>((grant) =>
              grant.revokedAt !== null
                ? [{ at: grant.revokedAt.getTime(), state: "revoked" as const }]
                : grant.validUntil !== null && grant.validUntil <= now
                  ? [
                      {
                        at: grant.validUntil.getTime(),
                        state: "expired" as const,
                      },
                    ]
                  : [],
            )
            .sort((a, b) => b.at - a.at);
          return ended[0]?.state ?? "unavailable";
        }
        return ownProductSchema.parse({
          id: product.id,
          slug: product.slug,
          name: product.title,
          materials: { state: state("materials") },
          community: { state: state("community") },
        });
      }),
  };
}
