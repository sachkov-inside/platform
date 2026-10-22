import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  saveAuthorFeedbackInputSchema,
  saveAuthorFeedbackResultSchema,
} from "../model/author-feedback";

/** Saves the author's comment and «посмотрел автор» on one submission (#948). */
export const saveAuthorFeedbackOperation = defineMutationOperation({
  input: saveAuthorFeedbackInputSchema,
  method: "PUT",
  path: "/api/authoring/product-tasks/feedback",
  result: saveAuthorFeedbackResultSchema,
  transportFailure: (failure) =>
    ({
      kind:
        failure.kind === "status" && failure.status === 401
          ? "unauthorized"
          : "unavailable",
    }) as const,
});
