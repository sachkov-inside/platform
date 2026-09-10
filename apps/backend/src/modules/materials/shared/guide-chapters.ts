import { z } from "zod";

/** Chapter names follow Guide and Topic names; the description is the author's own multi-paragraph text. */
export const GUIDE_CHAPTER_NAME_MAX = 120;
export const GUIDE_CHAPTER_SUMMARY_MAX = 4000;
export const guideChapterNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(GUIDE_CHAPTER_NAME_MAX);
export const guideChapterSummarySchema = z
  .string()
  .trim()
  .max(GUIDE_CHAPTER_SUMMARY_MAX);

/** A chapter keeps its identity across renames, so the author supplies the identifier. */
export const guideChapterDraftSchema = z
  .object({
    id: z.uuid(),
    name: guideChapterNameSchema,
    summary: guideChapterSummarySchema.default(""),
  })
  .strict();
export const guideChapterDraftsSchema = z
  .array(guideChapterDraftSchema)
  .max(200)
  .refine(
    (chapters) => new Set(chapters.map(({ id }) => id)).size === chapters.length,
    { message: "Chapter IDs must be unique" },
  );
export const guideChapterAssignmentsSchema = z.record(z.uuid(), z.uuid());

export type GuideChapterDraft = z.output<typeof guideChapterDraftSchema>;
