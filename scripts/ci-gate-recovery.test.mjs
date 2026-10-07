// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ci = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const requiredNames = [...ci.matchAll(/^ {4}name: (.+)$/gmu)]
  .map(([, name]) => name)
  .filter((name) => name !== "CI Gate");
// Metadata from run 37642003271, attempt 1 (#1085); job names follow current CI.
const run = {
  id: 37642003271,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  status: "completed",
  conclusion: "failure",
  run_attempt: 1,
  workflow_id: 348286291,
  head_branch: "feat/1064-unpaid-access",
};
const jobs = requiredNames.map((name) => ({
  name,
  status: "completed",
  conclusion: "success",
}));

/**
 * @param {{ run?: Partial<typeof run>, jobs?: typeof jobs, changedBeforeWrite?: boolean, newerRun?: boolean, rejectWrite?: boolean }} [scenario]
 * @param {boolean} [shouldRerun]
 */
function replay(scenario = {}, shouldRerun = false) {
  const recovery = readFileSync(
    new URL("../.github/workflows/ci-gate-recovery.yml", import.meta.url),
    "utf8",
  );
  const script = recovery.split("          script: |\n")[1];
  assert.ok(script);
  const program = `
    import assert from "node:assert/strict";
    const scenario = JSON.parse(process.env.SCENARIO);
    const run = ${JSON.stringify(run)};
    Object.assign(run, scenario.run);
    const jobs = scenario.jobs ?? ${JSON.stringify(jobs)};
    let reads = 0;
    let writes = 0;
    const context = { repo: { owner: "sachkov-inside", repo: "platform" }, payload: { workflow_run: { ...run } } };
    const core = { info() {}, warning() {} };
    const github = {
      rest: { actions: {
        async getWorkflowRun(input) {
          assert.equal(input.run_id, run.id);
          reads++;
          return { data: scenario.changedBeforeWrite && reads > 1 ? { ...run, run_attempt: 2, status: "queued" } : run };
        },
        listJobsForWorkflowRunAttempt() {},
        async listWorkflowRuns(input) {
          assert.equal(input.workflow_id, run.workflow_id);
          assert.equal(input.branch, run.head_branch);
          assert.equal(input.event, run.event);
          return { data: { workflow_runs: [{ id: scenario.newerRun ? run.id + 1 : run.id }] } };
        },
        async reRunWorkflow(input) {
          writes++;
          assert.equal(input.run_id, run.id);
          assert.equal(input.request.retries, 0);
          if (scenario.rejectWrite) throw new Error("GitHub HTTP 500");
        },
      } },
      async paginate(method, input) {
        assert.equal(method, github.rest.actions.listJobsForWorkflowRunAttempt);
        assert.equal(input.attempt_number, 1);
        assert.equal(input.run_id, run.id);
        return jobs;
      },
    };
    try {
      await (async () => { ${script.replace(/^ {12}/gmu, "")} })();
      assert.equal(scenario.rejectWrite, undefined, "API write failure must stay visible");
    } catch (error) {
      if (!scenario.rejectWrite) throw error;
      assert.match(error.message, /GitHub HTTP 500/);
    }
    assert.equal(writes, ${shouldRerun ? 1 : 0});
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      env: { ...process.env, SCENARIO: JSON.stringify(scenario) },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
}

describe("missing CI Gate recovery", () => {
  it("replays the nine-success, absent-gate failure for PRs and the merge queue", () => {
    replay({}, true);
    replay({ run: { event: "merge_group" } }, true);
  });

  it("does not retry failed, cancelled, skipped, unfinished or missing prerequisites", () => {
    for (const index of jobs.keys()) {
      for (const conclusion of ["failure", "cancelled", "skipped", ""]) {
        replay({
          jobs: jobs.map((job, i) =>
            i === index ? { ...job, conclusion } : job,
          ),
        });
      }
    }
    replay({ jobs: jobs.slice(1) });
    replay({
      jobs: jobs.map((job, i) =>
        i === 0 ? { ...job, status: "in_progress" } : job,
      ),
    });
    replay({
      jobs: [
        ...jobs,
        { name: "Unexpected job", status: "completed", conclusion: "success" },
      ],
    });
    replay({ jobs: jobs.map((job, i) => (i === 0 ? (jobs[1] ?? job) : job)) });
  });

  it("does not retry any created gate, even a failing gate", () => {
    for (const conclusion of ["success", "failure", "cancelled", "skipped"]) {
      replay({
        jobs: [...jobs, { name: "CI Gate", status: "completed", conclusion }],
      });
    }
  });

  it("leaves old workflow revisions without isolated reruns to manual recovery", () => {
    replay({
      jobs: jobs.map((job) =>
        job.name === "Static checks (isolated reruns)"
          ? { ...job, name: "Static checks" }
          : job,
      ),
    });
  });

  it("rejects other workflows, release calls, successful runs and subsequent attempts", () => {
    for (const change of [
      { path: ".github/workflows/release.yml" },
      { event: "workflow_dispatch" },
      { event: "push" },
      { conclusion: "success" },
      { conclusion: "cancelled" },
      { status: "in_progress" },
      { run_attempt: 2 },
    ])
      replay({ run: change });
    replay({ changedBeforeWrite: true });
    replay({ newerRun: true });
  });

  it("sends one write without retries and exposes an ambiguous GitHub write failure", () => {
    replay({ rejectWrite: true }, true);
  });

  it("keeps privileged recovery isolated from pull-request code and gate publication", () => {
    const recovery = readFileSync(
      new URL("../.github/workflows/ci-gate-recovery.yml", import.meta.url),
      "utf8",
    );
    assert.match(
      recovery,
      /workflow_run:\n {4}workflows: \[Application CI\]\n {4}types: \[completed\]/u,
    );
    assert.match(recovery, /permissions:\n {2}actions: write/u);
    assert.match(
      recovery,
      /group: platform-ci-gate-recovery-\$\{\{ github\.event\.workflow_run\.id \}\}/u,
    );
    assert.match(recovery, /cancel-in-progress: false/u);
    assert.match(
      recovery,
      /uses: actions\/github-script@[a-f0-9]{40} # v9\.\d+\.\d+/u,
    );
    assert.match(recovery, /retries: 3/u);
    assert.doesNotMatch(
      recovery,
      /checkout|secrets\.|checks: write|statuses: write|issues: write|contents: write|downloadArtifact/u,
    );
    const script = recovery.split("          script: |\n")[1];
    assert.ok(script);
    assert.doesNotMatch(script, /\$\{\{/u);
  });
});
