// @ts-check
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.iso.datetime();
export const docsContextSchema = z.object({
  version: z.literal(1),
  repository: z.string(),
  event: z.string(),
  sourceSha: sha,
  treeSha: sha,
  comparisonBase: sha,
  comparisonHash: hash,
  producerHash: hash,
  environmentHash: hash,
  trustedProducer: z.boolean(),
  environmentComplete: z.boolean(),
});
const job = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  run_id: z.number(),
  run_attempt: z.number(),
  head_sha: sha,
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: timestamp,
  completed_at: timestamp,
});
const artifact = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  digest: z.string(),
  zipHash: hash,
  expired: z.boolean(),
  size_in_bytes: z.number().int().nonnegative(),
  created_at: timestamp,
  expires_at: timestamp,
  workflow_run: z.object({ id: z.number(), head_sha: sha }),
});
const candidateSchema = z.object({
  run: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive(),
    repository: z.object({ full_name: z.string() }),
    head_repository: z.object({ full_name: z.string() }),
    path: z.string(),
    event: z.string(),
    head_sha: sha,
    status: z.string(),
    conclusion: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    pull_requests: z.array(
      z.object({
        base: z.object({ ref: z.string(), sha }),
        head: z.object({ sha }),
      }),
    ),
  }),
  jobs: z.array(job),
  headCommit: z.object({ sha, tree: z.object({ sha }) }),
  checkoutCommit: z.object({
    sha,
    tree: z.object({ sha }),
    parents: z.array(z.object({ sha })),
  }),
  docsArtifact: artifact,
  sourceArtifact: artifact,
  receipt: z.object({
    version: z.literal(1),
    mode: z.enum(["executed", "reused"]),
    runId: z.number(),
    runAttempt: z.number(),
    context: docsContextSchema,
    durationMs: z.number().nonnegative(),
  }),
  sourceEvidence: z.object({
    schemaVersion: z.literal(1),
    repository: z.string(),
    sourceSha: sha,
    treeSha: sha,
    eventName: z.string(),
    runId: z.union([z.number(), z.string()]),
    runAttempt: z.union([z.number(), z.string()]),
    selectedCoverage: z.array(z.string()),
    successfulCoverage: z.array(z.string()),
  }),
});
/**
 * Admission for the Node-only docs contract; every unverifiable input means fresh execution (#2266).
 * @param {{current:unknown,candidate:unknown,now:string}} input
 */
export function selectDocsEvidence(input) {
  const current = docsContextSchema.safeParse(input.current);
  const parsed = candidateSchema.safeParse(input.candidate);
  const clock = timestamp.safeParse(input.now);
  if (!current.success || !parsed.success || !clock.success)
    return { reused: false, reason: "incomplete-evidence" };
  const target = current.data;
  const {
    run,
    jobs,
    headCommit,
    checkoutCommit,
    receipt,
    docsArtifact,
    sourceArtifact,
    sourceEvidence,
  } = parsed.data;
  const source = receipt.context;
  if (
    target.event !== "merge_group" ||
    !target.trustedProducer ||
    !target.environmentComplete ||
    source.event !== "pull_request" ||
    !source.trustedProducer ||
    !source.environmentComplete ||
    receipt.mode !== "executed"
  )
    return { reused: false, reason: "unsupported-contract" };
  if (
    run.event !== "pull_request" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.repository.full_name !== target.repository ||
    run.head_repository.full_name !== target.repository ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    return { reused: false, reason: "provider-run" };
  if (
    run.pull_requests.length !== 1 ||
    run.pull_requests[0]?.base.ref !== "main" ||
    run.pull_requests[0].base.sha !== target.comparisonBase ||
    run.pull_requests[0].head.sha !== run.head_sha
  )
    return { reused: false, reason: "provider-pr" };
  for (const key of /** @type {const} */ ([
    "repository",
    "treeSha",
    "comparisonBase",
    "comparisonHash",
    "producerHash",
    "environmentHash",
  ])) {
    if (source[key] !== target[key])
      return { reused: false, reason: `different-${key}` };
  }
  if (
    receipt.runId !== run.id ||
    receipt.runAttempt !== run.run_attempt ||
    headCommit.sha !== run.head_sha ||
    headCommit.tree.sha !== target.treeSha ||
    checkoutCommit.sha !== source.sourceSha ||
    checkoutCommit.tree.sha !== target.treeSha ||
    checkoutCommit.parents.length !== 2 ||
    checkoutCommit.parents[0]?.sha !== target.comparisonBase ||
    checkoutCommit.parents[1]?.sha !== run.head_sha
  )
    return { reused: false, reason: "checkout-binding" };
  if (
    sourceEvidence.repository !== target.repository ||
    sourceEvidence.sourceSha !== source.sourceSha ||
    sourceEvidence.treeSha !== target.treeSha ||
    sourceEvidence.eventName !== run.event ||
    String(sourceEvidence.runId) !== String(run.id) ||
    String(sourceEvidence.runAttempt) !== String(run.run_attempt) ||
    sourceEvidence.selectedCoverage.join(",") !== "docs" ||
    sourceEvidence.successfulCoverage.join(",") !== "docs"
  )
    return { reused: false, reason: "coverage-binding" };
  const now = Date.parse(clock.data),
    start = Date.parse(run.created_at),
    end = Date.parse(run.updated_at);
  if (end < start || end > now || now - end > 24 * 60 * 60 * 1000)
    return { reused: false, reason: "stale-run" };
  /** @param {string} name */
  const requiredJob = (name) => {
    const matches = jobs.filter((item) => item.name === name);
    const selected = matches[0];
    return matches.length === 1 &&
      selected !== undefined &&
      selected.run_id === run.id &&
      selected.run_attempt === run.run_attempt &&
      selected.head_sha === run.head_sha &&
      selected.status === "completed" &&
      selected.conclusion === "success" &&
      Date.parse(selected.started_at) >= start &&
      Date.parse(selected.completed_at) >= Date.parse(selected.started_at) &&
      Date.parse(selected.completed_at) <= end
      ? selected
      : undefined;
  };
  const docs = requiredJob("Documentation contracts"),
    gate = requiredJob("CI Gate");
  if (
    docs === undefined ||
    gate === undefined ||
    requiredJob("Coverage plan (isolated reruns)") === undefined ||
    requiredJob("Secrets and production advisories") === undefined
  )
    return { reused: false, reason: "provider-jobs" };
  /** @param {z.infer<typeof artifact>} item @param {string} name @param {z.infer<typeof job>} producer */
  const validArtifact = (item, name, producer) =>
    !item.expired &&
    item.name === name &&
    item.digest === `sha256:${item.zipHash}` &&
    item.size_in_bytes <= 65536 &&
    item.workflow_run.id === run.id &&
    item.workflow_run.head_sha === run.head_sha &&
    Date.parse(item.expires_at) > now &&
    Date.parse(item.created_at) >= Date.parse(producer.started_at) &&
    Date.parse(item.created_at) <= Date.parse(producer.completed_at);
  if (
    !validArtifact(docsArtifact, `ci-docs-evidence-${run.run_attempt}`, docs) ||
    !validArtifact(
      sourceArtifact,
      `ci-source-evidence-${run.run_attempt}`,
      gate,
    ) ||
    docsArtifact.id === sourceArtifact.id
  )
    return { reused: false, reason: "artifact-provenance" };
  return {
    reused: true,
    runId: run.id,
    runAttempt: run.run_attempt,
    jobId: docs.id,
    artifactId: docsArtifact.id,
    sourceArtifactId: sourceArtifact.id,
    sourceSha: source.sourceSha,
    treeSha: target.treeSha,
    durationMs: receipt.durationMs,
  };
}
