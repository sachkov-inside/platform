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
        : { seriesId: { in: [...filter.productIds] } }),
    },
    orderBy: [{ seriesId: "asc" }, { materialId: "asc" }],
  });
  const programme = await prisma.productProgrammePlacement.findMany({
    where: {
      productId: {
        in: [...new Set(memberships.map((entry) => entry.seriesId))],
      },
    },
    orderBy: { ordinal: "asc" },
  });
  return memberships.map((entry) => {
    const primary = programme.find(
      (placement) =>
        placement.productId === entry.seriesId &&
        placement.materialId === entry.materialId,
    );
    const productProgramme = programme.filter(
      (placement) => placement.productId === entry.seriesId,
    );
    const catalogue = memberships.filter(
      (membership) => membership.seriesId === entry.seriesId,
    );
    const extra = catalogue.filter(
      (membership) =>
        !productProgramme.some(
          (placement) => placement.materialId === membership.materialId,
        ),
    );
    return {
      ...entry,
      ordinal:
        primary?.ordinal ??
        Math.max(0, ...productProgramme.map((placement) => placement.ordinal)) +
          extra.findIndex(
            (membership) => membership.materialId === entry.materialId,
          ) +
          1,
      chapterId: primary?.chapterId ?? null,
      stepGroup: primary?.stepGroup ?? null,
    };
  });
}
