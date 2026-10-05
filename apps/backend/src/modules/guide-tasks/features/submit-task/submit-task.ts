import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  submissionSourceSchema,
  taskCodeSchema,
  type SubmissionSource,
} from "../../domain/task-definition.js";

import { commandDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockGuideTaskSubmissions,
  type GuideTasksPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type { Subject } from "../../../content-access/index.js";
import {
  checkReportCoverage,
  FORM_REPORT_MAX_CHARACTERS,
  reviewReportSchema,
  serviceMarkSchema,
  SUBMISSION_NOTE_MAX_CHARACTERS,
  type ReviewReport,
  type ServiceMark,
} from "../../domain/review-report.js";
import {
  decideTaskAccess,
  findCurrentTask,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

/** Storage protection: an Account submits at most this many times per rolling hour. */
export const SUBMISSIONS_PER_HOUR = 20;
const SUBMISSION_WINDOW_MILLISECONDS = 60 * 60 * 1_000;

export const taskSubmissionSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    taskVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** One key per submission; a retry of the same content reuses it. */
    submissionKey: z.string().trim().min(1).max(200),
    reviewReport: reviewReportSchema,
    note: z.string().trim().max(SUBMISSION_NOTE_MAX_CHARACTERS),
    serviceMark: serviceMarkSchema.optional(),
  })
  .strict();

/**
 * A submission through the task page form (#947): the learner's note, an optional repository and
 * an optional report as plain text. No agent reviewed it, so it carries no criteria statuses, and
 * the learner never types a branch or a commit.
 */
export const formSubmissionSchema = z
  .object({
    code: taskCodeSchema,
    taskVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    submissionKey: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(SUBMISSION_NOTE_MAX_CHARACTERS),
    // The learner types this address, so the form accepts only a web address.
    repositoryUrl: z
      .url({ protocol: /^https?$/u })
      .max(500)
      .optional(),
    reportText: z
      .string()
      .trim()
      .min(1)
      .max(FORM_REPORT_MAX_CHARACTERS)
      .optional(),
  })
  .strict();

/** One submission whichever way it came: an agent over MCP or the learner through the form. */
interface SubmissionCommand {
  readonly code: string;
  readonly taskVersion: number;
  readonly submissionKey: string;
  readonly note: string;
  readonly reviewReport: ReviewReport | null;
  readonly reportText: string | null;
  readonly serviceMark: ServiceMark;
  /** What the replay fingerprint covers: the parsed body as the caller sent it. */
  readonly fingerprint: Readonly<Record<string, unknown>>;
}

function parseSubmission(
  source: SubmissionSource,
  submission: unknown,
): SubmissionCommand | null {
  if (source === "mcp") {
    const parsed = taskSubmissionSchema.safeParse(submission);
    return parsed.success
      ? {
          code: parsed.data.code,
          taskVersion: parsed.data.taskVersion,
          submissionKey: parsed.data.submissionKey,
          note: parsed.data.note,
          reviewReport: parsed.data.reviewReport,
          reportText: null,
          serviceMark: parsed.data.serviceMark ?? {},
          fingerprint: parsed.data,
        }
      : null;
  }
  const parsed = formSubmissionSchema.safeParse(submission);
  return parsed.success
    ? {
        code: parsed.data.code,
        taskVersion: parsed.data.taskVersion,
        submissionKey: parsed.data.submissionKey,
        note: parsed.data.note,
        reviewReport: null,
        reportText: parsed.data.reportText ?? null,
        serviceMark:
          parsed.data.repositoryUrl === undefined
            ? {}
            : { repositoryUrl: parsed.data.repositoryUrl },
        fingerprint: parsed.data,
      }
    : null;
}

export interface TaskSubmissionReceipt {
  readonly submissionId: string;
  readonly code: string;
  readonly taskVersion: number;
  readonly source: SubmissionSource;
  readonly submittedAt: string;
}

export type SubmitTaskError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "submissions_disabled" }
  | { readonly code: "task_not_available" }
  | {
      readonly code: "task_version_changed";
      readonly submittedVersion: number;
      readonly currentVersion: number;
    }
  | {
      readonly code: "report_coverage_mismatch";
      readonly missing: readonly string[];
      readonly unexpected: readonly string[];
      readonly duplicated: readonly string[];
    }
  | { readonly code: "submission_rate_limited" }
  | { readonly code: "idempotency_conflict" }
  | SystemError;

/**
 * Appends one submission of the subject against the task version its agent reviewed, or the version
 * the page form showed. Access is decided at every submission; an agent's report must cover every
 * criterion of that version and only them; a version that is no longer current is refused. The same submission key with the same content
 * answers with the first receipt; Platform never fetches the repository URL it stores.
 */
