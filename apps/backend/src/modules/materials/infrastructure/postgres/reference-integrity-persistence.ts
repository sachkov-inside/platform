import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";

export async function findReferenceIssues(
  transaction: MaterialsPrismaTransaction,
  metadata: MaterialRevisionMetadata,
): Promise<readonly { readonly code: string; readonly path: string }[]> {
  const issues: { code: string; path: string }[] = [];
  const topic = await transaction.topic.findUnique({
    where: { id: metadata.topicId },
    select: { id: true },
  });
  const format = await transaction.format.findUnique({
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
          select: { id: true },
        });

  if (topic === null) {
    issues.push({ code: "topic_not_found", path: "/metadata/topicId" });
  }
  if (format === null) {
    issues.push({ code: "format_not_found", path: "/metadata/formatId" });
  }
  const foundTags = new Set(tags.map(({ id }) => id));
  metadata.tagIds.forEach((tagId, index) => {
    if (!foundTags.has(tagId)) {
      issues.push({ code: "tag_not_found", path: `/metadata/tagIds/${index}` });
    }
  });
  const foundSeries = new Set(series.map(({ id }) => id));
  metadata.seriesMemberships.forEach(({ seriesId }, index) => {
    if (!foundSeries.has(seriesId)) {
      issues.push({
        code: "series_not_found",
        path: `/metadata/seriesMemberships/${index}/seriesId`,
      });
    }
  });
  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

export async function findSeriesOrdinalConflict(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialRevisionMetadata,
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
