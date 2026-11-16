// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { execute, lookupDocsEvidence, runDocsCI } from "./ci-docs-run.mjs";
import { selectDocsEvidence } from "./ci-docs-evidence.mjs";

/** @template T @param {T[]} values @param {number} index @returns {T} */
function at(values, index) {
  const value = values[index];
  if (value === undefined) throw new Error("Missing test fixture item");
  return value;
}
/** @template T @param {T[]} values */
const first = (values) => at(values, 0);

const sha = "a".repeat(40),
  tree = "b".repeat(40),
  base = "c".repeat(40),
  hash = "d".repeat(64);
const context = {
  version: /** @type {const} */ (1),
  repository: "owner/repo",
  event: "merge_group",
  sourceSha: sha,
  treeSha: tree,
  comparisonBase: base,
  comparisonHash: hash,
  producerHash: hash,
  environmentHash: hash,
  trustedProducer: true,
  environmentComplete: true,
};
const run = {
  id: 10,
  run_attempt: 1,
  repository: { full_name: "owner/repo" },
  head_repository: { full_name: "owner/repo" },
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  head_sha: "e".repeat(40),
  status: "completed",
  conclusion: "success",
  created_at: "2026-11-16T10:00:00Z",
  updated_at: "2026-11-16T10:10:00Z",
  pull_requests: [
    { base: { ref: "main", sha: base }, head: { sha: "e".repeat(40) } },
  ],
};
const jobs = [
  "Coverage plan (isolated reruns)",
  "Documentation contracts",
  "CI Gate",
  "Secrets and production advisories",
].map((name, index) => ({
  id: index + 1,
  name,
  run_id: 10,
  run_attempt: 1,
  head_sha: run.head_sha,
  status: "completed",
  conclusion: "success",
  started_at: run.created_at,
  completed_at: run.updated_at,
}));
/** @param {string} name @param {number} id */
function artifact(name, id) {
  return {
    id,
    name,
    digest: `sha256:${hash}`,
    zipHash: hash,
    expired: false,
    size_in_bytes: 512,
    created_at: "2026-11-16T10:05:00Z",
    expires_at: "2026-11-23T10:05:00Z",
    workflow_run: { id: 10, head_sha: run.head_sha },
  };
}
function candidate() {
  return {
    run: structuredClone(run),
    jobs: structuredClone(jobs),
    headCommit: { sha: run.head_sha, tree: { sha: tree } },
    checkoutCommit: {
      sha: "f".repeat(40),
      tree: { sha: tree },
      parents: [{ sha: base }, { sha: run.head_sha }],
    },
    docsArtifact: artifact("ci-docs-evidence-1", 30),
    sourceArtifact: artifact("ci-source-evidence-1", 31),
    receipt: {
      version: 1,
      mode: "executed",
      runId: 10,
      runAttempt: 1,
      context: { ...context, event: "pull_request", sourceSha: "f".repeat(40) },
      durationMs: 1234,
    },
    sourceEvidence: {
      schemaVersion: 1,
      repository: "owner/repo",
      sourceSha: "f".repeat(40),
      treeSha: tree,
      eventName: "pull_request",
      runId: "10",
      runAttempt: "1",
      selectedCoverage: ["docs"],
      successfulCoverage: ["docs"],
    },
  };
}
function select(value = candidate(), current = context) {
  return selectDocsEvidence({
    current,
    candidate: value,
    now: "2026-11-16T11:00:00Z",
  });
}

test("a successful docs-only run proves a different checkout SHA at the identical tree/context", () => {
  assert.deepEqual(select(), {
    reused: true,
    runId: 10,
    runAttempt: 1,
    jobId: 2,
    artifactId: 30,
    sourceArtifactId: 31,
    sourceSha: "f".repeat(40),
    treeSha: tree,
    durationMs: 1234,
  });
});

