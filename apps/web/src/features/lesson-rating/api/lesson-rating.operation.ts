import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  lessonRatingCommandSchema,
  lessonRatingResultSchema,
} from "../model/lesson-rating-contract";

const toResult = lessonRatingResultSchema.transform((result) =>
  result.kind === "ready"
    ? { kind: "ready" as const, rating: result.rating }
    : result.kind === "unauthorized"
      ? { kind: "unauthorized" as const }
      : result.kind === "rejected"
        ? { kind: "rejected" as const }
        : { kind: "unavailable" as const },
);

/** Читает оценку урока, которую поставил сам читатель. */
export const readLessonRatingOperation = defineMutationOperation({
  input: z.object({ materialId: z.uuid() }),
  method: "POST",
  path: "/api/lesson-ratings/query",
  result: toResult,
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});

/** Ставит лайк или дизлайк; `null` снимает оценку. */
export const setLessonRatingOperation = defineMutationOperation({
  // Команда читает только свои поля: присланный идентификатор аккаунта отбрасывается.
  input: z.object(lessonRatingCommandSchema.shape),
  method: "PUT",
  path: "/api/lesson-ratings/rating",
  result: toResult,
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});
