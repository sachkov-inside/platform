// @ts-check
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/** @param {string} application */
export function releaseCoverage(application) {
  if (application === "platform")
    return [
      "static",
      "unit",
      "ui",
      "web-e2e",
      "integration",
      "integration-serial",
      "compose-development",
      "compose-production",
      "fullstack",
      "contracts",
    ];
  if (application === "telegram")
    return ["static", "unit", "telegram", "contracts"];
  throw new Error("unknown release application");
}
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const coverage = z.array(z.string());
const candidateSchema = z.object({
  provider: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive(),
    repository: z.object({ full_name: z.string() }),
    path: z.string(),
    event: z.string(),
    head_branch: z.string().nullable(),
    head_sha: sha,
    status: z.string(),
    conclusion: z.string().nullable(),
  }),
  providerTreeSha: sha,
  evidence: z.object({
    schemaVersion: z.literal(1),
    repository: z.string(),
    sourceSha: sha,
    treeSha: sha,
    eventName: z.string(),
    runId: z.union([z.string(), z.number()]),
    runAttempt: z.union([z.string(), z.number()]),
    selectedCoverage: coverage,
    successfulCoverage: coverage,
  }),
});
const inputSchema = z.object({
  repository: z.string(),
  sourceSha: sha,
  treeSha: sha,
  requiredCoverage: coverage,
  candidates: z.array(z.unknown()),
});

/** @param {unknown} value */
export function selectReleaseEvidence(value) {
  const input = inputSchema.parse(value);
  const covered = new Set();
  const evidenceRuns = [];
  for (const value of input.candidates) {
    const parsed = candidateSchema.safeParse(value);
    if (!parsed.success) continue;
    const { provider: run, providerTreeSha, evidence } = parsed.data;
    const trustedEvent =
      (run.event === "merge_group" &&
        run.head_branch?.startsWith("gh-readonly-queue/main/")) ||
      (run.event === "push" && run.head_branch === "main");
    if (
      !trustedEvent ||
      run.repository.full_name !== input.repository ||
      run.path !== ".github/workflows/ci.yml" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      evidence.repository !== input.repository ||
      evidence.sourceSha !== run.head_sha ||
      evidence.eventName !== run.event ||
      String(evidence.runId) !== String(run.id) ||
      String(evidence.runAttempt) !== String(run.run_attempt) ||
      evidence.treeSha !== providerTreeSha ||
      providerTreeSha !== input.treeSha ||
      evidence.selectedCoverage.some(
        (job) => !evidence.successfulCoverage.includes(job),
      ) ||
      evidence.successfulCoverage.some(
        (job) => !evidence.selectedCoverage.includes(job),
      )
    )
      continue;
    const reusedCoverage = input.requiredCoverage.filter((job) =>
      evidence.successfulCoverage.includes(job),
    );
    if (reusedCoverage.length === 0) continue;
    for (const job of reusedCoverage) covered.add(job);
    evidenceRuns.push({
      runId: run.id,
      runAttempt: run.run_attempt,
      sourceSha: run.head_sha,
      treeSha: providerTreeSha,
      coverage: reusedCoverage,
    });
  }
  return {
    schemaVersion: 1,
    repository: input.repository,
    sourceSha: input.sourceSha,
    treeSha: input.treeSha,
    requiredCoverage: input.requiredCoverage,
    coveredCoverage: input.requiredCoverage.filter((job) => covered.has(job)),
    missingCoverage: input.requiredCoverage.filter((job) => !covered.has(job)),
    evidenceRuns,
  };
}
const receiptSchema = inputSchema.omit({ candidates: true }).extend({
  schemaVersion: z.literal(1),
  coveredCoverage: coverage,
  missingCoverage: coverage,
  evidenceRuns: z.array(
    z.object({
      runId: z.number(),
      runAttempt: z.number(),
      sourceSha: sha,
      treeSha: sha,
      coverage,
    }),
  ),
});
/** @param {unknown} value @param {string} result @param {string} runId @param {string} sourceSha @param {string} application */
export function completeReleaseEvidence(
  value,
  result,
  runId,
  sourceSha,
  application,
) {
  const receipt = receiptSchema.parse(value);
  const required = releaseCoverage(application);
  if (
    required.length !== receipt.requiredCoverage.length ||
    required.some((job) => !receipt.requiredCoverage.includes(job)) ||
    result !== "success" ||
    receipt.sourceSha !== sourceSha ||
    receipt.requiredCoverage.some(
      (job) =>
        receipt.coveredCoverage.includes(job) ===
        receipt.missingCoverage.includes(job),
    ) ||
    [...receipt.coveredCoverage, ...receipt.missingCoverage].some(
      (job) => !receipt.requiredCoverage.includes(job),
    ) ||
    receipt.coveredCoverage.some(
      (job) =>
        !receipt.evidenceRuns.some(
          (run) =>
            run.treeSha === receipt.treeSha && run.coverage.includes(job),
        ),
    )
  ) {
    throw new Error(
      "release coverage is incomplete or does not bind the captured source",
    );
  }
  return {
    ...receipt,
    gapExecution: {
      workflowRunId: runId,
      sourceSha,
      coverage: receipt.missingCoverage,
      result,
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv[2] === "requirements") {
      process.stdout.write(
        `${JSON.stringify(releaseCoverage(process.env["RELEASE_APPLICATION"] ?? ""))}\n`,
      );
    } else {
      const value = /** @type {unknown} */ (
        JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"))
      );
      const output =
        process.argv[3] === "complete"
          ? completeReleaseEvidence(
              value,
              process.env["CI_RESULT"] ?? "",
              process.env["GITHUB_RUN_ID"] ?? "",
              process.env["SOURCE_SHA"] ?? "",
              process.env["RELEASE_APPLICATION"] ?? "",
            )
          : selectReleaseEvidence(value);
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
