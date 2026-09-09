import {
  Prisma,
  type MaterialsPrisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { GuideMembership } from "../../domain/material-metadata.js";
import type { GuideChapterEntry } from "../../shared/guide-order-version.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import { refreshPublishedMaterialSearchProjections } from "./published-material-search.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

export interface GuideChapterSnapshot {
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly summary: string;
}

export interface SeriesOrderSnapshot {
  readonly archived: boolean;
  readonly chapters: readonly GuideChapterSnapshot[];
  readonly items: readonly {
    readonly chapterId: string | null;
    readonly materialId: string;
    readonly ordinal: number;
    readonly stepGroup: string | null;
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
  const [series, memberships, chapters] = await Promise.all([
    prisma.guide.findUnique({
      where: { id: seriesId },
      select: { archivedAt: true, id: true, name: true },
    }),
    prisma.guideMembership.findMany({
      where: { seriesId },
      orderBy: [{ ordinal: "asc" }, { materialId: "asc" }],
      select: { chapterId: true, materialId: true, ordinal: true, stepGroup: true },
    }),
    prisma.guideChapter.findMany({
      where: { guideId: seriesId },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      select: { id: true, name: true, ordinal: true, summary: true },
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
    chapters,
    items: memberships.map(({ chapterId, materialId, ordinal, stepGroup }) => {
      const material = materialById.get(materialId);
      if (material === undefined) {
        throw new TypeError("Guide membership references a missing Material");
      }
      return {
        chapterId,
        materialId,
        ordinal,
        stepGroup,
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
): Promise<readonly GuideMembership[]> {
  const membershipSeriesIds = await transaction.guideMembership.findMany({
    where: { materialId },
    select: { seriesId: true },
  });
  await lockSeries(
    transaction,
    [...new Set([...selectedSeriesIds, ...membershipSeriesIds.map(({ seriesId }) => seriesId)])],
  );

  const currentMemberships = await transaction.guideMembership.findMany({
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
      : await transaction.guideMembership.groupBy({
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
  const memberships = await transaction.guideMembership.findMany({
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

export async function replaceGuideComposition(
  transaction: MaterialsPrismaTransaction,
  {
    chapterAssignments,
    chapters,
    guideId,
    orderedMaterialIds,
    stepGroups,
  }: {
    readonly chapterAssignments: Readonly<Record<string, string>>;
    readonly chapters: readonly GuideChapterEntry[];
    readonly guideId: string;
    readonly orderedMaterialIds: readonly string[];
    readonly stepGroups: Readonly<Record<string, string>>;
  },
): Promise<void> {
  const previousMemberships = await transaction.guideMembership.findMany({
    where: { seriesId: guideId },
    select: { materialId: true },
  });
  await transaction.guideMembership.deleteMany({ where: { seriesId: guideId } });
  await replaceGuideChapters(transaction, guideId, chapters);
  if (orderedMaterialIds.length > 0) {
    await transaction.guideMembership.createMany({
      data: orderedMaterialIds.map((materialId, index) => ({
        chapterId: chapterAssignments[materialId] ?? null,
        materialId,
        ordinal: index + 1,
        stepGroup: stepGroups[materialId] ?? null,
        seriesId: guideId,
      })),
    });
  }

  await transaction.publishedMaterialGuideMembership.deleteMany({
    where: { seriesId: guideId },
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
      ? [{ materialId, ordinal: index + 1, seriesId: guideId }]
      : [],
  );
  if (publishedMemberships.length > 0) {
    await transaction.publishedMaterialGuideMembership.createMany({
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

/**
 * Chapters keep their identity across renames and reordering, so kept rows are updated in place.
 * Removing a chapter detaches its Materials through the membership foreign key; it never deletes
 * a Material. The (guide_id, ordinal) constraint is deferred, so positions may swap inside the
 * transaction.
 */
async function replaceGuideChapters(
  transaction: MaterialsPrismaTransaction,
  guideId: string,
  chapters: readonly GuideChapterEntry[],
): Promise<void> {
  const existing = await transaction.guideChapter.findMany({
    where: { guideId },
    select: { id: true },
  });
  const kept = new Set(chapters.map(({ id }) => id));
  const removed = existing.flatMap(({ id }) => (kept.has(id) ? [] : [id]));
  if (removed.length > 0) {
    await transaction.guideChapter.deleteMany({ where: { guideId, id: { in: removed } } });
  }
  const known = new Set(existing.map(({ id }) => id));
  const updatedAt = new Date();
  for (const [index, { id, name, summary }] of chapters.entries()) {
    const ordinal = index + 1;
    if (known.has(id)) {
      await transaction.guideChapter.update({
        where: { id },
        data: { name, ordinal, summary, updatedAt },
      });
    } else {
      await transaction.guideChapter.create({
        data: { id, guideId, name, ordinal, summary },
      });
    }
  }
}
