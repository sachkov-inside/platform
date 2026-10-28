import {
  Prisma,
  type ProductsPrisma,
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
} from "../../facets/product-authoring/content-collection.contract.js";
type ContentCoverProjection = {
  readonly coverId: string;
  readonly renditions: readonly {
    readonly width: number;
    readonly height: number;
  }[];
};
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";

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
  prisma: ProductsPrisma,
  kind: "product" | "topic",
  dependencies: Pick<ProductAuthoringDependencies, "loadCovers" | "materials">,
): ContentCollectionPersistence {
  const { loadCovers, materials } = dependencies;
  const project = async (
    record: ProductRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    const [counts, covers] = await Promise.all([
      productMaterialCounts(prisma, materials, record.id),
      loadCovers(
        record.coverId === null ? [] : [record.coverId],
        transactionHandle(prisma),
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
        productMaterialCounts(prisma, materials),
      ]);
      const covers = await loadCovers(
        records.flatMap(({ coverId }) => (coverId === null ? [] : [coverId])),
        transactionHandle(prisma),
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
    slugConstraint: "product_slug_unique",
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

/** How many Materials a Product holds, and how many of them are published now. */
interface MaterialCounts {
  readonly materialCount: number;
  readonly publishedMaterialCount: number;
}

const noMaterials: MaterialCounts = {
  materialCount: 0,
  publishedMaterialCount: 0,
};

/**
 * Material counts of every Product, or of one: all programme memberships and those whose
 * Material is published now. Publication state belongs to Materials, so it is read through the
 * `ProductMaterials` port in the same transaction.
 */
async function productMaterialCounts(
  prisma: ProductsPrisma,
  materials: ProductAuthoringDependencies["materials"],
  productId?: string,
): Promise<ReadonlyMap<string, MaterialCounts>> {
  const memberships = await prisma.productMembership.findMany({
    ...(productId === undefined ? {} : { where: { productId } }),
    select: { productId: true, materialId: true },
  });
  const materialIds = [
    ...new Set(memberships.map(({ materialId }) => materialId)),
  ];
  const published = new Set(
    materialIds.length === 0
      ? []
      : (await materials.load(materialIds, transactionHandle(prisma)))
          .filter(({ publicationState }) => publicationState === "published")
          .map(({ id }) => id),
  );
  const counts = new Map<string, MaterialCounts>();
  for (const { productId: id, materialId } of memberships) {
    const current = counts.get(id) ?? noMaterials;
    counts.set(id, {
      materialCount: current.materialCount + 1,
      publishedMaterialCount:
        current.publishedMaterialCount + (published.has(materialId) ? 1 : 0),
    });
  }
  return counts;
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
