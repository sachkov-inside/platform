import type { ProductsPrisma } from "../../../../infrastructure/prisma/index.js";

/** Compatibility projections derive placement facts from the programme, never from catalogue state. */
export async function loadCatalogueMemberships(
  prisma: ProductsPrisma,
  filter?: {
    readonly materialId?: string;
    readonly productIds?: readonly string[];
  },
) {
  const memberships = await prisma.productMembership.findMany({
    where: {
      ...(filter?.materialId === undefined
        ? {}
        : { materialId: filter.materialId }),
      ...(filter?.productIds === undefined
        ? {}
        : { productId: { in: [...filter.productIds] } }),
    },
    orderBy: [{ productId: "asc" }, { materialId: "asc" }],
  });
  const productIds = [...new Set(memberships.map((entry) => entry.productId))];
  const catalogue =
    filter?.materialId === undefined
      ? memberships
      : await prisma.productMembership.findMany({
          where: { productId: { in: productIds } },
          orderBy: { materialId: "asc" },
        });
  const programme = await prisma.productProgrammePlacement.findMany({
    where: { productId: { in: productIds } },
    orderBy: { ordinal: "asc" },
  });
  const key = (productId: string, materialId: string) =>
    `${productId}/${materialId}`;
  const primaryByPair = new Map<string, (typeof programme)[number]>();
  const maximumByProduct = new Map<string, number>();
  for (const placement of programme) {
    const pair = key(placement.productId, placement.materialId);
    if (!primaryByPair.has(pair)) primaryByPair.set(pair, placement);
    maximumByProduct.set(
      placement.productId,
      Math.max(
        maximumByProduct.get(placement.productId) ?? 0,
        placement.ordinal,
      ),
    );
  }
  const extraCountByProduct = new Map<string, number>();
  const extraOrdinalByPair = new Map<string, number>();
  for (const membership of catalogue) {
    const pair = key(membership.productId, membership.materialId);
    if (primaryByPair.has(pair)) continue;
    const count = (extraCountByProduct.get(membership.productId) ?? 0) + 1;
    extraCountByProduct.set(membership.productId, count);
    extraOrdinalByPair.set(
      pair,
      (maximumByProduct.get(membership.productId) ?? 0) + count,
    );
  }
  return memberships.map((membership) => {
    const pair = key(membership.productId, membership.materialId);
    const primary = primaryByPair.get(pair);
    return {
      ...membership,
      ordinal: primary?.ordinal ?? extraOrdinalByPair.get(pair) ?? 1,
      chapterId: primary?.chapterId ?? null,
      stepGroup: primary?.stepGroup ?? null,
    };
  });
}
