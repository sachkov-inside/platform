import { z } from "zod";

import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type {
  ProductPage,
  ProductSourceFields,
} from "../../domain/product-page.js";
import { readProductPageState } from "../../shared/product-page-reader.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
  ProductIntroductionDto,
} from "../../facets/material-authoring/content-collection.contract.js";
import type { ContentCoverProjection } from "../../facets/content-covers/content-covers.js";
import { loadContentCoverProjections } from "./content-cover-projections.js";

interface ContentCollectionRecord {
  readonly archivedAt: Date | null;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly version: number;
  readonly coverId: string | null;
}

type ProductRecord = ContentCollectionRecord &
  ProductIntroductionDto & {
    readonly page: unknown;
    readonly presentation: string;
    readonly sourceId: string | null;
  };

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
    readonly introduction: ProductIntroductionDto | null;
    readonly name: string;
    /** Только для перенесённого Product; отсутствие сохраняет текущие значения. */
    readonly source?: ProductSourceFields | undefined;
    readonly summary: string;
  }) => Promise<number>;
}

export function contentCollectionPersistence(
  prisma: MaterialsPrisma,
  kind: ContentCollectionKind,
): ContentCollectionPersistence {
  return kind === "topic"
    ? topicPersistence(prisma)
    : productPersistence(prisma, kind);
}

