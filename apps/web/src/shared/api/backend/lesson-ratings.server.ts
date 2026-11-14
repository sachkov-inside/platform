import "server-only";

import {
  LessonRatingsService,
  MaterialAuthoringService,
} from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestLessonRating(materialId: string, accessToken: string) {
  return executeGeneratedRequest(
    (request) =>
      new LessonRatingsService(request).readLessonRating({ materialId }),
    200,
    { accessToken },
  );
}

/** `null` removes the reader's rating. */
export function requestRateLesson(
  input: {
    readonly materialId: string;
    readonly rating: "like" | "dislike" | null;
  },
  accessToken: string,
) {
  const rating = input.rating;
  return executeGeneratedRequest(
    (request) =>
      rating === null
        ? new LessonRatingsService(request).clearLessonRating({
            materialId: input.materialId,
          })
        : new LessonRatingsService(request).rateLesson({
            materialId: input.materialId,
            requestBody: { rating },
          }),
    200,
    { accessToken },
  );
}

export function requestExerciseStatistics(
  materialId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).readExerciseStatistics({
        materialId,
      }),
    200,
    { accessToken },
  );
}

export function requestLessonRatingCounts(
  materialId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).countLessonRatings({ materialId }),
    200,
    { accessToken },
  );
}
