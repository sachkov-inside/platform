import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

export const lessonFeedbackTextLimit = 2000;
export const lessonFeedbackBodySchema = z.strictObject({
  submitted: z.boolean(),
});

const result = z.discriminatedUnion("kind", [
  lessonFeedbackBodySchema.extend({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("unauthorized") }),
  z.strictObject({ kind: z.literal("not_lesson") }),
  z.strictObject({ kind: z.literal("unavailable") }),
]);
const transportFailure = (failure: { kind: string; status?: number }) =>
  failure.kind === "status" && failure.status === 401
    ? { kind: "unauthorized" as const }
    : { kind: "unavailable" as const };

const address = { materialId: z.uuid() };

export const readLessonFeedbackOperation = defineMutationOperation({
  input: z.object(address),
  method: "POST",
  path: "/api/lesson-ratings/feedback/query",
  result,
  transportFailure,
});

export const submitLessonFeedbackOperation = defineMutationOperation({
  input: z.object({
    ...address,
    text: z
      .string()
      .trim()
      .min(1)
      .max(lessonFeedbackTextLimit)
      .refine((text) => !text.includes("\0")),
  }),
  method: "PUT",
  path: "/api/lesson-ratings/feedback",
  result,
  transportFailure,
});
