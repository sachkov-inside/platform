import { loadCatalogueMemberships } from "../../infrastructure/postgres/catalogue-memberships.js";
import { z } from "zod";
import { type ProductsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";

export const MAX_PRODUCT_MATERIALS = 10_000;
const chapterSchema = z.object({
  supplementaryMaterialIds: z.array(z.uuid()).default([]),
  id: z.uuid(),
  name: z.string(),
  summary: z.string(),
  ordinal: z.number().int(),
});
const placementSchema = z.object({
  materialId: z.uuid(),
  sourceId: z.string().nullable(),
  chapterId: z.uuid().nullable(),
  ordinal: z.number().int(),
  published: z.boolean(),
  topicId: z.uuid().nullable(),
  hasModeVariants: z.boolean(),
});
const programmeSchema = z.object({
  id: z.uuid(),
  materialId: z.uuid(),
  chapterId: z.uuid().nullable(),
  ordinal: z.number().int(),
  stepGroup: z.string().nullable(),
  published: z.boolean(),
});
const compositionSchema = z.object({
  programmePlacements: z.array(programmeSchema),
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  archived: z.boolean(),
  audience: z.string(),
  outcome: z.string(),
  prerequisites: z.string(),
  scope: z.string(),
  presentation: z.string(),
  page: z.unknown(),
  coverId: z.uuid().nullable(),
  chapters: z.array(chapterSchema),
  placements: z.array(placementSchema),
});
export type ProductComposition = z.infer<typeof compositionSchema> & {
  readonly publishedProgramme: readonly z.infer<typeof programmeSchema>[];
  readonly materials: readonly z.infer<typeof placementSchema>[];
};

export interface ProductMaterialFacts {
  load(materialIds: readonly string[]): Promise<
    readonly {
      readonly id: string;
      readonly sourceId: string | null;
      readonly published: boolean;
      readonly topicId: string | null;
      readonly hasModeVariants: boolean;
    }[]
  >;
}

/** One owner snapshot preserves catalogue membership separately from repeated programme IDs. */
export class ProductCompositions {
  constructor(private readonly prisma: ProductsPrisma) {}

  async load(
    filter:
      | { readonly ids: readonly string[] }
      | { readonly slugs: readonly string[] }
      | { readonly current: true },
    limit: number,
    materialFacts: ProductMaterialFacts,
  ): Promise<readonly ProductComposition[]> {
    const products = await this.prisma.product.findMany({
      where:
        "ids" in filter
          ? { id: { in: [...filter.ids] } }
          : "slugs" in filter
            ? { slug: { in: [...filter.slugs] } }
            : { archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
    });
    const ids = products.map((product) => product.id);
    if (ids.length === 0) return [];
    const [memberships, chapters, programme, supplements] = await Promise.all([
      loadCatalogueMemberships(this.prisma, { productIds: ids }),
      this.prisma.productChapter.findMany({
        where: { productId: { in: ids } },
        orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      }),
      this.prisma.productProgrammePlacement.findMany({
        where: { productId: { in: ids } },
        orderBy: { ordinal: "asc" },
      }),
      this.prisma.productChapterSupplementaryMaterial.findMany({
        where: { productId: { in: ids } },
        orderBy: { ordinal: "asc" },
      }),
    ]);
    const facts = new Map(
      (
        await materialFacts.load([
          ...new Set(memberships.map((entry) => entry.materialId)),
        ])
      ).map((fact) => [fact.id, fact]),
    );
    return products.map((product) => {
      const productProgramme = programme
        .filter((entry) => entry.productId === product.id)
        .map((entry) => ({
          ...entry,
          published: facts.get(entry.materialId)?.published === true,
        }));
      const placements = memberships
        .filter((entry) => entry.seriesId === product.id)
        .sort((left, right) =>
          left.ordinal !== right.ordinal
            ? left.ordinal - right.ordinal
            : left.materialId.localeCompare(right.materialId),
        )
        .slice(0, MAX_PRODUCT_MATERIALS + 1)
        .map((entry) => ({
          materialId: entry.materialId,
          sourceId: facts.get(entry.materialId)?.sourceId ?? null,
          chapterId: entry.chapterId,
          ordinal: entry.ordinal,
          published: facts.get(entry.materialId)?.published === true,
          topicId: facts.get(entry.materialId)?.topicId ?? null,
          hasModeVariants:
            facts.get(entry.materialId)?.hasModeVariants ?? false,
        }));
      const row = compositionSchema.parse({
        ...product,
        archived: product.archivedAt !== null,
        programmePlacements: productProgramme,
        placements,
        chapters: chapters
          .filter((chapter) => chapter.productId === product.id)
          .map((chapter) => ({
            ...chapter,
            supplementaryMaterialIds: supplements
              .filter(
                (entry) =>
                  entry.chapterId === chapter.id &&
                  facts.get(entry.materialId)?.published === true,
              )
              .map((entry) => entry.materialId),
          })),
      });
      return {
        ...row,
        publishedProgramme: row.programmePlacements.filter(
          (entry) => entry.published,
        ),
        materials: row.placements.filter((entry) => entry.published),
      };
    });
  }
}

/** Current programmes include locked cards; an archive requires access to the whole Product. */
export async function readProductCompositionAccess(
  product: Pick<ProductComposition, "id" | "archived">,
  reader?: {
    readonly subject: Subject;
    readonly contentAccess: Pick<ContentAccess, "checkProductAccess">;
  },
): Promise<"open" | "closed" | "unavailable"> {
  if (!product.archived) return "open";
  if (reader === undefined || reader.subject.kind === "anonymous")
    return "closed";
  const access = await reader.contentAccess.checkProductAccess({
    subject: reader.subject,
    productId: product.id,
  });
  return access.kind;
}

export function productCompositionChapters(product: ProductComposition) {
  if (product.placements.length > MAX_PRODUCT_MATERIALS)
    throw new RangeError("Product composition exceeds its bound");
  return product.chapters.map((chapter) => ({
    ...chapter,
    materialIds: product.publishedProgramme
      .filter((material) => material.chapterId === chapter.id)
      .map((material) => material.materialId),
  }));
}

/** Resource authorization uses the same Product archive facts for body, Assets and Video. */
export async function loadMaterialProductAccessFacts(
  prisma: Pick<
    ProductsPrisma,
    "product" | "publishedMaterialProductMembership"
  >,
  materialIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    { readonly productIds: readonly string[]; readonly archivedOnly?: true }
  >
> {
  const memberships = await prisma.publishedMaterialProductMembership.findMany({
    where: { materialId: { in: [...materialIds] } },
    select: { materialId: true, seriesId: true },
  });
  const products = await prisma.product.findMany({
    where: {
      id: {
        in: [...new Set(memberships.map((membership) => membership.seriesId))],
      },
    },
    select: { id: true, archivedAt: true },
  });
  const archived = new Set(
    products
      .filter((product) => product.archivedAt !== null)
      .map((product) => product.id),
  );
  return new Map(
    materialIds.flatMap((id) => {
      const productIds = memberships
        .filter((membership) => membership.materialId === id)
        .map((membership) => membership.seriesId);
      if (productIds.length === 0) return [];
      return [
        [
          id,
          {
            productIds,
            ...(productIds.every((productId) => archived.has(productId))
              ? { archivedOnly: true as const }
              : {}),
          },
        ] as const,
      ];
    }),
  );
}
