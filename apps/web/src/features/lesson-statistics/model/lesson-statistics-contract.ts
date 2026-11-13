import {
  exerciseAnswerSchema,
  exerciseIdSchema,
  exerciseKinds,
} from "@inside/material-blocks";
import { z } from "zod";

/** First-try statistics of one exercise version, as the backend reports them (#2124). */
export const exerciseVersionStatisticsSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
    firstAnsweredAt: z.iso.datetime(),
    respondents: z.number().int().positive(),
    firstTryCorrect: z.number().int().nonnegative(),
    firstTryDontKnow: z.number().int().nonnegative(),
    mostFrequentWrongAnswer: z
      .object({
        answer: exerciseAnswerSchema,
        count: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const exerciseStatisticsSchema = z
  .object({
    exerciseId: exerciseIdSchema,
    kind: z.enum(exerciseKinds),
    versions: z.array(exerciseVersionStatisticsSchema).min(1),
  })
  .strict();
export type ExerciseStatistics = z.infer<typeof exerciseStatisticsSchema>;

/** A lesson holds a few exercises; the bound only stops a malformed answer. */
export const EXERCISE_STATISTICS_MAX = 200;

export const lessonRatingCountsSchema = z
  .object({
    likes: z.number().int().nonnegative(),
    dislikes: z.number().int().nonnegative(),
  })
  .strict();
export type LessonRatingCounts = z.infer<typeof lessonRatingCountsSchema>;

export const lessonStatisticsResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      exercises: z.array(exerciseStatisticsSchema).max(EXERCISE_STATISTICS_MAX),
      ratings: lessonRatingCountsSchema,
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export type LessonStatisticsResult =
  | {
      readonly kind: "ready";
      readonly exercises: readonly ExerciseStatistics[];
      readonly ratings: LessonRatingCounts;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };
