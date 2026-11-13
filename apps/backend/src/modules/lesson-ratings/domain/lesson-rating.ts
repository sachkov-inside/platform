import { z } from "zod";

/** «Как вам урок?»: a like or a dislike of one reader. */
export const lessonRatingSchema = z.enum(["like", "dislike"]);
export type LessonRating = z.infer<typeof lessonRatingSchema>;

/** The current ratings of one lesson, as its author sees them. */
export const lessonRatingCountsSchema = z
  .object({
    likes: z.number().int().nonnegative(),
    dislikes: z.number().int().nonnegative(),
  })
  .strict();
export type LessonRatingCounts = z.infer<typeof lessonRatingCountsSchema>;
