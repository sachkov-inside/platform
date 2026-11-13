import { queryOptions } from "@tanstack/react-query";

import type { LessonRatingCommand } from "../model/lesson-rating-contract";
import {
  readLessonRatingOperation,
  setLessonRatingOperation,
} from "./lesson-rating.operation";

/** Оценка личная: у гостя запрос выключен, а не отбит отказом 401. */
export function lessonRatingQueryOptions(input: {
  readonly accountId: string | null;
  readonly materialId: string;
}) {
  return queryOptions({
    queryKey: ["lesson-rating", input.accountId, input.materialId],
    queryFn: () =>
      readLessonRatingOperation.send({ materialId: input.materialId }),
    enabled: input.accountId !== null,
    retry: false,
  });
}

export function setLessonRating(input: LessonRatingCommand) {
  return setLessonRatingOperation.send(input);
}
