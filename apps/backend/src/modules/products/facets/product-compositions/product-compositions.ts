import { z } from "zod";
import {
  Prisma,
  type ProductsPrisma,
} from "../../../../infrastructure/prisma/index.js";
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

const MAX_PRODUCT_CHAPTERS = 200;
const MAX_PRODUCT_PROGRAMME_PLACEMENTS = 20_000;
const MAX_CHAPTER_ATTACHMENTS = 200;
const snapshotSchema = compositionSchema
  .omit({ placements: true, programmePlacements: true })
  .extend({
    catalogue: z.array(z.uuid()),
    programmePlacements: z.array(programmeSchema.omit({ published: true })),
  });

/** A complete Product cannot be represented by a silently truncated catalogue or programme. */
export class ProductCompositionLimitError extends RangeError {
  constructor() {
    super("Product composition exceeds its bound");
    this.name = "ProductCompositionLimitError";
  }
}

/** One statement owns metadata and every bounded structural prerequisite before Material enrichment. */
export class ProductCompositions {
  constructor(private readonly prisma: Pick<ProductsPrisma, "$queryRaw">) {}

  async load(
    filter:
      | { readonly ids: readonly string[] }
      | { readonly slugs: readonly string[] }
      | { readonly current: true },
    limit: number,
    materialFacts: ProductMaterialFacts,
  ): Promise<readonly ProductComposition[]> {
    const condition =
      "ids" in filter
        ? Prisma.sql`product.id=any(${[...filter.ids]}::uuid[])`
        : "slugs" in filter
          ? Prisma.sql`product.slug=any(${[...filter.slugs]}::text[])`
          : Prisma.sql`product.archived_at is null`;
    // PostgreSQL assigns one MVCC snapshot to this statement, including every correlated subquery.
    // No transaction remains open when standalone enrichment consults the Material owner.
    const products = snapshotSchema.array().parse(
      await this.prisma.$queryRaw(Prisma.sql`
      select product.id,product.slug,product.name,product.summary,
        product.archived_at is not null as archived,
        product.audience,product.outcome,product.prerequisites,product.scope,
        product.presentation,product.page,product.cover_id as "coverId",
        coalesce((select jsonb_agg(member.material_id order by member.material_id) from (
          select material_id from products.product_memberships where product_id=product.id
          order by material_id limit ${MAX_PRODUCT_MATERIALS + 1}
        ) member),'[]'::jsonb) as catalogue,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id',placement.id,'materialId',placement.material_id,'chapterId',placement.chapter_id,
          'ordinal',placement.ordinal,'stepGroup',placement.step_group
        ) order by placement.ordinal) from (
          select id,material_id,chapter_id,ordinal,step_group from products.product_programme_placements
          where product_id=product.id order by ordinal limit ${MAX_PRODUCT_PROGRAMME_PLACEMENTS + 1}
        ) placement),'[]'::jsonb) as "programmePlacements",
        coalesce((select jsonb_agg(jsonb_build_object(
          'id',chapter.id,'name',chapter.name,'summary',chapter.summary,'ordinal',chapter.ordinal,
          'supplementaryMaterialIds',coalesce((select jsonb_agg(attachment.material_id order by attachment.ordinal) from (
            select material_id,ordinal from products.product_chapter_supplementary_materials
            where chapter_id=chapter.id order by ordinal limit ${MAX_CHAPTER_ATTACHMENTS + 1}
          ) attachment),'[]'::jsonb)
        ) order by chapter.ordinal,chapter.id) from (
          select id,name,summary,ordinal from products.product_chapters where product_id=product.id
          order by ordinal,id limit ${MAX_PRODUCT_CHAPTERS + 1}
        ) chapter),'[]'::jsonb) as chapters
      from products.products product where ${condition}
      order by product.name,product.id limit ${limit}
    `),
    );
    if (
      products.some(
        (product) =>
          product.catalogue.length > MAX_PRODUCT_MATERIALS ||
          product.programmePlacements.length >
            MAX_PRODUCT_PROGRAMME_PLACEMENTS ||
          product.chapters.length > MAX_PRODUCT_CHAPTERS ||
          product.chapters.some(
            (chapter) =>
              chapter.supplementaryMaterialIds.length > MAX_CHAPTER_ATTACHMENTS,
          ),
      )
    )
      throw new ProductCompositionLimitError();
    if (products.length === 0) return [];
    const facts = new Map(
      (
        await materialFacts.load([
          ...new Set(products.flatMap((product) => product.catalogue)),
        ])
      ).map((fact) => [fact.id, fact]),
    );
    return products.map((product) => {
      const primary = new Map<
        string,
        (typeof product.programmePlacements)[number]
      >();
      let maximumOrdinal = 0;
      for (const placement of product.programmePlacements) {
        if (!primary.has(placement.materialId))
          primary.set(placement.materialId, placement);
        maximumOrdinal = Math.max(maximumOrdinal, placement.ordinal);
      }
      let supplementaryOrdinal = maximumOrdinal;
      const placements = product.catalogue
        .map((materialId) => {
          const placement = primary.get(materialId),
            fact = facts.get(materialId);
          return {
            materialId,
            sourceId: fact?.sourceId ?? null,
            chapterId: placement?.chapterId ?? null,
            ordinal: placement?.ordinal ?? ++supplementaryOrdinal,
            published: fact?.published === true,
            topicId: fact?.topicId ?? null,
            hasModeVariants: fact?.hasModeVariants ?? false,
          };
        })
        .sort((left, right) => {
          const ordinal = left.ordinal - right.ordinal;
          return ordinal === 0
            ? left.materialId.localeCompare(right.materialId)
            : ordinal;
        });
      const row = compositionSchema.parse({
        ...product,
        placements,
        programmePlacements: product.programmePlacements.map((placement) => ({
          ...placement,
          published: facts.get(placement.materialId)?.published === true,
        })),
        chapters: product.chapters.map((chapter) => ({
          ...chapter,
          supplementaryMaterialIds: chapter.supplementaryMaterialIds.filter(
            (materialId) => facts.get(materialId)?.published === true,
          ),
        })),
      });
      return {
        ...row,
        publishedProgramme: row.programmePlacements.filter(
          (placement) => placement.published,
        ),
        materials: row.placements.filter((placement) => placement.published),
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
