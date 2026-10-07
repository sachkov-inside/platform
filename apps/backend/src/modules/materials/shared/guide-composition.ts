import { z } from "zod";
import {
  Prisma,
  type MaterialsPrisma,
} from "../../../infrastructure/prisma/index.js";
import type { ContentAccess, Subject } from "../../content-access/index.js";

export const MAX_GUIDE_MATERIALS = 10_000;
const chapterSchema = z.object({
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
const compositionSchema = z.object({
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
export type GuideComposition = z.infer<typeof compositionSchema> & {
  readonly materials: readonly z.infer<typeof placementSchema>[];
};

/** One snapshot owns chapter order, current placements and the published main path. */
export async function loadGuideCompositions(
  prisma: MaterialsPrisma,
  filter:
    | { readonly ids: readonly string[] }
    | { readonly slugs: readonly string[] }
    | { readonly current: true },
  limit: number,
): Promise<readonly GuideComposition[]> {
  const condition =
    "ids" in filter
      ? Prisma.sql`series.id = any(${[...filter.ids]}::uuid[])`
      : "slugs" in filter
        ? Prisma.sql`series.slug = any(${[...filter.slugs]}::text[])`
        : Prisma.sql`series.archived_at is null`;
  const rows = compositionSchema.array().parse(
    await prisma.$queryRaw(Prisma.sql`
    select series.id, series.slug, series.name, series.summary,
      series.archived_at is not null as archived,
      series.audience, series.outcome, series.prerequisites, series.scope,
      series.presentation, series.page, series.cover_id as "coverId",
      coalesce((select json_agg(json_build_object(
        'id', chapter.id, 'name', chapter.name, 'summary', chapter.summary, 'ordinal', chapter.ordinal
      ) order by chapter.ordinal, chapter.id)
        from materials.guide_chapters as chapter where chapter.guide_id = series.id), '[]'::json) as chapters,
      coalesce((select json_agg(placement order by placement.ordinal, placement."materialId") from (
        select membership.material_id as "materialId", material.source_id as "sourceId",
          membership.chapter_id as "chapterId", coalesce(published.ordinal, membership.ordinal) as ordinal,
          publication.material_id is not null and material.publication_state = 'published' as published,
          publication.topic_id as "topicId", coalesce(publication.has_mode_variants, false) as "hasModeVariants"
        from materials.series_memberships as membership
        join materials.materials as material on material.id = membership.material_id
        left join materials.published_material_series_memberships as published
          on published.series_id = membership.series_id and published.material_id = membership.material_id
        left join materials.published_materials as publication
          on publication.material_id = published.material_id
        where membership.series_id = series.id
        order by coalesce(published.ordinal, membership.ordinal), membership.material_id
        limit ${MAX_GUIDE_MATERIALS + 1}
      ) as placement), '[]'::json) as placements
    from materials.series as series where ${condition}
    order by series.name, series.id limit ${limit}
  `),
  );
  return rows.map((row) => ({
    ...row,
    materials: row.placements.filter((placement) => placement.published),
  }));
}

/** Current programmes include locked cards; an archive requires access to the whole Guide. */
export async function readGuideCompositionAccess(
  guide: Pick<GuideComposition, "id" | "archived">,
  reader?: {
    readonly subject: Subject;
    readonly contentAccess: Pick<ContentAccess, "checkGuideAccess">;
  },
): Promise<"open" | "closed" | "unavailable"> {
  if (!guide.archived) return "open";
  if (reader === undefined || reader.subject.kind === "anonymous")
    return "closed";
  const access = await reader.contentAccess.checkGuideAccess({
    subject: reader.subject,
    guideId: guide.id,
  });
  return access.kind;
}

export function guideCompositionChapters(guide: GuideComposition) {
  if (guide.placements.length > MAX_GUIDE_MATERIALS)
    throw new RangeError("Guide composition exceeds its bound");
  return guide.chapters.map((chapter) => ({
    ...chapter,
    materialIds: guide.materials
      .filter((material) => material.chapterId === chapter.id)
      .map((material) => material.materialId),
  }));
}

/** Resource authorization uses the same Guide archive facts for body, Assets and Video. */
export async function loadMaterialGuideAccessFacts(
  prisma: Pick<MaterialsPrisma, "guide" | "publishedMaterialGuideMembership">,
  materialIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    { readonly guideIds: readonly string[]; readonly archivedOnly?: true }
  >
> {
  const memberships = await prisma.publishedMaterialGuideMembership.findMany({
    where: { materialId: { in: [...materialIds] } },
    select: { materialId: true, seriesId: true },
  });
  const guides = await prisma.guide.findMany({
    where: {
      id: {
        in: [...new Set(memberships.map((membership) => membership.seriesId))],
      },
    },
    select: { id: true, archivedAt: true },
  });
  const archived = new Set(
    guides
      .filter((guide) => guide.archivedAt !== null)
      .map((guide) => guide.id),
  );
  return new Map(
    materialIds.flatMap((id) => {
      const guideIds = memberships
        .filter((membership) => membership.materialId === id)
        .map((membership) => membership.seriesId);
      if (guideIds.length === 0) return [];
      return [
        [
          id,
          {
            guideIds,
            ...(guideIds.every((guideId) => archived.has(guideId))
              ? { archivedOnly: true as const }
              : {}),
          },
        ] as const,
      ];
    }),
  );
}
