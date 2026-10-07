import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  saveAuthorFeedbackResultSchema,
  type SaveAuthorFeedbackInput,
  type SaveAuthorFeedbackResult,
} from "../model/author-feedback";

export async function saveAuthorFeedback(
  input: SaveAuthorFeedbackInput,
): Promise<SaveAuthorFeedbackResult> {
  const form = new FormData();
  form.set("submissionId", input.submissionId);
  form.set("comment", input.comment);
  form.set("reviewed", String(input.reviewed));
  const response = await requestSameOriginMutation(
    "/api/authoring/product-tasks/feedback",
    "PUT",
    form,
  );
  if (!response.ok)
    return response.status === 401
      ? { kind: "unauthorized" }
      : { kind: "unavailable" };
  const parsed = saveAuthorFeedbackResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