/** @type {Array<[string,(value:ReturnType<typeof candidate>)=>void]>} */
const rejected = [
  [
    "tree changed",
    (value) => {
      value.receipt.context.treeSha = sha;
    },
  ],
  [
    "comparison changed",
    (value) => {
      value.receipt.context.comparisonHash = "0".repeat(64);
    },
  ],
  [
    "environment changed",
    (value) => {
      value.receipt.context.environmentHash = "0".repeat(64);
    },
  ],
  [
    "producer changed",
    (value) => {
      value.receipt.context.producerHash = "0".repeat(64);
    },
  ],
  [
    "producer not approved",
    (value) => {
      value.receipt.context.trustedProducer = false;
    },
  ],
  [
    "environment incomplete",
    (value) => {
      value.receipt.context.environmentComplete = false;
    },
  ],
  [
    "reuse chain",
    (value) => {
      value.receipt.mode = "reused";
    },
  ],
  [
    "failed run",
    (value) => {
      value.run.conclusion = "failure";
    },
  ],
  [
    "pending run",
    (value) => {
      value.run.status = "in_progress";
    },
  ],
  [
    "cancelled run",
    (value) => {
      value.run.conclusion = "cancelled";
    },
  ],
  [
    "foreign repository",
    (value) => {
      value.run.head_repository.full_name = "fork/repo";
    },
  ],
  [
    "foreign workflow",
    (value) => {
      value.run.path = ".github/workflows/other.yml";
    },
  ],
  [
    "other target",
    (value) => {
      first(value.run.pull_requests).base.ref = "other";
    },
  ],
  [
    "missing PR binding",
    (value) => {
      value.run.pull_requests = [];
    },
  ],
  [
    "other base",
    (value) => {
      first(value.run.pull_requests).base.sha = sha;
    },
  ],
  [
    "different provider tree",
    (value) => {
      value.headCommit.tree.sha = sha;
    },
  ],
  [
    "unbound checkout",
    (value) => {
      at(value.checkoutCommit.parents, 1).sha = sha;
    },
  ],
  [
    "old attempt receipt",
    (value) => {
      value.receipt.runAttempt = 2;
    },
  ],
  [
    "wrong run receipt",
    (value) => {
      value.receipt.runId = 11;
    },
  ],
  [
    "missing coverage",
    (value) => {
      value.sourceEvidence.successfulCoverage = [];
    },
  ],
  [
    "different plan",
    (value) => {
      value.sourceEvidence.selectedCoverage = ["unit"];
    },
  ],
  [
    "stale run",
    (value) => {
      value.run.updated_at = "2026-11-14T11:00:00Z";
    },
  ],
  [
    "artifact expired",
    (value) => {
      value.docsArtifact.expired = true;
    },
  ],
  [
    "artifact expiry elapsed",
    (value) => {
      value.docsArtifact.expires_at = "2026-11-16T10:59:00Z";
    },
  ],
  [
    "artifact digest differs",
    (value) => {
      value.docsArtifact.zipHash = "0".repeat(64);
    },
  ],
  [
    "artifact from other attempt",
    (value) => {
      value.docsArtifact.name = "ci-docs-evidence-2";
    },
  ],
  [
    "artifact from other run",
    (value) => {
      value.docsArtifact.workflow_run.id = 11;
    },
  ],
  [
    "artifact outside producing job",
    (value) => {
      value.docsArtifact.created_at = "2026-11-16T09:00:00Z";
    },
  ],
  [
    "oversized artifact",
    (value) => {
      value.docsArtifact.size_in_bytes = 65537;
    },
  ],
  [
    "missing provider job",
    (value) => {
      value.jobs = value.jobs.slice(1);
    },
  ],
  [
    "duplicate provider job",
    (value) => {
      value.jobs.push(first(value.jobs));
    },
  ],
  [
    "job from other attempt",
    (value) => {
      first(value.jobs).run_attempt = 2;
    },
  ],
  [
    "job from other source",
    (value) => {
      first(value.jobs).head_sha = sha;
    },
  ],
  [
    "job failed",
    (value) => {
      at(value.jobs, 1).conclusion = "failure";
    },
  ],
  [
    "job skipped",
    (value) => {
      at(value.jobs, 1).conclusion = "skipped";
    },
  ],
];
for (const [name, change] of rejected)
  test(`fresh docs on ${name}`, () => {
    const value = candidate();
    change(value);
    assert.equal(select(value).reused, false);
  });
