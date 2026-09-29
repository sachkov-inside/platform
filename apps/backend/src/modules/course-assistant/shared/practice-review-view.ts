import { z } from "zod";
import {
  compareWithPreviousReview,
  criterionStatuses,
  storedPracticeReviewReportSchema,
  reviewStates,
  type PracticeReviewReport,
  type ReviewState,
} from "../domain/practice-review.js";
import { repositoryHtmlUrl } from "../domain/repository-link.js";
import {
  candidateId,
  candidateLabel,
  requestOf,
  reviewCandidateSchema,
  type ReviewCandidate,
} from "../domain/review-candidate.js";

export const reviewFailureCodes = [
  "context_version_mismatch",
  "practice_unavailable",
  "repository_access_revoked",
  "repository_too_large",
  "invalid_report",
  "limit_exceeded",
  "model_unavailable",
  "dependency_unavailable",
  "interrupted",
] as const;
export type ReviewFailureCode = (typeof reviewFailureCodes)[number];

export const reviewFailureSchema = z.strictObject({
  code: z.enum(reviewFailureCodes),
  currentContextVersion: z.hash("sha256").nullable(),
});
export type ReviewFailure = z.infer<typeof reviewFailureSchema>;

const candidateViewSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["default_branch", "pull_request"]),
  label: z.string(),
  ref: z.string(),
  commitSha: z.hash("sha1"),
  url: z.url(),
});

export const practiceReviewViewSchema = z.strictObject({
  id: z.uuid(),
  practiceId: z.string(),
  kind: z.enum(["initial", "recheck"]),
  state: z.enum(reviewStates),
  contextVersion: z.hash("sha256"),
  repository: z.strictObject({ fullName: z.string(), htmlUrl: z.url() }),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  candidates: z.array(candidateViewSchema).nullable(),
  checked: candidateViewSchema.nullable(),
  result: z
    .strictObject({
      practiceStatus: z.enum(["accepted", "needs_work"]),
      summary: z.string(),
      criteria: z.array(
        z.strictObject({
          criterionId: z.string(),
          status: z.enum(criterionStatuses),
          evidence: z.array(
            z.strictObject({
              path: z.string(),
              startLine: z.number().int().nullable(),
              endLine: z.number().int().nullable(),
              url: z.url(),
            }),
          ),
          explanation: z.string(),
          nextStep: z.string().nullable(),
          previousStatus: z.enum(criterionStatuses).nullable(),
          changed: z.boolean(),
        }),
      ),
    })
    .nullable(),
  previousReviewId: z.uuid().nullable(),
  failure: reviewFailureSchema.nullable(),
});
export type PracticeReviewView = z.infer<typeof practiceReviewViewSchema>;

/** Строка проверки из базы: JSON-поля ещё не проверены. */
export interface PracticeReviewRow {
  readonly id: string;
  readonly practiceId: string;
  readonly kind: string;
  readonly state: string;
  readonly contextVersion: string;
  readonly repositoryFullName: string;
  readonly candidates: unknown;
  readonly checkedCandidate: unknown;
  readonly report: unknown;
  readonly practiceStatus: string | null;
  readonly previousReviewId: string | null;
  readonly failure: unknown;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
}

export const practiceReviewRowSelect = {
  id: true,
  practiceId: true,
  kind: true,
  state: true,
  contextVersion: true,
  repositoryFullName: true,
  candidates: true,
  checkedCandidate: true,
  report: true,
  practiceStatus: true,
  previousReviewId: true,
  failure: true,
  requestedAt: true,
  completedAt: true,
} as const;

const candidatesSchema = z.array(reviewCandidateSchema);

/** Отчёт, сохранённый сервером после проверки по схеме задания. */
export function storedReport(value: unknown): PracticeReviewReport | null {
  return value === null ? null : storedPracticeReviewReportSchema.parse(value);
}

export function toPracticeReviewView(
  row: PracticeReviewRow,
  previousReport: PracticeReviewReport | null,
): PracticeReviewView {
  const repositoryUrl = repositoryHtmlUrl(row.repositoryFullName);
  const candidates =
    row.candidates === null ? null : candidatesSchema.parse(row.candidates);
  const checked =
    row.checkedCandidate === null
      ? null
      : reviewCandidateSchema.parse(row.checkedCandidate);
  const report = storedReport(row.report);
  const changes =
    report === null
      ? []
      : compareWithPreviousReview(
          previousReport ?? { summary: "", criteria: [] },
          report,
        );
  return {
    id: row.id,
    practiceId: row.practiceId,
    kind: row.kind === "recheck" ? "recheck" : "initial",
    state: z.enum(reviewStates).parse(row.state) satisfies ReviewState,
    contextVersion: row.contextVersion,
    repository: { fullName: row.repositoryFullName, htmlUrl: repositoryUrl },
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    candidates:
      candidates?.map((candidate) => candidateView(repositoryUrl, candidate)) ??
      null,
    checked: checked === null ? null : candidateView(repositoryUrl, checked),
    result:
      report === null || checked === null
        ? null
        : {
            practiceStatus:
              row.practiceStatus === "accepted" ? "accepted" : "needs_work",
            summary: report.summary,
            criteria: report.criteria.map((criterion, index) => ({
              criterionId: criterion.criterionId,
              status: criterion.status,
              evidence: criterion.evidence.map((evidence) => ({
                ...evidence,
                url: evidenceUrl(repositoryUrl, checked.commitSha, evidence),
              })),
              explanation: criterion.explanation,
              nextStep: criterion.nextStep,
              previousStatus:
                previousReport === null
                  ? null
                  : (changes[index]?.previousStatus ?? null),
              changed:
                previousReport !== null && (changes[index]?.changed ?? false),
            })),
          },
    previousReviewId: row.previousReviewId,
    failure:
      row.failure === null ? null : reviewFailureSchema.parse(row.failure),
  };
}

function candidateView(repositoryUrl: string, candidate: ReviewCandidate) {
  return {
    id: candidateId(requestOf(candidate)),
    kind: candidate.kind,
    label: candidateLabel(candidate),
    ref: candidate.ref,
    commitSha: candidate.commitSha,
    url:
      candidate.kind === "pull_request"
        ? `${repositoryUrl}/pull/${String(candidate.number)}`
        : `${repositoryUrl}/tree/${candidate.commitSha}`,
  };
}

function evidenceUrl(
  repositoryUrl: string,
  commitSha: string,
  evidence: {
    readonly path: string;
    readonly startLine: number | null;
    readonly endLine: number | null;
  },
): string {
  const path = evidence.path.split("/").map(encodeURIComponent).join("/");
  const lines =
    evidence.startLine === null
      ? ""
      : evidence.endLine === null || evidence.endLine === evidence.startLine
        ? `#L${String(evidence.startLine)}`
        : `#L${String(evidence.startLine)}-L${String(evidence.endLine)}`;
  return `${repositoryUrl}/blob/${commitSha}/${path}${lines}`;
}
