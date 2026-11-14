import { z } from "zod";

/** Upcoming lessons are short titles of unpublished work; a chapter lists a bounded few. */
export const PRODUCT_ROADMAP_LESSON_TITLE_MAX = 160;
export const PRODUCT_ROADMAP_UPCOMING_LESSONS_MAX = 50;
/** One entry per chapter; a Product composition holds at most 200 chapters. */
export const PRODUCT_ROADMAP_CHAPTERS_MAX = 200;

export const productRoadmapStatuses = ["done", "writing", "planned"] as const;
export const productRoadmapLessonStates = ["writing", "soon"] as const;
export type ProductRoadmapStatus = (typeof productRoadmapStatuses)[number];

const upcomingLessonSchema = z
  .object({
    title: z.string().trim().min(1).max(PRODUCT_ROADMAP_LESSON_TITLE_MAX),
    state: z.enum(productRoadmapLessonStates),
  })
  .strict();

/**
 * The roadmap an author sends: a calendar date of the last update and a status for each chapter
 * of the same Product. Upcoming lessons are titles without a Material behind them. Titles are only
 * trimmed, so the published request schema still names every field exactly.
 */
export const productRoadmapDraftSchema = z
  .object({
    updatedOn: z.iso.date(),
    chapters: z
      .array(
        z
          .object({
            chapterId: z.uuid(),
            status: z.enum(productRoadmapStatuses),
            /** Omitted means none. */
            upcomingLessons: z
              .array(upcomingLessonSchema)
              .max(PRODUCT_ROADMAP_UPCOMING_LESSONS_MAX)
              .optional(),
          })
          .strict(),
      )
      .max(PRODUCT_ROADMAP_CHAPTERS_MAX),
  })
  .strict();
export type ProductRoadmapDraft = z.output<typeof productRoadmapDraftSchema>;

/** The stored and returned roadmap: every field present, chapter IDs canonical. */
export const productRoadmapSchema = z
  .object({
    updatedOn: z.iso.date(),
    chapters: z.array(
      z
        .object({
          chapterId: z.uuid(),
          status: z.enum(productRoadmapStatuses),
          upcomingLessons: z.array(upcomingLessonSchema),
        })
        .strict(),
    ),
  })
  .strict();

export type ProductRoadmap = z.output<typeof productRoadmapSchema>;

/** The stored shape of a draft: canonical chapter IDs and an explicit list of upcoming lessons. */
export function normalizeProductRoadmap(
  draft: ProductRoadmapDraft,
): ProductRoadmap {
  return {
    updatedOn: draft.updatedOn,
    chapters: draft.chapters.map(({ chapterId, status, upcomingLessons }) => ({
      chapterId: chapterId.toLowerCase(),
      status,
      upcomingLessons: upcomingLessons ?? [],
    })),
  };
}

export const productRoadmapReceiptSchema = z
  .object({ productId: z.uuid(), roadmap: productRoadmapSchema.nullable() })
  .strict();
export type ProductRoadmapReceiptDto = z.output<
  typeof productRoadmapReceiptSchema
>;
