import {
  exerciseFingerprintSchema,
  exerciseIdSchema,
  exerciseKinds,
} from "@inside/material-blocks";
import { z } from "zod";

/** First-try statistics of one exercise version, as the backend reports them (#2124). */
export const exerciseVersionStatisticsSchema = z
  .object({
    fingerprint: exerciseFingerprintSchema,
    firstAnsweredAt: z.iso.datetime(),
    respondents: z.number().int().positive(),
    firstTryCorrect: z.number().int().nonnegative(),
    firstTryDontKnow: z.number().int().nonnegative(),
    /**
     * What readers got wrong first most often: a quiz's wrong option set, a match's wrong
     * row → choice pair, or an order's step out of place.
     */
    mostFrequentMistake: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("options"),
            optionIds: z.array(exerciseIdSchema).min(1),
            count: z.number().int().positive(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("pair"),
            rowId: exerciseIdSchema,
            choiceId: exerciseIdSchema,
            count: z.number().int().positive(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("step"),
            stepId: exerciseIdSchema,
            count: z.number().int().positive(),
          })
          .strict(),
      ])
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
