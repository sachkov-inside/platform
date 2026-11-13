import "server-only";

import type { ExerciseAnswer } from "@inside/material-blocks";

import { ExerciseAttemptsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestExerciseAttempts(
  materialId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new ExerciseAttemptsService(request).readExerciseAttempts({
        materialId,
      }),
    200,
    { accessToken },
  );
}

export function requestRecordExerciseAttempt(
  input: {
    readonly materialId: string;
    readonly exerciseId: string;
    readonly answer: ExerciseAnswer;
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new ExerciseAttemptsService(request).recordExerciseAttempt({
        materialId: input.materialId,
        exerciseId: input.exerciseId,
        requestBody: { answer: input.answer },
      }),
    200,
    { accessToken },
  );
}
