import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";
import type { SubmissionReviewDependencies } from "../../shared/submission-review-dependencies.js";

/** Products with submissions of one Account; more is refused rather than cut. */
const PRODUCTS_LIMIT = 1000;

/** Submissions of one Account in one Product: no person data, the card already names the person. */
export interface AccountSubmissionsSummary {
  readonly productId: string;
  readonly count: number;
  readonly lastSubmission: {
    readonly submissionId: string;
    readonly submittedAt: string;
    readonly taskCode: string;
  };
}

export type SummarizeAccountSubmissionsError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | SystemError;

export type SummarizeAccountSubmissionsResult = Result<
  readonly AccountSubmissionsSummary[],
  SummarizeAccountSubmissionsError
>;

const rowSchema = z.object({
  productId: z.uuid(),
  count: z.number().int().positive(),
  submissionId: z.uuid(),
  submittedAt: z.date(),
  taskCode: z.string(),
});

/**
 * The person card's submissions block: per Product the number of submissions of one Account and
 * its latest one, ascending by Product ID. Requires `materials:manage`, as the author's list does;
 * another Account is refused rather than answered with nothing.
 */
export async function summarizeAccountSubmissions(
  dependencies: Pick<SubmissionReviewDependencies, "prisma" | "authorPolicy">,
  actorId: string,
  accountId: string,
): Promise<SummarizeAccountSubmissionsResult> {
  const target = z.uuid().toLowerCase().safeParse(accountId);
  if (!target.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    if (!(await dependencies.authorPolicy.canManage(actorId)))
      return { ok: false, error: { code: "forbidden" } };
    const rows: unknown = await dependencies.prisma.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON (t.product_id)
        t.product_id::text AS "productId",
        (count(*) OVER (PARTITION BY t.product_id))::int AS count,
        s.id::text AS "submissionId",
        s.submitted_at AS "submittedAt",
        t.code AS "taskCode"
      FROM product_tasks.submissions s
      JOIN product_tasks.tasks t ON t.id = s.task_id
      WHERE s.account_id = ${target.data}::uuid
      ORDER BY t.product_id, s.submitted_at DESC, s.id DESC
      LIMIT ${PRODUCTS_LIMIT + 1}
    `);
    const parsed = z.array(rowSchema).parse(rows);
    if (parsed.length > PRODUCTS_LIMIT)
      return dependencyFailure(
        scope("summarizeAccountSubmissions"),
        new RangeError("Account submissions span more Products than bounded"),
        systemFailure(null),
      );
    return {
      ok: true,
      value: parsed.map((row) => ({
        productId: row.productId,
        count: row.count,
        lastSubmission: {
          submissionId: row.submissionId,
          submittedAt: row.submittedAt.toISOString(),
          taskCode: row.taskCode,
        },
      })),
    };
  } catch (error) {
    return dependencyFailure(
      scope("summarizeAccountSubmissions"),
      error,
      systemFailure(error),
    );
  }
}
