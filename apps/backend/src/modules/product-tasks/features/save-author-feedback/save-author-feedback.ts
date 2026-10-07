import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";
import {
  authorFeedbackOf,
  type AuthorFeedback,
} from "../../shared/author-feedback.js";
import type { SubmissionReviewDependencies } from "../../shared/submission-review-dependencies.js";

export const AUTHOR_COMMENT_MAX_CHARACTERS = 4_000;

export const authorFeedbackBodySchema = z
  .object({
    comment: z.string().max(AUTHOR_COMMENT_MAX_CHARACTERS).nullable(),
    reviewed: z.boolean(),
  })
  .strict();

const saveAuthorFeedbackSchema = authorFeedbackBodySchema
  .extend({ submissionId: z.uuid() })
  .strict();

export type SaveAuthorFeedbackError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | { readonly code: "submission_not_found" }
  | SystemError;

/**
 * The author's comment and «посмотрел автор» on one submission (#948): one Author Feedback per
 * submission that the author may change. The mark keeps the time it was first set until the author
 * removes it. Without a comment and the mark nothing is stored, so the learner reads «not yet».
 */
export async function saveAuthorFeedback(
  dependencies: SubmissionReviewDependencies,
  actorId: string,
  input: unknown,
): Promise<Result<AuthorFeedback | null, SaveAuthorFeedbackError>> {
  const parsed = saveAuthorFeedbackSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  const trimmed = parsed.data.comment?.trim() ?? "";
  const comment = trimmed === "" ? null : trimmed;
  const { submissionId, reviewed } = parsed.data;
  try {
    if (!(await dependencies.authorPolicy.canManage(actorId)))
      return { ok: false, error: { code: "forbidden" } };
    const submission =
      await dependencies.prisma.productTaskSubmission.findUnique({
        where: { id: submissionId },
        select: { id: true },
      });
    if (submission === null)
      return { ok: false, error: { code: "submission_not_found" } };
    const now = (dependencies.clock ?? (() => new Date()))();
    const stored = await dependencies.prisma.$transaction(
      async (transaction) => {
        if (comment === null && !reviewed) {
          await transaction.productTaskAuthorFeedback.deleteMany({
            where: { submissionId },
          });
          return null;
        }
        await transaction.productTaskAuthorFeedback.upsert({
          where: { submissionId },
          create: {
            submissionId,
            comment,
            reviewedAt: reviewed ? now : null,
            updatedBy: actorId,
            updatedAt: now,
          },
          update: {
            comment,
            ...(reviewed ? {} : { reviewedAt: null }),
            updatedBy: actorId,
            updatedAt: now,
          },
        });
        // A conditional write: an existing mark keeps the time it was first set, even when two
        // authors save at once.
        if (reviewed)
          await transaction.productTaskAuthorFeedback.updateMany({
            where: { submissionId, reviewedAt: null },
            data: { reviewedAt: now },
          });
        return transaction.productTaskAuthorFeedback.findUniqueOrThrow({
          where: { submissionId },
        });
      },
    );
    return {
      ok: true,
      value: stored === null ? null : authorFeedbackOf(stored),
    };
  } catch (error) {
    return dependencyFailure(
      scope("saveAuthorFeedback"),
      error,
      systemFailure(error),
    );
  }
}
