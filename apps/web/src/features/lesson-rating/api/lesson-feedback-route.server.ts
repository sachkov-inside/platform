import "server-only";

import {
  requestLessonFeedback,
  requestSubmitLessonFeedback,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  lessonFeedbackBodySchema,
  readLessonFeedbackOperation,
  submitLessonFeedbackOperation,
} from "./lesson-feedback.operation";

async function runFeedbackRequest(
  request: ReturnType<typeof requestLessonFeedback>,
) {
  try {
    const result = await request;
    if (!result.ok) {
      const status = result.response.status;
      if (status === 401) return { kind: "unauthorized" as const };
      if (status === 404) return { kind: "not_lesson" as const };
      return { kind: "unavailable" as const };
    }
    const body = lessonFeedbackBodySchema.safeParse(result.body);
    if (body.success)
      return { kind: "ready" as const, submitted: body.data.submitted };
  } catch {
    // A stored review can be confirmed by the next same-origin read or submit.
  }
  return { kind: "unavailable" as const };
}

export function handleLessonFeedback(request: Request) {
  return handleMutationOperation(request, readLessonFeedbackOperation, {
    invalidInput: () => ({ kind: "unavailable" }),
    execute: ({ materialId }, token) =>
      runFeedbackRequest(requestLessonFeedback(materialId, token)),
  });
}

export function handleSubmitLessonFeedback(request: Request) {
  return handleMutationOperation(request, submitLessonFeedbackOperation, {
    invalidInput: () => ({ kind: "unavailable" }),
    execute: (input, token) =>
      runFeedbackRequest(requestSubmitLessonFeedback(input, token)),
  });
}
