import "server-only";

import {
  requestLessonRating,
  requestRateLesson,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { lessonRatingBodySchema } from "../model/lesson-rating-contract";
import {
  readLessonRatingOperation,
  setLessonRatingOperation,
} from "./lesson-rating.operation";

export function handleLessonRating(request: Request) {
  return handleMutationOperation(request, readLessonRatingOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestLessonRating(input.materialId, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const body = lessonRatingBodySchema.safeParse(result.body);
        return body.success
          ? { kind: "ready", rating: body.data.rating }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}

export function handleSetLessonRating(request: Request) {
  return handleMutationOperation(request, setLessonRatingOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestRateLesson(input, token);
        if (!result.ok) {
          const status = result.response.status;
          return {
            kind:
              status === 401
                ? "unauthorized"
                : status === 403 || status === 404
                  ? "rejected"
                  : "unavailable",
          };
        }
        const body = lessonRatingBodySchema.safeParse(result.body);
        return body.success
          ? { kind: "ready", rating: body.data.rating }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
