import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestSaveAuthorTaskFeedback,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import type { SaveAuthorFeedbackResult } from "../model/author-feedback";
import { authorFeedbackSchema } from "../model/task-submissions";
import { saveAuthorFeedbackOperation } from "./save-author-feedback.operation";

const savedSchema = z
  .object({ authorFeedback: authorFeedbackSchema.nullable() })
  .strict();

/** `PUT /api/authoring/product-tasks/feedback`: the author's comment and mark on one submission (#948). */
export function handleSaveAuthorFeedback(request: Request): Promise<Response> {
  return handleMutationOperation(request, saveAuthorFeedbackOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token): Promise<SaveAuthorFeedbackResult> => {
      try {
        const result = await requestSaveAuthorTaskFeedback(
          input.submissionId,
          // The backend owns the trimming: a blank comment is no comment.
          { comment: input.comment, reviewed: input.reviewed },
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
  });
}
