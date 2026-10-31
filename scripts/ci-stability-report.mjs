// @ts-check
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { identity } from "./nightly-flake-report.mjs";

const runSchema = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  head_sha: z.string(),
  created_at: z.string().datetime(),
  html_url: z.string().url(),
  pull_requests: z.array(z.object({ number: z.number().int().positive() })),
});
const jobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  conclusion: z.string().nullable(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  steps: z
    .array(z.object({ name: z.string(), conclusion: z.string().nullable() }))
    .default([]),
});
/** @typedef {z.infer<typeof jobSchema> & {run: number, attempt: number, source: string, pullRequests: number[], durationSeconds: number | null, classification: string}} Job */
/** @typedef {{suite: string, file: string, project: string, name: string, status: 'failed' | 'passed'}} Observation */
/** @typedef {{identity: string, test: Omit<Observation, 'status'>, category: string, firstFailure: Job, failures: Job[], pullRequests: number[], priority: string, rechecks: {run: number, attempt: number, source: string, outcome: string}[]}} Cause */

/** Parse only formats carrying a file and test name. Raw log payloads are never retained.
 * @param {string} log @param {string} suite @returns {Observation[]}
 */
export function observations(log, suite) {
  /** @type {Observation[]} */
  const found = [];
  // CI matrix placement is provenance, not part of a test's stable suite family.
  suite = suite.replace(
    /^(Unit checks|Web browser|Full-stack browser|Integration checks|Production checks) \(.+\)$/u,
    "$1",
  );
  let commandDirectory = "";
  for (const line of stripVTControlCharacters(log).split("\n")) {
    // GitHub log timestamp precedes the original reporter line.
    const timed = line.replace(/^\d{4}-\d\d-\d\dT\S+\s+/u, "");
    const header = timed.match(
      /^> @inside\/[\w-]+@\S+\s+.*\/((?:apps|packages)\/[\w-]+)\s*$/u,
    );
    if (header?.[1]) commandDirectory = header[1];
    const prefix = timed.match(/^((?:apps|packages)\/[^ ]+) [\w:-]+: /u);
    const directory = prefix?.[1] ?? commandDirectory;
    const text = prefix ? timed.slice(prefix[0].length) : timed;
    const vitest = text.match(/^\s*FAIL\s+(\S+\.[cm]?[jt]sx?)\s+>\s+(.+)$/u);
    const file = vitest?.[1];
    const portable =
      file && !file.split("/").includes("..") && !file.startsWith("/")
        ? /^(?:apps|packages|scripts|tools)\//u.test(file)
          ? file
          : directory
            ? `${directory}/${file}`
            : undefined
        : undefined;
    const browser = text.match(
      /^\s*\d+\)\s+\[([^\]]+)\]\s+›\s+([^\s]+\.[cm]?[jt]sx?):\d+:\d+\s+›\s+(.+)$/u,
    );
    if (portable && vitest?.[2])
      found.push({
        suite,
        file: portable,
        project: "",
        name: vitest[2].trim(),
        status: "failed",
      });
    else if (browser?.[1] && browser[2] && browser[3])
      found.push({
        suite,
        file: browser[2],
        project: browser[1],
        name: browser[3].trim(),
        status: "failed",
      });
  }
  return [...new Map(found.map((row) => [identity(row), row])).values()];
}

