import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestSaveAuthorTaskFeedback,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  saveAuthorFeedbackInputSchema,
  type SaveAuthorFeedbackResult,
} from "../model/author-feedback";
import { authorFeedbackSchema } from "../model/task-submissions";

const savedSchema = z
  .object({ authorFeedback: authorFeedbackSchema.nullable() })
  .strict();

/** `PUT /api/authoring/guide-tasks/feedback`: the author's comment and mark on one submission (#948). */
export function handleSaveAuthorFeedback(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(
    request,
    async (form, token): Promise<SaveAuthorFeedbackResult> => {
      const parsed = saveAuthorFeedbackInputSchema.safeParse({
        submissionId: form.get("submissionId"),
        comment: form.get("comment"),
        reviewed: form.get("reviewed"),
      });
      if (!parsed.success) return { kind: "invalid_input" };
      try {
        const result = await requestSaveAuthorTaskFeedback(
          parsed.data.submissionId,
          // The backend owns the trimming: a blank comment is no comment.
          { comment: parsed.data.comment, reviewed: parsed.data.reviewed },
          token,
        );
        if (result.ok) {
          const saved = savedSchema.safeParse(result.body);
          return saved.success
            ? { kind: "saved", authorFeedback: saved.data.authorFeedback }
            : { kind: "unavailable" };
        }
        switch (result.response.status) {
          case 400:
            return { kind: "invalid_input" };
          case 401:
            return { kind: "unauthorized" };
          case 403:
            return { kind: "forbidden" };
          case 404:
            return { kind: "submission_not_found" };
          default:
            return { kind: "unavailable" };
        }
      } catch (error) {
        if (error instanceof BackendConnectionError)
          return { kind: "unavailable" };
        throw error;
      }
    },
  );
}