export async function submitTask(
  dependencies: LearningTaskDependencies,
  input: {
    readonly subject: Subject;
    readonly source: SubmissionSource;
    readonly submission: unknown;
  },
): Promise<Result<TaskSubmissionReceipt, SubmitTaskError>> {
  if (!dependencies.submissionsEnabled)
    return { ok: false, error: { code: "submissions_disabled" } };
  const command = parseSubmission(input.source, input.submission);
  if (command === null || input.subject.kind !== "account")
    return { ok: false, error: { code: "invalid_request_shape" } };
  const accountId = input.subject.accountId;
  const fingerprint = commandDigest({
    source: input.source,
    ...command.fingerprint,
  });
  const clock = dependencies.clock ?? (() => new Date());
  class Rollback extends Error {
    constructor(readonly submitError: SubmitTaskError) {
      super(submitError.code);
    }
  }
  try {
    const replayed = await replay(
      dependencies.prisma,
      accountId,
      command,
      fingerprint,
    );
    if (replayed !== undefined) return replayed;
    const known = await findCurrentTask(dependencies.prisma, command.code);
    if (known === null)
      return { ok: false, error: { code: "task_not_available" } };
    // Access is read before the transaction: it needs other connections.
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      input.subject,
      known.id,
      "guide_task_submit",
    );
    if (access === "unavailable")
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
    if (access === "closed")
      return { ok: false, error: { code: "task_not_available" } };
    const receipt = await dependencies.prisma.$transaction(
      async (transaction): Promise<TaskSubmissionReceipt> => {
        await lockGuideTaskSubmissions(transaction, accountId);
        const raced = await replay(
          transaction,
          accountId,
          command,
          fingerprint,
        );
        if (raced !== undefined) {
          if (raced.ok) return raced.value;
          throw new Rollback(raced.error);
        }
        const task = await findCurrentTask(transaction, command.code);
        if (task === null || task.id !== known.id)
          throw new Rollback({ code: "task_not_available" });
        if (task.version !== command.taskVersion)
          throw new Rollback({
            code: "task_version_changed",
            submittedVersion: command.taskVersion,
            currentVersion: task.version,
          });
        const coverage =
          command.reviewReport === null
            ? ({ covered: true } as const)
            : checkReportCoverage(command.reviewReport, task.definition);
        if (!coverage.covered)
          throw new Rollback({
            code: "report_coverage_mismatch",
            missing: coverage.missing,
            unexpected: coverage.unexpected,
            duplicated: coverage.duplicated,
          });
        const now = clock();
        const recent = await transaction.guideTaskSubmission.count({
          where: {
            accountId,
            submittedAt: {
              gt: new Date(now.getTime() - SUBMISSION_WINDOW_MILLISECONDS),
            },
          },
        });
        if (recent >= SUBMISSIONS_PER_HOUR)
          throw new Rollback({ code: "submission_rate_limited" });
        const id = randomUUID();
        await transaction.guideTaskSubmission.create({
          data: {
            id,
            accountId,
            taskId: task.id,
            taskVersion: task.version,
            submissionKey: command.submissionKey,
            requestFingerprint: fingerprint,
            source: input.source,
            ...(command.reviewReport === null
              ? {}
              : { reviewReport: command.reviewReport }),
            reportText: command.reportText,
            note: command.note,
            repositoryUrl: command.serviceMark.repositoryUrl ?? null,
            branch: command.serviceMark.branch ?? null,
            commitSha: command.serviceMark.commit ?? null,
            uncommittedChanges: command.serviceMark.uncommittedChanges ?? null,
            submittedAt: now,
          },
        });
        return {
          submissionId: id,
          code: task.code,
          taskVersion: task.version,
          source: input.source,
          submittedAt: now.toISOString(),
        };
      },
    );
    return { ok: true, value: receipt };
  } catch (error) {
    if (error instanceof Rollback)
      return { ok: false, error: error.submitError };
    return dependencyFailure(scope("submitTask"), error, systemFailure(error));
  }
}

/** The first answer to a repeated submission key, or a conflict when its content differs. */
async function replay(
  prisma: Pick<GuideTasksPrisma, "guideTaskSubmission" | "guideTask">,
  accountId: string,
  command: SubmissionCommand,
  fingerprint: string,
): Promise<Result<TaskSubmissionReceipt, SubmitTaskError> | undefined> {
  const previous = await prisma.guideTaskSubmission.findUnique({
    where: {
      accountId_submissionKey: {
        accountId,
        submissionKey: command.submissionKey,
      },
    },
  });
  if (previous === null) return undefined;
  if (previous.requestFingerprint !== fingerprint)
    return { ok: false, error: { code: "idempotency_conflict" } };
  return {
    ok: true,
    value: {
      submissionId: previous.id,
      code: command.code,
      taskVersion: previous.taskVersion,
      source: submissionSourceSchema.parse(previous.source),
      submittedAt: previous.submittedAt.toISOString(),
    },
  };
}
