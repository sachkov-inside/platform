import {
  exerciseAnswerSchema,
  exerciseIdSchema,
  exerciseResultSchema,
} from "@inside/material-blocks";
import { z } from "zod";

/** The version of an exercise, as `exerciseFingerprint` of `@inside/material-blocks` writes it. */
export const exerciseFingerprintSchema = z.string().regex(/^[0-9a-f]{16}$/u);

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
