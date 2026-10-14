// @ts-check
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  selectReleaseEvidence,
  completeReleaseEvidence,
  releaseCoverage,
} from "./release-source-evidence.mjs";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
function candidate() {
  return {
    provider: {
      id: 123,
      run_attempt: 1,
      repository: { full_name: "sachkov-inside/platform" },
      path: ".github/workflows/ci.yml",
      event: "merge_group",
      head_branch: "gh-readonly-queue/main/pr-1",
      head_sha: sha,
      status: "completed",
      conclusion: "success",
    },
    providerJobs: [
      {
        id: 1,
        run_id: 123,
        run_attempt: 1,
        head_sha: sha,
        name: "Unit tests",
        status: "completed",
        conclusion: "success",
      },
      {
        id: 2,
        run_id: 123,
        run_attempt: 1,
        head_sha: sha,
        name: "CI Gate",
        status: "completed",
        conclusion: "success",
      },
      {
        id: 3,
        run_id: 123,
        run_attempt: 1,
        head_sha: sha,
        name: "Coverage plan (isolated reruns)",
        status: "completed",
        conclusion: "success",
      },
    ],
    providerTreeSha: tree,
    evidence: {
      schemaVersion: 1,
      repository: "sachkov-inside/platform",
      sourceSha: sha,
      treeSha: tree,
      eventName: "merge_group",
      runId: "123",
      runAttempt: "1",
      selectedCoverage: ["unit"],
      successfulCoverage: ["unit"],
    },
  };
}
/** @param {unknown[]} candidates */
function select(candidates) {
  return selectReleaseEvidence({
    repository: "sachkov-inside/platform",
    sourceSha: "c".repeat(40),
    treeSha: tree,
    requiredCoverage: ["unit", "fullstack"],
    candidates,
  });
}
it("reuses proven synthetic queue tree correspondence and executes uncovered checks", () => {
  const result = select([candidate()]);
  assert.deepEqual(result.coveredCoverage, ["unit"]);
  assert.deepEqual(result.missingCoverage, ["fullstack"]);
  assert.equal(result.sourceSha, "c".repeat(40));
  assert.equal(result.evidenceRuns[0]?.runId, 123);
});
it("rejects wrong source, changed inputs, untrusted and incomplete runs", () => {
  /** @type {Array<(value: ReturnType<typeof candidate>) => void>} */
  const mutations = [
    (c) => {
      c.providerJobs = [];
    },
    (c) => {
      const job = c.providerJobs[0];
      if (job) job.conclusion = "skipped";
    },
    (c) => {
      const job = c.providerJobs[1];
      if (job) job.conclusion = "failure";
    },
    (c) => {
      const job = c.providerJobs[0];
      if (job) job.run_attempt = 2;
    },
    (c) => {
      const job = c.providerJobs[0];
      if (job) job.head_sha = "d".repeat(40);
    },
    (c) => {
      c.providerTreeSha = "d".repeat(40);
    },
    (c) => {
      c.evidence.sourceSha = "d".repeat(40);
    },
    (c) => {
      c.evidence.treeSha = "d".repeat(40);
    },
    (c) => {
      c.provider.event = "pull_request";
    },
    (c) => {
      c.provider.repository.full_name = "fork/platform";
    },
    (c) => {
      c.provider.path = ".github/workflows/other.yml";
    },
    (c) => {
      c.provider.conclusion = "failure";
    },
    (c) => {
      c.evidence.successfulCoverage = [];
    },
    (c) => {
      c.evidence.selectedCoverage.push("fullstack");
    },
  ];
  for (const mutate of mutations) {
    const c = candidate();
    mutate(c);
    assert.deepEqual(select([c]).missingCoverage, ["unit", "fullstack"]);
  }
});
it("does not infer coverage from ancestry or a green summary", () => {
  assert.deepEqual(select([]).missingCoverage, ["unit", "fullstack"]);
  assert.deepEqual(
    select([{ provider: candidate().provider }]).missingCoverage,
    ["unit", "fullstack"],
  );
});

it("requires the complete covered and successfully executed release complement", () => {
  const receipt = selectReleaseEvidence({
    repository: "sachkov-inside/platform",
    sourceSha: "c".repeat(40),
    treeSha: tree,
    requiredCoverage: releaseCoverage("platform"),
    candidates: [candidate()],
  });
  assert.deepEqual(
    completeReleaseEvidence(
      receipt,
      "success",
      "321",
      receipt.sourceSha,
      "platform",
    ).gapExecution.coverage,
    releaseCoverage("platform").filter((job) => job !== "unit"),
  );
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.throws(
      () =>
        completeReleaseEvidence(
          receipt,
          result,
          "321",
          receipt.sourceSha,
          "platform",
        ),
      /incomplete/,
    );
  }
  assert.throws(
    () =>
      completeReleaseEvidence(
        { ...receipt, missingCoverage: [] },
        "success",
        "321",
        receipt.sourceSha,
        "platform",
      ),
    /incomplete/,
  );
  assert.throws(
    () =>
      completeReleaseEvidence(
        {
          ...receipt,
          requiredCoverage: [],
          coveredCoverage: [],
          missingCoverage: [],
          evidenceRuns: [],
        },
        "success",
        "321",
        receipt.sourceSha,
        "platform",
      ),
    /incomplete/,
  );
  assert.throws(
    () => completeReleaseEvidence(receipt, "success", "321", sha, "platform"),
    /incomplete/,
  );
});