function topicPersistence(
  prisma: MaterialsPrisma,
): ContentCollectionPersistence {
  const project = async (
    record: ContentCollectionRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    const [counts, covers] = await Promise.all([
      topicMaterialCounts(prisma, record.id),
      loadContentCoverProjections(
        prisma,
        record.coverId === null ? [] : [record.coverId],
      ),
    ]);
    return toDto(
      "topic",
      record,
      null,
      counts.get(record.id) ?? noMaterials,
      record.coverId === null ? null : (covers.get(record.coverId) ?? null),
      null,
    );
  };
  return {
    create: async (data) => {
      const record = await prisma.topic.create({ data });
      return toDto("topic", record, null, noMaterials, null, null);
    },
    list: async () => {
      const [records, countById] = await Promise.all([
        prisma.topic.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        topicMaterialCounts(prisma),
      ]);
      const covers = await loadContentCoverProjections(
        prisma,
        records.flatMap(({ coverId }) => (coverId === null ? [] : [coverId])),
      );
      return records.map((record) =>
        toDto(
          "topic",
          record,
          null,
          countById.get(record.id) ?? noMaterials,
          record.coverId === null ? null : (covers.get(record.coverId) ?? null),
          null,
        ),
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

function productPersistence(
  prisma: MaterialsPrisma,
  kind: "product" | "series",
): ContentCollectionPersistence {
  const project = async (
    record: ProductRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    const [counts, covers] = await Promise.all([
      productMaterialCounts(prisma, record.id),
      loadContentCoverProjections(
        prisma,
        record.coverId === null ? [] : [record.coverId],
      ),
    ]);
    return toDto(
      kind,
      record,
      introductionOf(record),
      counts.get(record.id) ?? noMaterials,
      record.coverId === null ? null : (covers.get(record.coverId) ?? null),
      sourceOf(record),
    );
  };
  return {
    create: async (data) => {
      const record = await prisma.product.create({ data });
      return toDto(
        kind,
        record,
        introductionOf(record),
        noMaterials,
        null,
        sourceOf(record),
      );
    },
    list: async () => {
      const [records, countById] = await Promise.all([
        prisma.product.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        productMaterialCounts(prisma),
      ]);
      const covers = await loadContentCoverProjections(
        prisma,
        records.flatMap(({ coverId }) => (coverId === null ? [] : [coverId])),
      );
      return records.map((record) =>
        toDto(
          kind,
          record,
          introductionOf(record),
          countById.get(record.id) ?? noMaterials,
          record.coverId === null ? null : (covers.get(record.coverId) ?? null),
          sourceOf(record),
        ),
      );
    },
    load: async (id) =>
      project(await prisma.product.findUnique({ where: { id } })),
    setArchive: async ({ archived, expectedVersion, id }) =>
      (
        await prisma.product.updateMany({
          where: { id, version: expectedVersion },
          data: {
            archivedAt: archived ? new Date() : null,
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
    slugConstraint: "series_slug_unique",
    updateMetadata: async ({
      expectedVersion,
      id,
      introduction,
      name,
      source,
      summary,
    }) =>
      (
        await prisma.product.updateMany({
          where: { id, version: expectedVersion },
          data: {
            name,
            summary,
            ...(introduction ?? {}),
            ...(source === undefined
              ? {}
              : {
                  slug: source.slug,
                  presentation: source.presentation,
                  page: source.page ?? Prisma.DbNull,
                }),
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      ).count,
  };
}

function introductionOf(
  record: ProductIntroductionDto,
): ProductIntroductionDto {
  return {
    audience: record.audience,
    outcome: record.outcome,
    prerequisites: record.prerequisites,
    scope: record.scope,
  };
}

function sourceOf(record: ProductRecord): CollectionSource {
  const stored = readProductPageState(record.page, `Product ${record.slug}`);
  return {
    page: stored.page,
    pageRejected: stored.rejected,
    presentation: record.presentation,
    sourceId: record.sourceId,
  };
}

interface CollectionSource {
  readonly page: ProductPage | null;
  readonly pageRejected: boolean;
  readonly presentation: string;
  readonly sourceId: string | null;
}

/** How many Materials a collection holds, and how many of them are published now. */
interface MaterialCounts {
  readonly materialCount: number;
  readonly publishedMaterialCount: number;
}

const noMaterials: MaterialCounts = {
  materialCount: 0,
  publishedMaterialCount: 0,
};

/**
 * Material counts of every Topic, or of one, in one grouped statement: all Materials of the Topic
 * and those whose publication state is `published`.
 */
async function topicMaterialCounts(
  prisma: MaterialsPrisma,
  topicId?: string,
): Promise<ReadonlyMap<string, MaterialCounts>> {
  const groups = await prisma.material.groupBy({
    by: ["topicId", "publicationState"],
    where: { topicId: topicId ?? { not: null } },
    _count: { _all: true },
  });
  const counts = new Map<string, MaterialCounts>();
  for (const { topicId: id, publicationState, _count } of groups) {
    if (id === null) continue;
    const current = counts.get(id) ?? noMaterials;
    counts.set(id, {
      materialCount: current.materialCount + _count._all,
      publishedMaterialCount:
        current.publishedMaterialCount +
        (publicationState === "published" ? _count._all : 0),
    });
  }
  return counts;
}

const productMaterialCountRowsSchema = z.array(
  z
    .object({
      productId: z.uuid(),
      materialCount: z.number().int().nonnegative(),
      publishedMaterialCount: z.number().int().nonnegative(),
    })
    .strict(),
);

/**
 * Material counts of every Product, or of one, in one statement: all programme memberships and
 * those whose Material is published now.
 */
async function productMaterialCounts(
  prisma: MaterialsPrisma,
  productId?: string,
): Promise<ReadonlyMap<string, MaterialCounts>> {
  const rows = productMaterialCountRowsSchema.parse(
    await prisma.$queryRaw(Prisma.sql`
      select
        membership.series_id::text as "productId",
        count(*)::int as "materialCount",
        (count(*) filter (
          where material.publication_state = 'published'
        ))::int as "publishedMaterialCount"
      from materials.series_memberships membership
      left join materials.materials material
        on material.id = membership.material_id
      ${
        productId === undefined
          ? Prisma.empty
          : Prisma.sql`where membership.series_id = ${productId}::uuid`
      }
      group by membership.series_id
    `),
  );
  return new Map(
    rows.map((row) => [
      row.productId,
      {
        materialCount: row.materialCount,
        publishedMaterialCount: row.publishedMaterialCount,
      },
    ]),
  );
}

function toDto(
  kind: ContentCollectionKind,
  record: ContentCollectionRecord,
  introduction: ProductIntroductionDto | null,
  counts: MaterialCounts,
  cover: ContentCoverProjection | null,
  source: CollectionSource | null,
): ContentCollectionDto {
  return {
    page: source?.page ?? null,
    pageRejected: source?.pageRejected ?? false,
    presentation: source?.presentation ?? null,
    sourceId: source?.sourceId ?? null,
    archived: record.archivedAt !== null,
    id: record.id,
    introduction,
    kind,
    materialCount: counts.materialCount,
    publishedMaterialCount: counts.publishedMaterialCount,
    name: record.name,
    slug: record.slug,
    summary: record.summary,
    version: record.version,
    cover,
  };
}
