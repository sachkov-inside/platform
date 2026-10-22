import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  submitProductTaskInputSchema,
  submitProductTaskResultSchema,
} from "../model/product-task-submission";

/** Submits one answer to a Product task from its page (#947). */
export const submitProductTaskOperation = defineMutationOperation({
  input: z.object(submitProductTaskInputSchema.shape),
  method: "POST",
  path: "/api/product-tasks/submissions",
  result: submitProductTaskResultSchema,
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? ({ kind: "unauthorized" } as const)
      : ({ kind: "unavailable" } as const),
});