test("missing or historical evidence and a non-queue consumer fall back", () => {
  for (const value of [null, {}, { ...candidate(), receipt: undefined }])
    assert.equal(
      selectDocsEvidence({
        current: context,
        candidate: value,
        now: "2026-11-16T11:00:00Z",
      }).reused,
      false,
    );
  for (const current of [
    { ...context, event: "pull_request" },
    { ...context, trustedProducer: false },
    { ...context, environmentComplete: false },
  ])
    assert.equal(select(candidate(), current).reused, false);
});

test("provider adapter verifies actual ZIP bytes and rejects an attempt replaced during lookup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docs-provider-test-"));
  try {
    const value = candidate();
    const artifacts = [value.docsArtifact, value.sourceArtifact];
    /** @type {Map<string, Buffer>} */ const responses = new Map();
    for (const [index, payload] of [
      value.receipt,
      value.sourceEvidence,
    ].entries()) {
      const file = index === 0 ? "docs-evidence.json" : "source-evidence.json";
      await writeFile(join(directory, file), JSON.stringify(payload));
      execFileSync("zip", [
        "-q",
        "-j",
        join(directory, `${file}.zip`),
        join(directory, file),
      ]);
      const zip = await readFile(join(directory, `${file}.zip`));
      const artifact = at(artifacts, index);
      artifact.digest = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
      artifact.size_in_bytes = zip.length;
      responses.set(`actions/artifacts/${artifact.id}/zip`, zip);
    }
    /** @param {string} path @param {unknown} payload */
    const json = (path, payload) =>
      responses.set(path, Buffer.from(JSON.stringify(payload)));
    json(
      "actions/workflows/ci.yml/runs?status=success&event=pull_request&per_page=10",
      { workflow_runs: [value.run] },
    );
    json(`git/commits/${run.head_sha}`, value.headCommit);
    json(
      `git/commits/${value.receipt.context.sourceSha}`,
      value.checkoutCommit,
    );
    json("actions/runs/10/artifacts?per_page=100", {
      total_count: 2,
      artifacts,
    });
    json("actions/runs/10/attempts/1/jobs?per_page=100", {
      total_count: value.jobs.length,
      jobs: value.jobs,
    });
    json("actions/runs/10", value.run);
    /** @param {string} path */
    const read = async (path) => {
      const response = responses.get(path);
      assert.ok(response, `unexpected provider read ${path}`);
      return response;
    };
    assert.equal(
      (await lookupDocsEvidence(context, read, "2026-11-16T11:00:00Z")).reused,
      true,
    );
    let runReads = 0;
    assert.equal(
      (
        await lookupDocsEvidence(
          context,
          async (path) => {
            if (path === "actions/runs/10" && ++runReads === 2)
              return Buffer.from(
                JSON.stringify({ ...value.run, run_attempt: 2 }),
              );
            return read(path);
          },
          "2026-11-16T11:00:00Z",
        )
      ).reused,
      false,
    );
    responses.set("actions/artifacts/30/zip", Buffer.from("corrupted archive"));
    assert.equal(
      (await lookupDocsEvidence(context, read, "2026-11-16T11:00:00Z")).reused,
      false,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("provider unavailability never supplies reusable evidence", async () => {
  await assert.rejects(
    lookupDocsEvidence(
      context,
      async () => {
        throw new Error("provider unavailable");
      },
      "2026-11-16T11:00:00Z",
    ),
  );
});

test("normal fallback executes checks and a failed check cannot produce a successful receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-fallback-test-"));
  const output = join(root, "receipt.json");
  try {
    // The external package-manager process is the tooling seam; the admission and lifecycle are real.
    await writeFile(
      join(root, "pnpm"),
      '#!/bin/sh\nprintf \'%s\' "$*" > "$DOCS_TEST_COMMAND"\nexit 0\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${root}:${process.env["PATH"] ?? ""}`,
      DOCS_TEST_COMMAND: join(root, "command"),
    };
    const receipt = await runDocsCI({ root, env, output });
    assert.equal(receipt.mode, "executed");
    assert.equal(await readFile(join(root, "command"), "utf8"), "docs:check");
    await rm(output);
    await writeFile(join(root, "pnpm"), "#!/bin/sh\nexit 17\n", {
      mode: 0o755,
    });
    await assert.rejects(runDocsCI({ root, env, output }), /failed/u);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true });
  }
});

