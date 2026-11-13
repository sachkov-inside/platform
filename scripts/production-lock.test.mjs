import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const script = resolve("scripts/check-production-lock.sh");

/**
 * Runs the check against a fake `gh`: `issue` answers `gh api repos/<repo>/issues/<n>`, `open`
 * answers the list of open production-lock Issues.
 * @param {string} lock
 * @param {{ issue?: unknown, open?: unknown }} answers
 */
function check(lock, answers) {
  const root = mkdtempSync(join(tmpdir(), "production-lock-"));
  try {
    writeFileSync(
      join(root, "issue.json"),
      JSON.stringify(answers.issue ?? {}),
    );
    writeFileSync(join(root, "open.json"), JSON.stringify(answers.open ?? []));
    writeFileSync(
      join(root, "gh"),
      `#!/usr/bin/env bash
case "$2" in
  repos/sachkov-inside/platform/issues/*) cat "${root}/issue.json" ;;
  "repos/sachkov-inside/platform/issues?labels=production-lock&state=open&per_page=100") cat "${root}/open.json" ;;
  *) echo "unexpected gh $*" >&2; exit 2 ;;
esac
`,
    );
    chmodSync(join(root, "gh"), 0o755);
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      env: {
        PATH: `${root}:${process.env["PATH"] ?? ""}`,
        GITHUB_REPOSITORY: "sachkov-inside/platform",
        LOCK: lock,
      },
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const lock = (number, extra = {}) => ({
  number,
  state: "open",
  labels: [{ name: "production-lock" }],
  ...extra,
});

describe("production lock check before a release or deployment run", () => {
  it("lets the run through when its Issue is the open lock holding production", () => {
    const result = check("2140", {
      issue: lock(2140),
      open: [lock(2140)],
    });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /#2140 holds production/u);
  });

  it("accepts the number written with a hash", () => {
    const result = check("#2140", { issue: lock(2140), open: [lock(2140)] });
    assert.equal(result.status, 0, result.output);
  });

  it("refuses a run without a number", () => {
    for (const value of ["", "abc", "0", "21 40"]) {
      const result = check(value, { issue: lock(2140), open: [lock(2140)] });
      assert.notEqual(result.status, 0, value);
      assert.match(result.output, /production lock Issue number/u);
    }
  });

  it("refuses a closed Issue, one without the label and a pull request", () => {
    for (const issue of [
      lock(2140, { state: "closed" }),
      lock(2140, { labels: [{ name: "ready-for-agent" }] }),
      lock(2140, { pull_request: { url: "x" } }),
    ]) {
      const result = check("2140", { issue, open: [lock(2140)] });
      assert.notEqual(result.status, 0);
      assert.match(
        result.output,
        /#2140 is not an open Issue with label production-lock/u,
      );
    }
  });

  it("refuses a later lock while an earlier one still holds production", () => {
    const result = check("2141", {
      issue: lock(2141),
      open: [lock(2141), lock(2139)],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /production is held by #2139/u);
  });
});

describe("release and deployment workflows start under the production lock", () => {
  const read = (/** @type {string} */ path) => readFileSync(path, "utf8");
  const workflows = {
    "release.yml": "plan",
    "deploy.yml": "deploy",
    "telegram-release.yml": "plan",
    "telegram-deploy.yml": "deploy",
  };

  it("takes the lock number and runs the shared check before any other job", () => {
    for (const [name, first] of Object.entries(workflows)) {
      const workflow = read(`.github/workflows/${name}`);
      assert.match(
        workflow,
        /^ {6}lock:\n {8}description: .+\n {8}required: true\n {8}type: string$/mu,
        name,
      );
      assert.match(
        workflow,
        /^ {2}lock:\n {4}uses: \.\/\.github\/workflows\/production-lock\.yml\n {4}permissions:\n {6}contents: read\n {6}issues: read\n {4}with:\n {6}lock: \$\{\{ inputs\.lock \}\}$/mu,
        name,
      );
      assert.match(
        workflow,
        new RegExp(`^ {2}${first}:\\n {4}needs: lock$`, "mu"),
        name,
      );
    }
    const check = read(".github/workflows/production-lock.yml");
    assert.match(check, /^ {2}workflow_call:$/mu);
    assert.match(check, /run: bash scripts\/check-production-lock\.sh$/mu);
    assert.match(check, /LOCK: \$\{\{ inputs\.lock \}\}/u);
  });

  it("queues Platform and Telegram deployments to the one server together", () => {
    for (const name of ["deploy.yml", "telegram-deploy.yml"]) {
      const workflow = read(`.github/workflows/${name}`);
      assert.match(
        workflow,
        /^ {2}group: production-server-deployment$/mu,
        name,
      );
      assert.match(workflow, /^ {2}queue: max$/mu, name);
    }
  });
});
