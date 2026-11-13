import "server-only";

import { z } from "zod";

import {
  requestExerciseAttempts,
  requestRecordExerciseAttempt,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  EXERCISE_ATTEMPTS_MAX,
  exerciseAttemptSchema,
} from "../model/exercise-attempt-contract";
import {
  readExerciseAttemptsOperation,
  recordExerciseAttemptOperation,
} from "./exercise-attempts.operation";

export function handleExerciseAttempts(request: Request) {
  return handleMutationOperation(request, readExerciseAttemptsOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestExerciseAttempts(input.materialId, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const parsed = z
          .object({
            items: z.array(exerciseAttemptSchema).max(EXERCISE_ATTEMPTS_MAX),
          })
          .strict()
          .safeParse(result.body);
        return parsed.success
          ? { kind: "ready", attempts: parsed.data.items }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}

export function handleRecordExerciseAttempt(request: Request) {
  return handleMutationOperation(request, recordExerciseAttemptOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestRecordExerciseAttempt(input, token);
        if (!result.ok) {
          const status = result.response.status;
          return {
            kind:
              status === 401
                ? "unauthorized"
                : status === 403 || status === 404 || status === 422
                  ? "rejected"
                  : "unavailable",
          };
        }
        const attempt = exerciseAttemptSchema.safeParse(result.body);
        return attempt.success
          ? { kind: "ready", attempt: attempt.data }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
