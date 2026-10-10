import { z } from "zod";

/** Chapter names follow Product and Topic names; the description is the author's own multi-paragraph text. */
export const PRODUCT_CHAPTER_NAME_MAX = 120;
export const PRODUCT_CHAPTER_SUMMARY_MAX = 4000;
export const productChapterNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PRODUCT_CHAPTER_NAME_MAX);
export const productChapterSummarySchema = z
  .string()
  .trim()
  .max(PRODUCT_CHAPTER_SUMMARY_MAX);

/** A chapter keeps its identity across renames, so the author supplies the identifier. */
export const productChapterDraftSchema = z
  .object({
    id: z.uuid(),
    name: productChapterNameSchema,
    summary: productChapterSummarySchema.default(""),
  })
  .strict();
export const productChapterDraftsSchema = z
  .array(productChapterDraftSchema)
  .max(200)
  .refine(
    (chapters) =>
      new Set(chapters.map(({ id }) => id)).size === chapters.length,
    { message: "Chapter IDs must be unique" },
  );
export const productChapterAssignmentsSchema = z.record(z.uuid(), z.uuid());

export type ProductChapterDraft = z.output<typeof productChapterDraftSchema>;
