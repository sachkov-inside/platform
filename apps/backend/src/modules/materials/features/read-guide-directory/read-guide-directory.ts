import { z } from "zod";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

// One Guide Task request names at most a page of Guides or related Materials.
const MAX_LOOKUP = 100;

const guideRowsSchema = z.array(
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

export type DirectoryGuide = z.infer<typeof guideRowsSchema>[number];

/** A Material named by its source; `published` is absent while readers cannot open it. */
export interface DirectoryMaterial {
  readonly sourceId: string;
  readonly materialId: string;
  readonly published: { readonly slug: string; readonly title: string } | null;
}

/**
 * Guides with their chapters, and Materials by source ID: the Guide structure that Guide Tasks
 * place themselves in (#946). Reads only; the Guide programme and its order stay in Materials.
 */
export class GuideDirectory {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  /** Guides by ID or slug, archived ones included, with chapters in author order. */
  async guides(
    filter:
      | { readonly ids: readonly string[] }
      | { readonly slugs: readonly string[] },
  ): Promise<readonly DirectoryGuide[]> {
    const values = "ids" in filter ? filter.ids : filter.slugs;
    if (values.length === 0) return [];
    if (values.length > MAX_LOOKUP)
      throw new RangeError("Guide lookup exceeds its bound");
    const condition =
      "ids" in filter
        ? Prisma.sql`series.id = any(${[...filter.ids]}::uuid[])`
        : Prisma.sql`series.slug = any(${[...filter.slugs]}::text[])`;
    return guideRowsSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
        select
          series.id,
          series.slug,
          series.name,
          series.archived_at is not null as archived,
          coalesce(
            (
              select json_agg(
                json_build_object('id', chapter.id, 'name', chapter.name, 'ordinal', chapter.ordinal)
                order by chapter.ordinal, chapter.id
              )
              from materials.guide_chapters as chapter
              where chapter.guide_id = series.id
            ),
            '[]'::json
          ) as chapters
        from materials.series as series
        where ${condition}
        order by series.id
      `),
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
