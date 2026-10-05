import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";
import type {
  AuthorFeedback,
  SubmissionReviewDependencies,
} from "../../shared/submission-review-dependencies.js";

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
    const submission = await dependencies.prisma.guideTaskSubmission.findUnique(
      { where: { id: submissionId }, select: { id: true } },
    );
    if (submission === null)
      return { ok: false, error: { code: "submission_not_found" } };
    if (comment === null && !reviewed) {
      await dependencies.prisma.guideTaskAuthorFeedback.deleteMany({
        where: { submissionId },
      });
      return { ok: true, value: null };
    }
    const now = (dependencies.clock ?? (() => new Date()))();
    const stored = await dependencies.prisma.$transaction(
      async (transaction) => {
        await transaction.guideTaskAuthorFeedback.upsert({
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
          await transaction.guideTaskAuthorFeedback.updateMany({
            where: { submissionId, reviewedAt: null },
            data: { reviewedAt: now },
          });
        return transaction.guideTaskAuthorFeedback.findUniqueOrThrow({
          where: { submissionId },
        });
      },
    );
    return {
      ok: true,
      value: {
        comment: stored.comment,
        reviewedAt: stored.reviewedAt?.toISOString() ?? null,
        updatedAt: stored.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("saveAuthorFeedback"),
      error,
      systemFailure(error),
    );
  }
}
