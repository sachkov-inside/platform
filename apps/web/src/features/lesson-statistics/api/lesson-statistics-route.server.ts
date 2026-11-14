import "server-only";

import { z } from "zod";

import {
  requestExerciseStatistics,
  requestLessonRatingCounts,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  EXERCISE_STATISTICS_MAX,
  exerciseStatisticsSchema,
  lessonRatingCountsSchema,
} from "../model/lesson-statistics-contract";
import { readLessonStatisticsOperation } from "./lesson-statistics.operation";

const statisticsBodySchema = z
  .object({
    exercises: z.array(exerciseStatisticsSchema).max(EXERCISE_STATISTICS_MAX),
  })
  .strict();

/** Both owners answer for an author; either one failing leaves the panel unavailable. */
export function handleLessonStatistics(request: Request) {
  return handleMutationOperation(request, readLessonStatisticsOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const [statistics, ratings] = await Promise.all([
          requestExerciseStatistics(input.materialId, token),
          requestLessonRatingCounts(input.materialId, token),
        ]);
        if (!statistics.ok || !ratings.ok) {
          const statuses = [statistics, ratings]
            .filter((result) => !result.ok)
            .map((result) => result.response.status);
          return {
            kind: statuses.includes(401)
              ? "unauthorized"
              : statuses.includes(403)
                ? "forbidden"
                : "unavailable",
          };
        }
        const exercises = statisticsBodySchema.safeParse(statistics.body);
        const counts = lessonRatingCountsSchema.safeParse(ratings.body);
        return exercises.success && counts.success
          ? {
              kind: "ready",
              exercises: exercises.data.exercises,
              ratings: counts.data,
            }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
