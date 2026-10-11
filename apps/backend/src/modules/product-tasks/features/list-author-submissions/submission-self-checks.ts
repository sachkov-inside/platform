import type { ProductTasksPrisma } from "../../../../infrastructure/prisma/index.js";
import { reviewReportSchema } from "../../domain/review-report.js";
import { taskDefinitionSchema } from "../../domain/task-definition.js";

/** A summary of the learner agent's saved statements, never an independent Platform review. */
export interface SubmissionSelfCheck {
  readonly outcome: "passed" | "changes" | "missing";
  readonly attempt: number;
  readonly firstPassedAttempt: number | null;
}

export interface SavedCheck {
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly taskVersion: number;
  readonly summary: string | null;
  readonly selfCheck: SubmissionSelfCheck;
}

export function checksKey(row: {
  readonly taskId: string;
  readonly accountId: string;
}): string {
  return `${row.taskId}:${row.accountId}`;
}

/**
 * Read each listed learner/task's complete saved history before assigning numbers. List cursors,
 * forms and transport retries cannot change numbering; immutable versions own required criteria.
 */
export async function submissionSelfChecks(
  prisma: ProductTasksPrisma,
  page: readonly { readonly taskId: string; readonly accountId: string }[],
) {
  const pairs = [
    ...new Map(
      page.map((row) => [
        checksKey(row),
        { taskId: row.taskId, accountId: row.accountId },
      ]),
    ).values(),
  ];
  const history = new Map<string, SavedCheck[]>();
  const bySubmission = new Map<string, SubmissionSelfCheck>();
  if (pairs.length === 0) return { history, bySubmission };
  const rows = await prisma.productTaskSubmission.findMany({
    where: { OR: pairs, source: "mcp" },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      taskId: true,
      accountId: true,
      taskVersion: true,
      submittedAt: true,
      reviewReport: true,
    },
  });
  const versionKeys = [
    ...new Map(
      rows.map((row) => [
        `${row.taskId}:${String(row.taskVersion)}`,
        { taskId: row.taskId, version: row.taskVersion },
      ]),
    ).values(),
  ];
  const versions =
    versionKeys.length === 0
      ? []
      : await prisma.productTaskVersion.findMany({
          where: { OR: versionKeys },
        });
  const criteriaOf = new Map(
    versions.map((version) => [
      `${version.taskId}:${String(version.version)}`,
      taskDefinitionSchema.parse(version.definition).criteria,
    ]),
  );
  for (const row of rows) {
    if (row.reviewReport === null) continue;
    const report = reviewReportSchema.parse(row.reviewReport);
    const criteria = criteriaOf.get(`${row.taskId}:${String(row.taskVersion)}`);
    if (criteria === undefined)
      throw new Error("A saved check refers to an unknown task version");
    const statuses = new Map(
      report.criteria.map((criterion) => [
        criterion.criterionId,
        criterion.status,
      ]),
    );
    const required = criteria.filter(
      (criterion) => criterion.level === "required",
    );
    const outcome = required.some(
      (criterion) => statuses.get(criterion.id) === "violation",
    )
      ? "changes"
      : required.every(
            (criterion) => statuses.get(criterion.id) === "confirmed",
          )
        ? "passed"
        : "missing";
    const key = checksKey(row);
    const checks = history.get(key) ?? [];
    checks.push({
      submissionId: row.id,
      submittedAt: row.submittedAt.toISOString(),
      taskVersion: row.taskVersion,
      summary: report.summary ?? null,
      selfCheck: {
        outcome,
        attempt: checks.length + 1,
        firstPassedAttempt: null,
      },
    });
    history.set(key, checks);
  }
  for (const [key, checks] of history) {
    const firstPassedAttempt =
      checks.find((check) => check.selfCheck.outcome === "passed")?.selfCheck
        .attempt ?? null;
    const complete = checks.map((check) => ({
      ...check,
      selfCheck: { ...check.selfCheck, firstPassedAttempt },
    }));
    for (const check of complete)
      bySubmission.set(check.submissionId, check.selfCheck);
    history.set(key, complete.reverse());
  }
  return { history, bySubmission };
}
