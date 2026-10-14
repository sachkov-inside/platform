// @ts-check
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  coverageIds,
  normalizeCoverage,
  selectCoverage,
  validateGate,
} from "./ci-coverage-plan.mjs";
/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function computePlan() {
  if (process.env["CI_EVENT"] === "release") {
    const source = process.env["SOURCE_SHA"] ?? "";
    if (
      !/^[a-f0-9]{40}$/u.test(source) ||
      git(["rev-parse", "HEAD"]) !== source
    )
      throw new Error("Release checkout is not the captured immutable source");
    const raw = process.env["COVERAGE_JSON"];
    /** @type {unknown} */
    const parsed =
      raw === undefined || raw === "" ? coverageIds : JSON.parse(raw);
    const required = normalizeCoverage(parsed);
    return {
      event: "release",
      paths: [],
      categories: ["release-gaps"],
      required,
      excluded: coverageIds.filter((id) => !required.includes(id)),
    };
  }
  const base = process.env["BASE_SHA"] ?? "";
  const head = process.env["HEAD_SHA"] ?? "";
  if (!/^[a-f0-9]{40}$/u.test(base) || !/^[a-f0-9]{40}$/u.test(head))
    throw new Error("Missing complete source comparison");
  const event = process.env["CI_EVENT"] ?? "";
  const comparison =
    event === "pull_request" ? `${base}...${head}` : `${base}..${head}`;
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", comparison],
    { encoding: "utf8" },
  );
  return selectCoverage(changed.split("\0").filter(Boolean), event);
}
function main() {
  const plan = computePlan();
  const serialized = JSON.stringify(plan);
  if (process.argv[2] === "plan") {
    const output = process.env["GITHUB_OUTPUT"];
    if (output === undefined) throw new Error("Missing Actions output");
    appendFileSync(
      output,
      `plan=${serialized}\nrequired=${JSON.stringify(plan.required)}\n`,
    );
    return;
  }
  if (process.argv[2] !== "gate") throw new Error("Expected plan or gate");
  if (process.env["SELECTED_PLAN"] !== serialized)
    throw new Error("Selected plan does not match complete source change set");
  /** @type {unknown} */
  const results = JSON.parse(process.env["JOB_RESULTS"] ?? "null");
  validateGate(plan, results);
  const evidence = {
    schemaVersion: 1,
    repository: process.env["GITHUB_REPOSITORY"],
    sourceSha: git(["rev-parse", "HEAD"]),
    treeSha: git(["rev-parse", "HEAD^{tree}"]),
    eventName: process.env["GITHUB_EVENT_NAME"],
    runId: process.env["GITHUB_RUN_ID"],
    runAttempt: process.env["GITHUB_RUN_ATTEMPT"],
    selectedCoverage: plan.required,
    successfulCoverage: plan.required,
    excludedCoverage: plan.excluded,
  };
  mkdirSync("ci-source-evidence", { recursive: true });
  writeFileSync(
    "ci-source-evidence/source-evidence.json",
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined)
    appendFileSync(
      summary,
      `## CI coverage\n\nRequired and successful: ${plan.required.join(", ") || "(none; reused release evidence)"}\n\nNot required: ${plan.excluded.join(", ") || "(none)"}\n\nSource: ${evidence.sourceSha}\n`,
    );
}
main();
