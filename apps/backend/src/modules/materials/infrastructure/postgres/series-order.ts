import {
  Prisma,
  type MaterialsPrisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { SeriesMembership } from "../../domain/material-metadata.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import { refreshPublishedMaterialSearchProjections } from "./published-material-search.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

export interface SeriesOrderSnapshot {
  readonly archived: boolean;
  readonly items: readonly {
    readonly materialId: string;
    readonly ordinal: number;
    readonly publicationState: "draft" | "published" | "unpublished";
    readonly title: string | null;
  }[];
  readonly name: string;
  readonly seriesId: string;
}

export async function loadSeriesOrderSnapshot(
  prisma: MaterialsPrisma,
  seriesId: string,
): Promise<SeriesOrderSnapshot | undefined> {
  const [series, memberships] = await Promise.all([
    prisma.series.findUnique({
      where: { id: seriesId },
      select: { archivedAt: true, id: true, name: true },
    }),
    prisma.seriesMembership.findMany({
      where: { seriesId },
      orderBy: [{ ordinal: "asc" }, { materialId: "asc" }],
      select: { materialId: true, ordinal: true },
    }),
  ]);
  if (series === null) {
    return undefined;
  }
  const materials =
    memberships.length === 0
      ? []
      : await prisma.material.findMany({
          where: { id: { in: memberships.map(({ materialId }) => materialId) } },
          select: { id: true, publicationState: true, title: true },
        });
  const materialById = new Map(materials.map((material) => [material.id, material]));
  return {
    archived: series.archivedAt !== null,
    items: memberships.map(({ materialId, ordinal }) => {
      const material = materialById.get(materialId);
      if (material === undefined) {
        throw new TypeError("Series membership references a missing Material");
      }
      return {
        materialId,
        ordinal,
        publicationState: publicationStateSchema.parse(material.publicationState),
        title: material.title,
      };
    }),
    name: series.name,
    seriesId: series.id,
  };
}

export async function appendSelectedSeriesMemberships(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selectedSeriesIds: readonly string[],
): Promise<readonly SeriesMembership[]> {
  const membershipSeriesIds = await transaction.seriesMembership.findMany({
    where: { materialId },
    select: { seriesId: true },
  });
  await lockSeries(
    transaction,
    [...new Set([...selectedSeriesIds, ...membershipSeriesIds.map(({ seriesId }) => seriesId)])],
  );

  const currentMemberships = await transaction.seriesMembership.findMany({
    where: { materialId },
    select: { seriesId: true, ordinal: true },
  });
  const currentBySeries = new Map(
    currentMemberships.map((membership) => [membership.seriesId, membership]),
  );
  const newSeriesIds = selectedSeriesIds.filter(
    (seriesId) => !currentBySeries.has(seriesId),
  );
  const maxima =
    newSeriesIds.length === 0
      ? []
      : await transaction.seriesMembership.groupBy({
          by: ["seriesId"],
          where: { seriesId: { in: newSeriesIds } },
          _max: { ordinal: true },
        });
  const maximumBySeries = new Map(
    maxima.map(({ seriesId, _max }) => [seriesId, _max.ordinal ?? 0]),
  );

  return selectedSeriesIds.map((seriesId) => {
    const current = currentBySeries.get(seriesId);
    return (
      current ?? {
        seriesId,
        ordinal: (maximumBySeries.get(seriesId) ?? 0) + 1,
      }
    );
  });
}

export async function lockSeries(
  transaction: MaterialsPrismaTransaction,
  seriesIds: readonly string[],
): Promise<void> {
  if (seriesIds.length === 0) {
    return;
  }
  await transaction.$queryRaw(
    Prisma.sql`
      select id
      from materials.series
      where id in (${Prisma.join([...seriesIds].sort())})
      order by id
      for update
    `,
  );
}

export async function lockMaterialSeries(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selectedSeriesIds: readonly string[] = [],
): Promise<void> {
  const memberships = await transaction.seriesMembership.findMany({
    where: { materialId },
    select: { seriesId: true },
  });
  await lockSeries(
    transaction,
    [
      ...new Set([
        ...selectedSeriesIds,
        ...memberships.map(({ seriesId }) => seriesId),
      ]),
    ],
  );
}

export async function replaceSeriesOrder(
  transaction: MaterialsPrismaTransaction,
  seriesId: string,
  orderedMaterialIds: readonly string[],
): Promise<void> {
  const previousMemberships = await transaction.seriesMembership.findMany({
    where: { seriesId },
    select: { materialId: true },
  });
  await transaction.seriesMembership.deleteMany({ where: { seriesId } });
  if (orderedMaterialIds.length > 0) {
    await transaction.seriesMembership.createMany({
      data: orderedMaterialIds.map((materialId, index) => ({
        materialId,
        ordinal: index + 1,
        seriesId,
      })),
    });
  }

  await transaction.publishedMaterialSeriesMembership.deleteMany({
    where: { seriesId },
  });
  const published =
    orderedMaterialIds.length === 0
      ? []
      : await transaction.material.findMany({
          where: {
            id: { in: [...orderedMaterialIds] },
            publicationState: "published",
          },
          select: { id: true },
        });
  const publishedIds = new Set(published.map(({ id }) => id));
  const publishedMemberships = orderedMaterialIds.flatMap((materialId, index) =>
    publishedIds.has(materialId)
      ? [{ materialId, ordinal: index + 1, seriesId }]
      : [],
  );
  if (publishedMemberships.length > 0) {
    await transaction.publishedMaterialSeriesMembership.createMany({
      data: publishedMemberships,
    });
  }
  await refreshPublishedMaterialSearchProjections(transaction, {
    kind: "materials",
    materialIds: [
      ...new Set([
        ...previousMemberships.map(({ materialId }) => materialId),
        ...orderedMaterialIds,
      ]),
    ],
  });
}
