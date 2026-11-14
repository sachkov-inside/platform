import { z } from "zod";

/** «Как вам урок?»: лайк или дизлайк читателя. */
export const lessonRatingValueSchema = z.enum(["like", "dislike"]);
export type LessonRatingValue = z.infer<typeof lessonRatingValueSchema>;

/** `rating: null` снимает оценку. */
export const lessonRatingCommandSchema = z
  .object({
    materialId: z.uuid(),
    rating: lessonRatingValueSchema.nullable(),
  })
  .strict();
export type LessonRatingCommand = z.infer<typeof lessonRatingCommandSchema>;

/** Ответ бэкенда на чтение, установку и снятие оценки. */
export const lessonRatingBodySchema = z
  .object({ rating: lessonRatingValueSchema.nullable() })
  .strict();

/** `rejected`: урок закрыт читателю или снят с публикации. */
export const lessonRatingResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      rating: lessonRatingValueSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("rejected") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export type LessonRatingResult =
  | { readonly kind: "ready"; readonly rating: LessonRatingValue | null }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };
