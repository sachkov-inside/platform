import { z } from "zod";
import type { RepositoryOverview } from "../ports/repository-reader.js";

/**
 * Где проверять работу участника (#788): последний коммит основной ветки или голова открытого PR
 * из этого же репозитория. Если правдоподобных вариантов несколько, участник выбирает сам; помощник
 * не угадывает и не смешивает свидетельства разных вариантов.
 */
export const requestedCandidateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("default_branch") }),
  z.strictObject({
    kind: z.literal("pull_request"),
    number: z.number().int().positive().max(10_000_000),
  }),
]);
export type RequestedCandidate = z.infer<typeof requestedCandidateSchema>;

const commitShaSchema = z.hash("sha1");

export const reviewCandidateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("default_branch"),
    ref: z.string().min(1).max(255),
    commitSha: commitShaSchema,
  }),
  z.strictObject({
    kind: z.literal("pull_request"),
    number: z.number().int().positive(),
    title: z.string().max(500),
    ref: z.string().min(1).max(255),
    commitSha: commitShaSchema,
    baseRef: z.string().min(1).max(255),
    baseSha: commitShaSchema,
  }),
]);
export type ReviewCandidate = z.infer<typeof reviewCandidateSchema>;

export function candidatesOf(
  overview: RepositoryOverview,
): readonly ReviewCandidate[] {
  return [
    {
      kind: "default_branch",
      ref: overview.defaultBranch.name,
      commitSha: overview.defaultBranch.sha,
    },
    ...overview.pullRequests.map((pull): ReviewCandidate => ({
      kind: "pull_request",
      number: pull.number,
      title: pull.title.slice(0, 500),
      ref: pull.headRef,
      commitSha: pull.headSha,
      baseRef: pull.baseRef,
      baseSha: pull.baseSha,
    })),
  ];
}

export function candidateId(candidate: RequestedCandidate): string {
  return candidate.kind === "default_branch"
    ? "default_branch"
    : `pull_request:${String(candidate.number)}`;
}

export function requestOf(candidate: ReviewCandidate): RequestedCandidate {
  return candidate.kind === "default_branch"
    ? { kind: "default_branch" }
    : { kind: "pull_request", number: candidate.number };
}

/**
 * Вариант для проверки: названный участником, если он ещё существует, или единственный.
 * `undefined` — участнику нужно выбрать.
 */
export function selectCandidate(
  requested: RequestedCandidate | null,
  candidates: readonly ReviewCandidate[],
): ReviewCandidate | undefined {
  if (requested === null)
    return candidates.length === 1 ? candidates[0] : undefined;
  const id = candidateId(requested);
  return candidates.find(
    (candidate) => candidateId(requestOf(candidate)) === id,
  );
}

/** Как вариант назван участнику. */
export function candidateLabel(candidate: ReviewCandidate): string {
  return candidate.kind === "default_branch"
    ? `основная ветка ${candidate.ref}`
    : `PR #${String(candidate.number)} «${candidate.title}»`;
}
