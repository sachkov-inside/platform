import {
  exerciseFingerprintSchema,
  exerciseIdSchema,
  exerciseKinds,
} from "@inside/material-blocks";
import { z } from "zod";

/**
 * First-try statistics of one exercise version (#2124). Only the first attempt of each Account
 * on the version counts: it shows whether the reader understood, later attempts only show that
 * they reached the right answer.
 * - `respondents`: Accounts that answered this version;
 * - `firstTryCorrect`, `firstTryDontKnow`: how many of them answered right or «Не знаю» first;
 * - `mostFrequentMistake`: what readers got wrong first most often, or null when nobody answered
 *   wrong first. A quiz names the wrong option set (`options`); a match names the wrong
 *   row → choice pair (`pair`); an order names the step put out of place (`step`). The count is
 *   how many first answers held it; a tie goes to the smaller identifiers, so it is stable.
 */
export const exerciseVersionStatisticsSchema = z
  .object({
    fingerprint: exerciseFingerprintSchema,
    firstAnsweredAt: z.iso.datetime(),
    respondents: z.number().int().positive(),
    firstTryCorrect: z.number().int().nonnegative(),
    firstTryDontKnow: z.number().int().nonnegative(),
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

/** Every version readers answered, oldest first. */
export const exerciseStatisticsSchema = z
  .object({
    exerciseId: exerciseIdSchema,
    kind: z.enum(exerciseKinds),
    versions: z.array(exerciseVersionStatisticsSchema).min(1),
  })
  .strict();
export type ExerciseStatistics = z.infer<typeof exerciseStatisticsSchema>;

/** The items a wrong match or order answer got wrong, as `exerciseMistakes` writes them. */
export const storedExerciseMistakesSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pairs"),
      pairs: z.array(
        z
          .object({ rowId: exerciseIdSchema, choiceId: exerciseIdSchema })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({ kind: z.literal("steps"), stepIds: z.array(exerciseIdSchema) })
    .strict(),
]);
