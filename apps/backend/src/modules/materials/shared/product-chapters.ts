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
    id: z.uuid().transform((id) => id.toLowerCase()),
    name: productChapterNameSchema,
    summary: productChapterSummarySchema.default(""),
    /** Omitted preserves existing attachments; [] explicitly clears them. */
    supplementaryMaterialIds: z
      .array(z.uuid().transform((id) => id.toLowerCase()))
      .max(200)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Supplementary Materials must be unique",
      )
      .optional(),
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
export const productChapterAssignmentsSchema = z.record(
  z.uuid().transform((id) => id.toLowerCase()),
  z.uuid().transform((id) => id.toLowerCase()),
);

export type ProductChapterDraft = z.output<typeof productChapterDraftSchema>;

/** Identity belongs to a placement, so one Material can appear in several programme positions. */
export const productProgrammePlacementsSchema = z
  .array(
    z
      .object({
        id: z.uuid().transform((id) => id.toLowerCase()),
        materialId: z.uuid().transform((id) => id.toLowerCase()),
        chapterId: z
          .uuid()
          .transform((id) => id.toLowerCase())
          .nullable(),
        stepGroup: z.string().trim().min(1).max(120).nullable().default(null),
      })
      .strict(),
  )
  .max(20000)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "Programme placement IDs must be unique",
  );
export type ProductProgrammePlacement = z.output<
  typeof productProgrammePlacementsSchema
>[number];