/** @param {string} text */
function markdownText(text) {
  return text.replaceAll(/[<>&`*_[\]\n\r]/gu, " ");
}

async function main() {
  const [repository, output, ...args] = process.argv.slice(2);
  if (!repository || !/^[\w.-]+\/[\w.-]+$/u.test(repository) || !output)
    throw new Error(
      "Usage: ci-stability-report.mjs owner/repository output [--until=ISO] [--max-pages=2]",
    );
  const options = z
    .object({
      until: z.string().datetime(),
      maxPages: z.coerce.number().int().min(1).max(5).default(2),
    })
    .strict()
    .parse(
      Object.fromEntries(
        args
          .map((arg) => {
            const [key, value] = arg.replace(/^--/u, "").split("=");
            return [key === "max-pages" ? "maxPages" : key, value];
          })
          .concat(
            args.some((arg) => arg.startsWith("--until="))
              ? []
              : [["until", new Date().toISOString()]],
          ),
      ),
    );
  const until = new Date(options.until);
  const since = new Date(until.getTime() - 7 * 86400000);
  const period = { since: since.toISOString(), until: until.toISOString() };
  const limits = {
    maxPages: options.maxPages,
    pageSize: 100,
    maxRuns: 100,
    maxAttempts: 3,
    maxJobs: 500,
    maxRequests: 300,
    maxLogBytes: 1048576,
    maxTotalLogBytes: 20971520,
    maxWallSeconds: 120,
  };
  /** @type {string[]} */
  const incomplete = [];
  const deadline = Date.now() + limits.maxWallSeconds * 1000;
  let requests = 0;
  let logBytes = 0;
  let logBudgetBytesCharged = 0;
  /** @param {string} path @param {boolean} [log] */
  function read(path, log = false) {
    if (requests >= limits.maxRequests)
      throw new Error("request budget exhausted");
    if (Date.now() >= deadline) throw new Error("wall-time budget exhausted");
    const reservation = log
      ? Math.min(
          limits.maxLogBytes,
          limits.maxTotalLogBytes - logBudgetBytesCharged,
        )
      : 0;
    if (log && reservation <= 0) throw new Error("log budget exhausted");
    // A failed command still consumed an admitted read, even when no stdout is exposed.
    if (log) logBudgetBytesCharged += reservation;
    requests++;
    try {
      // gh rejects ANSI by default. Permit it only in buffered logs; observations strips it.
      const output = execFileSync(
        "gh",
        [
          "api",
          "--method",
          "GET",
          ...(log ? ["--allow-escape-sequences"] : []),
          path,
        ],
        {
          encoding: "utf8",
          timeout: Math.min(15000, Math.max(1, deadline - Date.now())),
          maxBuffer: log ? reservation : 4194304,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (log) {
        const captured = Buffer.byteLength(output);
        logBytes += captured;
        logBudgetBytesCharged += captured - reservation;
      }
      return output;
    } catch (error) {
      if (log) {
        const stdout =
          error instanceof Error && "stdout" in error
            ? error.stdout
            : undefined;
        const captured =
          typeof stdout === "string"
            ? Buffer.byteLength(stdout)
            : Buffer.isBuffer(stdout)
              ? stdout.length
              : 0;
        logBytes += captured;
        // maxBuffer can overread one chunk. Charge it and stop subsequent admission.
        logBudgetBytesCharged += Math.max(0, captured - reservation);
      }
      // Both callers discard the exception payload and retain only bounded coverage metadata.
      throw error;
    }
  }
  /** @template T @param {string} path @param {string} key @param {z.ZodType<T>} schema @returns {T[]} */
  function pages(path, key, schema) {
    /** @type {T[]} */
    const rows = [];
    for (let page = 1; page <= limits.maxPages; page++) {
      try {
        const data = z
          .object({ total_count: z.number().int().nonnegative() })
          .catchall(z.unknown())
          .parse(
            JSON.parse(
              read(
                `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
              ),
            ),
          );
        const batch = z.array(schema).parse(data[key]);
        rows.push(...batch);
        if (rows.length > data.total_count) {
          incomplete.push(`${key}: inconsistent total count`);
          return rows;
        }
        if (rows.length === data.total_count) return rows;
        if (batch.length === 0) {
          incomplete.push(`${key}: missing page ${page}`);
          return rows;
        }
      } catch {
        incomplete.push(`${key}: unavailable or malformed page ${page}`);
        return rows;
      }
    }
    incomplete.push(`${key}: pagination limit`);
    return rows;
  }
  const base = `repos/${repository}/actions`;
  const runs = pages(
    `${base}/workflows/ci.yml/runs?created=${encodeURIComponent(period.since)}..${encodeURIComponent(period.until)}`,
    "workflow_runs",
    runSchema,
  ).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  if (runs.length > limits.maxRuns) incomplete.push("run limit");
  /** @type {Job[]} */
  const jobs = [];
  /** @type {Map<string,Cause>} */
  const causes = new Map();
  for (const run of runs.slice(0, limits.maxRuns)) {
    if (new Date(run.created_at) < since || new Date(run.created_at) > until) {
      incomplete.push(`run ${run.id}: outside period`);
      continue;
    }
    if (run.run_attempt > limits.maxAttempts)
      incomplete.push(`run ${run.id}: attempt limit`);
    for (
      let attempt = 1;
      attempt <= Math.min(run.run_attempt, limits.maxAttempts);
      attempt++
    ) {
      const batch = pages(
        `${base}/runs/${run.id}/attempts/${attempt}/jobs`,
        "jobs",
        jobSchema,
      );
      for (const input of batch) {
        if (jobs.length >= limits.maxJobs) {
          incomplete.push("job limit");
          break;
        }
        const durationSeconds =
          input.started_at && input.completed_at
            ? Math.max(
                0,
                (Date.parse(input.completed_at) -
                  Date.parse(input.started_at)) /
                  1000,
              )
            : null;
        /** @type {Job} */
        const job = {
          ...input,
          run: run.id,
          attempt,
          source: run.head_sha,
          pullRequests: run.pull_requests.map((pr) => pr.number),
          durationSeconds,
          classification:
            input.conclusion === "cancelled"
              ? "cancelled"
              : input.conclusion === "success"
                ? "success"
                : "unknown",
        };
        /** @type {Observation[]} */
        let tests = [];
        if (input.conclusion === "failure") {
          try {
            const log = read(`${base}/jobs/${job.id}/logs`, true);
            tests = observations(log, job.name);
            job.classification =
              tests.length > 0
                ? "test-failure-unclassified"
                : /The runner has lost communication with the server|runner received a shutdown signal/u.test(
                      log,
                    )
                  ? "provider-failure"
                  : input.steps.some(
                        (step) =>
                          step.conclusion === "failure" &&
                          /^(Set up Platform|Install Node.js|Check out source|Set up job)$/u.test(
                            step.name,
                          ),
                      )
                    ? "setup-failure"
                    : "unknown";
          } catch {
            incomplete.push(`job ${job.id}: logs unavailable or bounded`);
          }
        }
        jobs.push(job);
        for (const test of tests) {
          const key = identity(test);
          const cause = causes.get(key) ?? {
            identity: key,
            test: {
              suite: test.suite,
              file: test.file,
              project: test.project,
              name: test.name,
            },
            category: "test-failure-unclassified",
            firstFailure: job,
            failures: [],
            pullRequests: [],
            priority: "diagnose",
            rechecks: [],
          };
          cause.failures.push(job);
          cause.pullRequests = [
            ...new Set([...cause.pullRequests, ...job.pullRequests]),
          ].sort((a, b) => a - b);
          cause.priority =
            cause.pullRequests.length > 1 ? "diagnose-recurring" : "diagnose";
          causes.set(key, cause);
        }
      }
    }
  }
  for (const cause of causes.values()) {
    cause.failures.sort(
      (a, b) =>
        (a.completed_at ?? a.started_at ?? "").localeCompare(
          b.completed_at ?? b.started_at ?? "",
        ) ||
        a.run - b.run ||
        a.attempt - b.attempt,
    );
    cause.firstFailure = cause.failures[0] ?? cause.firstFailure;
  }
  for (const cause of causes.values())
    cause.rechecks = [
      ...new Map(
        jobs
          .filter((job) =>
            cause.failures.some(
              (failure) =>
                job.run === failure.run &&
                job.name === failure.name &&
                job.attempt > failure.attempt,
            ),
          )
          .map((job) => [`${job.run}:${job.attempt}:${job.id}`, job]),
      ).values(),
    ].map((job) => ({
      run: job.run,
      attempt: job.attempt,
      source: job.source,
      outcome:
        job.classification === "success"
          ? "job-success-test-unconfirmed"
          : job.classification,
    }));
  const report = {
    version: 1,
    collectorSource: process.env["GITHUB_SHA"] ?? "local-unbound",
    repository,
    period,
    limits,
    coverage: {
      complete: incomplete.length === 0,
      requests,
      logBytes,
      logBudgetBytesCharged,
      logBudgetScope:
        "Successful stdout bytes; failed reads reserve their full allowance or observed partial stdout when larger. Admission budget excludes hidden gh/network buffering; a final capture can overread maxBuffer.",
      runs: runs.slice(0, limits.maxRuns).length,
      jobs: jobs.length,
      incomplete: [...new Set(incomplete)],
    },
    causes: [...causes.values()],
    jobs,
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "history.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  /** @type {Map<string,{attempts:number,seconds:number,missing:number}>} */
  const durations = new Map();
  for (const job of jobs) {
    const row = durations.get(job.name) ?? {
      attempts: 0,
      seconds: 0,
      missing: 0,
    };
    row.attempts++;
    row.seconds += job.durationSeconds ?? 0;
    if (job.durationSeconds === null) row.missing++;
    durations.set(job.name, row);
  }
  const durationTable = [...durations]
    .map(
      ([name, row]) =>
        `| ${markdownText(name).replaceAll("|", " ")} | ${row.attempts} | ${row.seconds} | ${row.missing} |`,
    )
    .join("\n");
  const markdown = `## CI history\n\nPeriod: ${period.since} to ${period.until}. Runs: ${report.coverage.runs}; job attempts: ${jobs.length}; GET requests: ${requests}. Captured log stdout: ${logBytes} bytes; log budget charged: ${logBudgetBytesCharged} bytes (admission budget, excluding hidden gh/network buffering and possible final maxBuffer overread). Coverage: ${report.coverage.complete ? "complete within configured CI period and limits" : "incomplete"}.\n\n${report.coverage.incomplete.join("; ")}\n\n${report.causes.map((cause) => `- ${cause.identity}: ${markdownText(cause.test.file)}, ${markdownText(cause.test.name)}. First failure: run ${cause.firstFailure.run}, attempt ${cause.firstFailure.attempt}, source ${cause.firstFailure.source}. PRs: ${cause.pullRequests.join(", ")}. ${cause.priority}. Rechecks: ${cause.rechecks.map((check) => `run ${check.run}, attempt ${check.attempt}, source ${check.source}: ${check.outcome}`).join(", ") || "none"}.`).join("\n")}\n\nFailure signatures are observations requiring diagnosis, including possible regressions. A passing job does not confirm a particular test passed. Missing test identities remain unknown job failures. This report grants no retry, closure, review or required-CI exemption. Durations and all outcomes are in history.json.\n\n| Stage | Attempts | Total seconds | Missing durations |\n|---|---|---|---|\n${durationTable}\n`;
  writeFileSync(resolve(output, "summary.md"), markdown);
  if (process.env["GITHUB_STEP_SUMMARY"])
    appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  await main();
