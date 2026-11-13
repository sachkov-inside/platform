import {
  exerciseAnswerSchema,
  exerciseIdSchema,
  exerciseKinds,
  type ExerciseAnswer,
} from "@inside/material-blocks";
import { z } from "zod";
import { exerciseFingerprintSchema } from "./exercise-attempt.js";

/**
 * First-try statistics of one exercise version (#2124). Only the first attempt of each Account
 * on the version counts: it shows whether the reader understood, later attempts only show that
 * they reached the right answer.
 * - `respondents`: Accounts that answered this version;
 * - `firstTryCorrect`, `firstTryDontKnow`: how many of them answered right or «Не знаю» first;
 * - `mostFrequentWrongAnswer`: the wrong full answer given first most often, in canonical form
 *   (`canonicalExerciseAnswer`), or null when nobody answered wrong first.
 */
export const exerciseVersionStatisticsSchema = z
  .object({
    fingerprint: exerciseFingerprintSchema,
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

/** Every version readers answered, oldest first. */
export const exerciseStatisticsSchema = z
  .object({
    exerciseId: exerciseIdSchema,
    kind: z.enum(exerciseKinds),
    versions: z.array(exerciseVersionStatisticsSchema).min(1),
  })
  .strict();
export type ExerciseStatistics = z.infer<typeof exerciseStatisticsSchema>;

/**
 * One spelling for answers that mean the same: chosen options and match rows are a set, so they
 * are sorted; an order keeps its sequence, which is the answer itself.
 */
export function canonicalExerciseAnswer(
  answer: ExerciseAnswer,
): ExerciseAnswer {
  switch (answer.kind) {
    case "options":
      return { kind: "options", optionIds: [...answer.optionIds].sort() };
    case "matches":
      return {
        kind: "matches",
        matches: [...answer.matches].sort((left, right) =>
          left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0,
        ),
      };
    case "sequence":
    case "dontKnow":
      return answer;
  }
}
