import {
  exerciseAnswerSchema,
  exerciseFingerprintSchema,
  exerciseIdSchema,
  exerciseResultSchema,
} from "@inside/material-blocks";
import { z } from "zod";

/** One Exercise Attempt as the backend reports it; the version is `exerciseFingerprint`. */
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

/** A lesson holds a few exercises; the bound only stops a malformed answer. */
export const EXERCISE_ATTEMPTS_MAX = 200;

export const exerciseAttemptCommandSchema = z
  .object({
    materialId: z.uuid(),
    exerciseId: exerciseIdSchema,
    answer: exerciseAnswerSchema,
  })
  .strict();
export type ExerciseAttemptCommand = z.infer<
  typeof exerciseAttemptCommandSchema
>;

export const exerciseAttemptsResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      attempts: z.array(exerciseAttemptSchema).max(EXERCISE_ATTEMPTS_MAX),
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

/** `rejected`: the exercise is gone, closed to the reader or no longer fits the answer. */
export const exerciseAttemptResultSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("ready"), attempt: exerciseAttemptSchema })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("rejected") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export type ExerciseAttemptsResult =
  | { readonly kind: "ready"; readonly attempts: readonly ExerciseAttempt[] }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

export type ExerciseAttemptResult =
  | { readonly kind: "ready"; readonly attempt: ExerciseAttempt }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };
