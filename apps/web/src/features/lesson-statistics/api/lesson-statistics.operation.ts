import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import { lessonStatisticsResultSchema } from "../model/lesson-statistics-contract";

/** Reads the author statistics of one lesson: exercises per version and the ratings. */
export const readLessonStatisticsOperation = defineMutationOperation({
  input: z.object({ materialId: z.uuid() }),
  method: "POST",
  path: "/api/authoring/lesson-statistics",
  result: lessonStatisticsResultSchema.transform((result) =>
    result.kind === "ready"
      ? {
          kind: "ready" as const,
          exercises: result.exercises,
          ratings: result.ratings,
        }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : result.kind === "forbidden"
          ? { kind: "forbidden" as const }
          : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});
