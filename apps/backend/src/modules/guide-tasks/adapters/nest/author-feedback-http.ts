import { z } from "zod";

import type { AuthorFeedback } from "../../shared/author-feedback.js";

/** Author Feedback as the author's «Сдачи» section reads it (#948). */
export const authorFeedbackHttpSchema = z
  .object({
    comment: z.string().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export function authorFeedbackHttp(
  feedback: AuthorFeedback,
): z.infer<typeof authorFeedbackHttpSchema> {
  return {
    comment: feedback.comment,
    reviewedAt: feedback.reviewedAt,
    updatedAt: feedback.updatedAt,
  };
}
