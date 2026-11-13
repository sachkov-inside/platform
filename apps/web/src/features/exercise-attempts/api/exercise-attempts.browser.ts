import { queryOptions } from "@tanstack/react-query";

import type { ExerciseAttemptCommand } from "../model/exercise-attempt-contract";
import {
  readExerciseAttemptsOperation,
  recordExerciseAttemptOperation,
} from "./exercise-attempts.operation";

/** Attempts are personal: a guest makes no request instead of collecting a 401. */
export function exerciseAttemptsQueryOptions(input: {
  readonly accountId: string | null;
  readonly materialId: string;
}) {
  return queryOptions({
    queryKey: ["exercise-attempts", input.accountId, input.materialId],
    queryFn: () =>
      readExerciseAttemptsOperation.send({ materialId: input.materialId }),
    enabled: input.accountId !== null,
    retry: false,
  });
}

export function recordExerciseAttempt(input: ExerciseAttemptCommand) {
  return recordExerciseAttemptOperation.send(input);
}
