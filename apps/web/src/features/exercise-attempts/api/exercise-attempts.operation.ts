import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  exerciseAttemptCommandSchema,
  exerciseAttemptResultSchema,
  exerciseAttemptsResultSchema,
} from "../model/exercise-attempt-contract";

/** Reads the reader's latest attempt on each exercise of one lesson. */
export const readExerciseAttemptsOperation = defineMutationOperation({
  input: z.object({ materialId: z.uuid() }),
  method: "POST",
  path: "/api/exercise-attempts/query",
  result: exerciseAttemptsResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, attempts: result.attempts }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});

/** Checks one answer on the server and records the attempt; the result comes back from it. */
export const recordExerciseAttemptOperation = defineMutationOperation({
  // The command reads only its own fields: a posted result or identity is dropped.
  input: z.object(exerciseAttemptCommandSchema.shape),
  method: "POST",
  path: "/api/exercise-attempts/attempt",
  result: exerciseAttemptResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, attempt: result.attempt }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : result.kind === "rejected"
          ? { kind: "rejected" as const }
          : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});
