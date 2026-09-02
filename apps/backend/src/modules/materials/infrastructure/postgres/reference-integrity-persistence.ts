import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import type { MaterialMetadata } from "../../domain/material-metadata.js";

export async function findReferenceIssues(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
): Promise<readonly { readonly code: string; readonly path: string }[]> {
  const issues: { code: string; path: string }[] = [];
  const currentMaterial = await transaction.material.findUnique({
    where: { id: materialId },
    select: { topicId: true },
  });
  const currentSeriesMemberships = await transaction.seriesMembership.findMany({
    where: { materialId },
    select: { seriesId: true },
  });
  const currentSeriesIds = new Set(
    currentSeriesMemberships.map(({ seriesId }) => seriesId),
  );
  const topic =
    metadata.topicId === null
      ? null
      : await transaction.topic.findUnique({
          where: { id: metadata.topicId },
          select: { archivedAt: true, id: true },
        });
  const format =
    metadata.formatId === null
      ? null
      : await transaction.format.findUnique({
          where: { id: metadata.formatId },
          select: { id: true },
        });
  const tags =
    metadata.tagIds.length === 0
      ? []
      : await transaction.tag.findMany({
          where: { id: { in: [...metadata.tagIds] } },
          select: { id: true },
        });
  const series =
    metadata.seriesMemberships.length === 0
      ? []
      : await transaction.series.findMany({
          where: {
            id: {
              in: metadata.seriesMemberships.map(({ seriesId }) => seriesId),
            },
          },
          select: { archivedAt: true, id: true },
        });

  if (metadata.topicId !== null && topic === null) {
    issues.push({ code: "topic_not_found", path: "/metadata/topicId" });
  } else if (
    metadata.topicId !== null &&
    topic?.archivedAt !== null &&
    currentMaterial?.topicId !== metadata.topicId
  ) {
    issues.push({ code: "topic_archived", path: "/metadata/topicId" });
  }
  if (metadata.formatId !== null && format === null) {
    issues.push({ code: "format_not_found", path: "/metadata/formatId" });
  }
  const foundTags = new Set(tags.map(({ id }) => id));
  metadata.tagIds.forEach((tagId, index) => {
    if (!foundTags.has(tagId)) {
      issues.push({ code: "tag_not_found", path: `/metadata/tagIds/${index}` });
    }
  });
  const foundSeries = new Set(series.map(({ id }) => id));
  const archivedSeries = new Set(
    series.flatMap(({ archivedAt, id }) =>
      archivedAt === null ? [] : [id],
    ),
  );
  metadata.seriesMemberships.forEach(({ seriesId }, index) => {
    if (!foundSeries.has(seriesId)) {
      issues.push({
        code: "series_not_found",
        path: `/metadata/seriesMemberships/${index}/seriesId`,
      });
    } else if (
      archivedSeries.has(seriesId) &&
      !currentSeriesIds.has(seriesId)
    ) {
      issues.push({
        code: "series_archived",
        path: `/metadata/seriesMemberships/${index}/seriesId`,
      });
    }
  });
  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

export async function findSeriesOrdinalConflict(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
): Promise<{ readonly seriesId: string; readonly ordinal: number } | undefined> {
  if (metadata.seriesMemberships.length === 0) {
    return undefined;
  }
  const seriesIds = metadata.seriesMemberships.map(({ seriesId }) => seriesId);
  await transaction.$queryRaw(
    Prisma.sql`
      select id
      from materials.series
      where id in (${Prisma.join(seriesIds)})
      order by id
      for update
    `,
  );

  const occupied = await transaction.seriesMembership.findMany({
    where: {
      seriesId: { in: seriesIds },
      ordinal: {
        in: metadata.seriesMemberships.map(({ ordinal }) => ordinal),
      },
      materialId: { not: materialId },
    },
    select: { seriesId: true, ordinal: true },
  });
  const occupiedKeys = new Set(
    occupied.map(({ seriesId, ordinal }) => `${seriesId}:${ordinal}`),
  );
  return metadata.seriesMemberships.find(({ seriesId, ordinal }) =>
    occupiedKeys.has(`${seriesId}:${ordinal}`),
  );
}
