import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/material-authoring/content-collection.contract.js";

interface ContentCollectionRecord {
  readonly archivedAt: Date | null;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly version: number;
}

interface ContentCollectionPersistence {
  readonly create: (data: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
  }) => Promise<ContentCollectionDto>;
  readonly list: () => Promise<readonly ContentCollectionDto[]>;
  readonly load: (id: string) => Promise<ContentCollectionDto | undefined>;
  readonly setArchive: (input: {
    readonly archived: boolean;
    readonly expectedVersion: number;
    readonly id: string;
  }) => Promise<number>;
  readonly slugConstraint: string;
  readonly updateMetadata: (input: {
    readonly expectedVersion: number;
    readonly id: string;
    readonly name: string;
    readonly summary: string;
  }) => Promise<number>;
}

export function contentCollectionPersistence(
  prisma: MaterialsPrisma,
  kind: ContentCollectionKind,
): ContentCollectionPersistence {
  return kind === "topic"
    ? topicPersistence(prisma)
    : seriesPersistence(prisma);
}

function topicPersistence(prisma: MaterialsPrisma): ContentCollectionPersistence {
  const project = async (
    record: ContentCollectionRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    return toDto("topic", record, await prisma.material.count({
      where: { topicId: record.id },
    }));
  };
  return {
    create: async (data) => {
      const record = await prisma.topic.create({ data });
      return toDto("topic", record, 0);
    },
    list: async () => {
      const [records, counts] = await Promise.all([
        prisma.topic.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        prisma.material.groupBy({
          by: ["topicId"],
          where: { topicId: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const countById = new Map(
        counts.flatMap(({ topicId, _count }) =>
          topicId === null ? [] : [[topicId, _count._all] as const],
        ),
      );
      return records.map((record) =>
        toDto("topic", record, countById.get(record.id) ?? 0),
      );
    },
    load: async (id) =>
      project(await prisma.topic.findUnique({ where: { id } })),
    setArchive: async ({ archived, expectedVersion, id }) =>
      (
        await prisma.topic.updateMany({
          where: { id, version: expectedVersion },
          data: {
            archivedAt: archived ? new Date() : null,
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
    slugConstraint: "topics_slug_unique",
    updateMetadata: async ({ expectedVersion, id, name, summary }) =>
      (
        await prisma.topic.updateMany({
          where: { id, version: expectedVersion },
          data: {
            name,
            summary,
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
  };
}

function seriesPersistence(prisma: MaterialsPrisma): ContentCollectionPersistence {
  const project = async (
    record: ContentCollectionRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    return toDto("series", record, await prisma.seriesMembership.count({
      where: { seriesId: record.id },
    }));
  };
  return {
    create: async (data) => {
      const record = await prisma.series.create({ data });
      return toDto("series", record, 0);
    },
    list: async () => {
      const [records, counts] = await Promise.all([
        prisma.series.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        prisma.seriesMembership.groupBy({
          by: ["seriesId"],
          _count: { _all: true },
        }),
      ]);
      const countById = new Map(
        counts.map(({ seriesId, _count }) => [seriesId, _count._all]),
      );
      return records.map((record) =>
        toDto("series", record, countById.get(record.id) ?? 0),
      );
    },
    load: async (id) =>
      project(await prisma.series.findUnique({ where: { id } })),
    setArchive: async ({ archived, expectedVersion, id }) =>
      (
        await prisma.series.updateMany({
          where: { id, version: expectedVersion },
          data: {
            archivedAt: archived ? new Date() : null,
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
    slugConstraint: "series_slug_unique",
    updateMetadata: async ({ expectedVersion, id, name, summary }) =>
      (
        await prisma.series.updateMany({
          where: { id, version: expectedVersion },
          data: {
            name,
            summary,
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
  };
}

function toDto(
  kind: ContentCollectionKind,
  record: ContentCollectionRecord,
  materialCount: number,
): ContentCollectionDto {
  return {
    archived: record.archivedAt !== null,
    id: record.id,
    kind,
    materialCount,
    name: record.name,
    slug: record.slug,
    summary: record.summary,
    version: record.version,
  };
}
