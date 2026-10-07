import { z } from "zod";
import {
  loadGuideCompositions,
  MAX_GUIDE_MATERIALS,
} from "../../shared/guide-composition.js";
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

/** Where a Material named by its source stands in one Guide: its chapter, if the author set one. */
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
    const guides = await loadGuideCompositions(this.prisma, filter, MAX_LOOKUP);
    return guideRowsSchema.parse(
      guides.map(({ id, slug, name, archived, chapters }) => ({
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
   * Materials of one Guide by their authoring source ID with their chapter; a source that is not
   * in that Guide is absent from the answer.
   */
  async placements(
    guideId: string,
    sourceIds: readonly string[],
  ): Promise<readonly DirectoryPlacement[]> {
    if (sourceIds.length === 0) return [];
    if (sourceIds.length > MAX_LOOKUP)
      throw new RangeError("Material lookup exceeds its bound");
    const [guide] = await loadGuideCompositions(
      this.prisma,
      { ids: [guideId] },
      1,
    );
    if (guide !== undefined && guide.placements.length > MAX_GUIDE_MATERIALS)
      throw new RangeError("Guide composition exceeds its bound");
    const sources = new Set(sourceIds);
    return (guide?.placements ?? []).flatMap((placement) =>
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
