import type { ContentAccess, Subject } from "../../../content-access/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { z } from "zod";
import {
  loadProductCompositions,
  MAX_PRODUCT_MATERIALS,
} from "../../shared/product-composition.js";
import {
  Prisma,
  type MaterialsPrismaClient,
  type MaterialsPrisma,
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

  /** Reader visibility without chapter/material payloads; uses the programme's archive and bound policy. */
  async readerVisibleIds(
    productIds: readonly string[],
    reader: {
      readonly subject: Subject;
      readonly contentAccess: Pick<ContentAccess, "checkProductAccessMany">;
    },
  ): Promise<
    | { readonly ok: true; readonly value: readonly string[] }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: "invalid_request" | "dependency_unavailable";
        };
      }
  > {
    const parsed = z
      .array(z.uuid().toLowerCase())
      .min(1)
      .max(MAX_LOOKUP)
      .safeParse(productIds);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const ids = [...new Set(parsed.data)];
    try {
      // Product state and composition size share the same SQL snapshot, as the full programme does.
      const products = z
        .array(
          z.object({
            id: z.uuid(),
            archivedAt: z.date().nullable(),
            placementCount: z.number().int().nonnegative(),
          }),
        )
        .parse(
          await this.prisma.$queryRaw(Prisma.sql`
        select product.id, product.archived_at as "archivedAt", (
          select count(*)::int from (
            select 1 from materials.series_memberships membership
            where membership.series_id = product.id limit ${MAX_PRODUCT_MATERIALS + 1}
          ) placement
        ) as "placementCount"
        from materials.series product where product.id = any(${ids}::uuid[])
      `),
        );
      const sizes = new Map(
        products.map((row) => [row.id, row.placementCount]),
      );
      const archived = products.filter(
        (product) =>
          product.archivedAt !== null &&
          (sizes.get(product.id) ?? 0) <= MAX_PRODUCT_MATERIALS,
      );
      const archivedAccess =
        reader.subject.kind === "anonymous"
          ? archived.map(() => ({ kind: "closed" as const }))
          : await reader.contentAccess.checkProductAccessMany({
              subject: reader.subject,
              productIds: archived.map(({ id }) => id),
            });
      const archivedById = new Map(
        archived.map((product, index) => [
          product.id,
          archivedAccess[index]?.kind ?? "unavailable",
        ]),
      );
      const admitted = products.map((product) => ({
        id: product.id,
        access:
          (sizes.get(product.id) ?? 0) > MAX_PRODUCT_MATERIALS
            ? "closed"
            : product.archivedAt === null
              ? "open"
              : (archivedById.get(product.id) ?? "unavailable"),
      }));
      if (admitted.some((product) => product.access === "unavailable"))
        return { ok: false, error: { code: "dependency_unavailable" } };
      const visible = new Set(
        admitted
          .filter((product) => product.access === "open")
          .map((product) => product.id),
      );
      return { ok: true, value: ids.filter((id) => visible.has(id)) };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "readerVisibleIds" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

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
    return (product?.placements ?? []).flatMap((membership) => {
      if (membership.sourceId === null || !sources.has(membership.sourceId))
        return [];
      const sourceId = membership.sourceId;
      const placements =
        product?.programmePlacements.filter(
          (placement) => placement.materialId === membership.materialId,
        ) ?? [];
      const chapterIds =
        placements.length === 0
          ? [null]
          : [...new Set(placements.map((placement) => placement.chapterId))];
      return chapterIds.map((chapterId) => ({
        sourceId,
        materialId: membership.materialId,
        chapterId,
        published: membership.published,
      }));
    });
  }

  /** Serialize a Task binding with Product composition edits, using the caller's transaction. */
  async lockPrimaryPlacement(
    transaction: Pick<MaterialsPrisma, "$queryRaw">,
    productId: string,
    sourceId: string,
  ): Promise<DirectoryPlacement | null> {
    await transaction.$queryRaw(
      Prisma.sql`select id from materials.series where id = ${productId}::uuid for update`,
    );
    const rows = z
      .array(
        z.object({
          material_id: z.uuid(),
          chapter_id: z.uuid().nullable(),
          published: z.boolean(),
        }),
      )
      .parse(
        await transaction.$queryRaw(Prisma.sql`
        select membership.material_id, membership.chapter_id, material.publication_state = 'published' as published
        from materials.series_memberships membership
        join materials.materials material on material.id = membership.material_id
        where membership.series_id = ${productId}::uuid and material.source_id = ${sourceId}
      `),
      );
    const row = rows[0];
    return row === undefined
      ? null
      : {
          sourceId,
          materialId: row.material_id,
          chapterId: row.chapter_id,
          published: row.published,
        };
  }

  /** Published identity lookup for internal Task practice context; does not grant access. */
  async materialsByIds(
    ids: readonly string[],
  ): Promise<readonly DirectoryMaterial[]> {
    if (ids.length === 0) return [];
    if (ids.length > MAX_LOOKUP)
      throw new RangeError("Material lookup exceeds its bound");
    const rows = materialRowsSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      select material.source_id, material.id as material_id, published.slug, published.title
      from materials.materials material
      left join materials.published_materials published on published.material_id = material.id and material.publication_state = 'published'
      where material.id = any(${[...ids]}::uuid[]) and material.source_id is not null
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
