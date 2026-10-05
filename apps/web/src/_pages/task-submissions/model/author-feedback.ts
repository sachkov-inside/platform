import { z } from "zod";

import { authorFeedbackSchema } from "./task-submissions";

/** The backend owns the limit; the form uses it as a hint and a drift shows as `invalid_input`. */
export const AUTHOR_COMMENT_MAX_CHARACTERS = 4_000;

/** One save of the author's comment and «посмотрел автор» on a submission (#948). */
export const saveAuthorFeedbackInputSchema = z
  .object({
    submissionId: z.uuid(),
    // A multipart form sends a line break as CRLF; the textarea and the backend count one character.
    comment: z
      .string()
      .transform((value) => value.replace(/\r\n?/gu, "\n"))
      .pipe(z.string().max(AUTHOR_COMMENT_MAX_CHARACTERS)),
    reviewed: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();

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
