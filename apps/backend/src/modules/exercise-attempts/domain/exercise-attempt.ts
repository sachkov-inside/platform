import {
  exerciseAnswerSchema,
  exerciseFingerprintSchema,
  exerciseIdSchema,
  exerciseResultSchema,
} from "@inside/material-blocks";
import { z } from "zod";

/** One Exercise Attempt as a reader sees it: the answer, its result and the checked version. */
export const exerciseAttemptSchema = z
  .object({
    exerciseId: exerciseIdSchema,
    fingerprint: exerciseFingerprintSchema,
    answer: exerciseAnswerSchema,
    result: exerciseResultSchema,
    firstForVersion: z.boolean(),
    attemptedAt: z.iso.datetime(),
  })
  .strict();
export type ExerciseAttempt = z.infer<typeof exerciseAttemptSchema>;
