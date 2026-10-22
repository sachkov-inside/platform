import { z } from "zod";

import { authorFeedbackSchema } from "./task-submissions";

/** The backend owns the limit; the form uses it as a hint and a drift shows as `invalid_input`. */
export const AUTHOR_COMMENT_MAX_CHARACTERS = 4_000;

/**
 * One save of the author's comment and «посмотрел автор» on a submission (#948). Another field is
 * ignored, as the former form did.
 */
export const saveAuthorFeedbackInputSchema = z.object({
  submissionId: z.uuid(),
  // A CRLF line break counts as one character, as in the textarea and the backend.
  comment: z
    .string()
    .transform((value) => value.replace(/\r\n?/gu, "\n"))
    .pipe(z.string().max(AUTHOR_COMMENT_MAX_CHARACTERS)),
  reviewed: z.boolean(),
});

export interface SaveAuthorFeedbackInput {
  readonly submissionId: string;
  readonly comment: string;
  readonly reviewed: boolean;
}

export const saveAuthorFeedbackResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("saved"),
      authorFeedback: authorFeedbackSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("submission_not_found") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);

export type SaveAuthorFeedbackResult = z.infer<
  typeof saveAuthorFeedbackResultSchema
>;
