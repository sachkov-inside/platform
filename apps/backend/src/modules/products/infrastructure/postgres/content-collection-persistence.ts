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
  loadCovers: ProductAuthoringDependencies["loadCovers"],
): ContentCollectionPersistence {
  const project = async (
    record: ProductRecord | null,
  ): Promise<ContentCollectionDto | undefined> => {
    if (record === null) return undefined;
    const [materialCount, covers] = await Promise.all([
      prisma.productMembership.count({ where: { productId: record.id } }),
      loadCovers(
        record.coverId === null ? [] : [record.coverId],
        transactionHandle(prisma),
      ),
    ]);
    return toDto(
      kind,
      record,
      introductionOf(record),
      materialCount,
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
        0,
        null,
        sourceOf(record),
      );
    },
    list: async () => {
      const [records, counts] = await Promise.all([
        prisma.product.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        prisma.productMembership.groupBy({
          by: ["productId"],
          _count: { _all: true },
        }),
      ]);
      const countById = new Map(
        counts.map(({ productId, _count }) => [productId, _count._all]),
      );
      const covers = await loadCovers(
        records.flatMap(({ coverId }) => (coverId === null ? [] : [coverId])),
        transactionHandle(prisma),
      );
      return records.map((record) =>
        toDto(
          kind,
          record,
          introductionOf(record),
          countById.get(record.id) ?? 0,
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

function toDto(
  kind: ContentCollectionKind,
  record: ContentCollectionRecord,
  introduction: ProductIntroductionDto | null,
  materialCount: number,
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
    materialCount,
    name: record.name,
    slug: record.slug,
    summary: record.summary,
    version: record.version,
    cover,
  };
}
