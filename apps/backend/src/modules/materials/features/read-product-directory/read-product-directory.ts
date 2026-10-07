import { z } from "zod";
import {
  loadProductCompositions,
  MAX_PRODUCT_MATERIALS,
} from "../../shared/product-composition.js";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

// One Product Task request names at most a page of Products or related Materials.
const MAX_LOOKUP = 100;

const productRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    archived: z.boolean(),
    chapters: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        ordinal: z.number().int(),
      }),
    ),
  }),
);
const materialRowsSchema = z.array(
  z.object({
    source_id: z.string(),
    material_id: z.uuid(),
    slug: z.string().nullable(),
    title: z.string().nullable(),
  }),
);

export type DirectoryProduct = z.infer<typeof productRowsSchema>[number];

/** Where a Material named by its source stands in one Product: its chapter, if the author set one. */
export interface DirectoryPlacement {
  readonly sourceId: string;
  readonly materialId: string;
  readonly chapterId: string | null;
  /** Whether readers can open it; a draft's identity never reaches a reader. */
  readonly published: boolean;
}

/** A Material named by its source; `published` is absent while readers cannot open it. */
export interface DirectoryMaterial {
  readonly sourceId: string;
  readonly materialId: string;
  readonly published: { readonly slug: string; readonly title: string } | null;
}

/**
 * Products with their chapters, and Materials by source ID: the Product structure that Product Tasks
 * place themselves in (#946). Reads only; the Product programme and its order stay in Materials.
 */
export class ProductDirectory {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  /** Products by ID or slug, archived ones included, with chapters in author order. */
  async products(
    filter:
      | { readonly ids: readonly string[] }
      | { readonly slugs: readonly string[] },
  ): Promise<readonly DirectoryProduct[]> {
    const values = "ids" in filter ? filter.ids : filter.slugs;
    if (values.length === 0) return [];
    if (values.length > MAX_LOOKUP)
      throw new RangeError("Product lookup exceeds its bound");
    const products = await loadProductCompositions(
      this.prisma,
      filter,
      MAX_LOOKUP,
    );
    return productRowsSchema.parse(
      products.map(({ id, slug, name, archived, chapters }) => ({
        id,
        slug,
        name,
        archived,
        chapters: chapters.map(({ id, name, ordinal }) => ({
          id,
          name,
          ordinal,
        })),
      })),
    );
  }

  /**
   * Materials of one Product by their authoring source ID with their chapter; a source that is not
   * in that Product is absent from the answer.
   */
  async placements(
    productId: string,
    sourceIds: readonly string[],
  ): Promise<readonly DirectoryPlacement[]> {
    if (sourceIds.length === 0) return [];
    if (sourceIds.length > MAX_LOOKUP)
      throw new RangeError("Material lookup exceeds its bound");
    const [product] = await loadProductCompositions(
      this.prisma,
      { ids: [productId] },
      1,
    );
    if (
      product !== undefined &&
      product.placements.length > MAX_PRODUCT_MATERIALS
    )
      throw new RangeError("Product composition exceeds its bound");
    const sources = new Set(sourceIds);
    return (product?.placements ?? []).flatMap((placement) =>
      placement.sourceId !== null && sources.has(placement.sourceId)
        ? [
            {
              sourceId: placement.sourceId,
              materialId: placement.materialId,
              chapterId: placement.chapterId,
              published: placement.published,
            },
          ]
        : [],
    );
  }

  /** Materials by their authoring source ID; an unknown source is absent from the answer. */
  async materialsBySource(
    sourceIds: readonly string[],
  ): Promise<readonly DirectoryMaterial[]> {
    if (sourceIds.length === 0) return [];
    if (sourceIds.length > MAX_LOOKUP)
      throw new RangeError("Material lookup exceeds its bound");
    const rows = materialRowsSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
        select material.source_id, material.id as material_id, published.slug, published.title
        from materials.materials as material
        left join materials.published_materials as published
          on published.material_id = material.id
         and material.publication_state = 'published'
        where material.source_id = any(${[...sourceIds]}::text[])
      `),
    );
    return rows.map((row) => ({
      sourceId: row.source_id,
      materialId: row.material_id,
      published:
        row.slug === null || row.title === null
          ? null
          : { slug: row.slug, title: row.title },
    }));
  }
}
