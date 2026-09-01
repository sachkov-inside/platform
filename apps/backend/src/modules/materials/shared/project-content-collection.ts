import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../features/list-content-collections/list-content-collections.contract.js";

export async function loadContentCollectionDto(
  prisma: MaterialsPrisma,
  kind: ContentCollectionKind,
  id: string,
): Promise<ContentCollectionDto | undefined> {
  if (kind === "topic") {
    const [collection, materialCount] = await Promise.all([
      prisma.topic.findUnique({ where: { id } }),
      prisma.material.count({ where: { topicId: id } }),
    ]);
    return collection === null
      ? undefined
      : {
          archived: collection.archivedAt !== null,
          id: collection.id,
          kind,
          materialCount,
          name: collection.name,
          slug: collection.slug,
          summary: collection.summary,
          version: collection.version,
        };
  }
  const [collection, materialCount] = await Promise.all([
    prisma.series.findUnique({ where: { id } }),
    prisma.seriesMembership.count({ where: { seriesId: id } }),
  ]);
  return collection === null
    ? undefined
    : {
        archived: collection.archivedAt !== null,
        id: collection.id,
        kind,
        materialCount,
        name: collection.name,
        slug: collection.slug,
        summary: collection.summary,
        version: collection.version,
      };
}