for (const ending of ["success", "failure", "timeout", "interruption"]) {
  test(`owned documentation process stops descendants after ${ending}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "docs-process-test-"));
    const cancellation = new AbortController();
    try {
      const file = join(root, "child.mjs");
      await writeFile(
        file,
        `import {spawn} from 'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[2],String(child.pid));${ending === "success" ? "process.exit(0)" : ending === "failure" ? "process.exit(17)" : "setInterval(()=>{},1000)"};`,
      );
      const pending = execute(process.execPath, [file, join(root, "pid")], {
        cwd: root,
        env: process.env,
        signal: cancellation.signal,
        timeout: ending === "timeout" ? 3000 : 30000,
      });
      // Install rejection handling immediately, before asynchronous fixture observation.
      const observed = pending.then(
        () => "success",
        () => "rejected",
      );
      if (ending === "interruption") {
        // Observe readiness, not elapsed time, before interrupting a live descendant.
        const deadline = performance.now() + 5000;
        while (true) {
          try {
            await readFile(join(root, "pid"));
            break;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "ENOENT" ||
              performance.now() >= deadline
            )
              throw error;
          }
          await pause(10);
        }
        cancellation.abort();
      }
      assert.equal(
        await observed,
        ending === "success" ? "success" : "rejected",
      );
      const pid = Number(await readFile(join(root, "pid"), "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      await rm(root, { recursive: true });
    }
  });
}

test("tracked snapshot executes real documentation checks and rejects an unapproved producer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docs-real-git-test-"));
  const root = join(directory, "repository");
  const source = dirname(dirname(fileURLToPath(import.meta.url)));
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    }).trim();
  /** @param {string} message */
  const commit = (message) => {
    git(["add", "."]);
    git([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      message,
    ]);
    return git(["rev-parse", "HEAD"]);
  };
  const output = join(directory, "receipt.json");
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root);
    const archive = join(directory, "source.tar");
    execFileSync("git", [
      "-C",
      source,
      "archive",
      "HEAD",
      `--output=${archive}`,
    ]);
    execFileSync("tar", ["-xf", archive, "-C", root]);
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "CI fixture"]);
    git(["config", "user.email", "ci-fixture@example.test"]);
    const approved = commit("approved producer");
    git(["update-ref", "refs/remotes/origin/main", approved]);
    await writeFile(
      join(root, "README.md"),
      (await readFile(join(root, "README.md"), "utf8")) +
        "\nDocumentation evidence fixture.\n",
    );
    const head = commit("ordinary prose");
    const env = {
      ...process.env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "test/repository",
      GITHUB_SHA: head,
    };
    // A generated instruction file must not contaminate the tracked snapshot.
    await writeFile(join(root, "CLAUDE.md"), "Untracked generated file.\n");
    const receipt = await runDocsCI({ root, env, output });
    assert.equal(receipt.mode, "executed");
    assert.equal(receipt.context?.sourceSha, head);
    assert.equal(receipt.context?.trustedProducer, true);
    await rm(join(root, "CLAUDE.md"));
    git(["checkout", "-q", "--detach", approved]);
    await writeFile(
      join(root, ".ci-fixture-producer"),
      "later approved executable input\n",
    );
    const laterMain = commit("main producer changed independently");
    git(["update-ref", "refs/remotes/origin/main", laterMain]);
    git(["checkout", "-q", "--detach", head]);
    const differentProducer = await runDocsCI({ root, env, output });
    assert.equal(differentProducer.context?.trustedProducer, false);
    assert.equal(differentProducer.context?.comparisonBase, approved);
    await writeFile(
      join(root, "docs/research/ci-evidence-invalid-fixture.md"),
      `Invalid ${String.fromCharCode(0x2014)} prose.\n`,
    );
    env.GITHUB_SHA = commit("invalid documentation");
    await rm(output);
    await assert.rejects(runDocsCI({ root, env, output }), /failed/u);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true });
  }
});
