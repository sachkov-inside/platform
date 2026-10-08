// @ts-check
import { createHash } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

export const observationSchema = z.object({
  suite: z.string(),
  file: z.string(),
  project: z.string(),
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
});
/** @typedef {z.infer<typeof observationSchema>} Observation */
/** @typedef {Omit<Observation, "status"> & {attempts: number, failed: number, skipped: number}} Row */
const vitestSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      message: z.string().optional(),
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.enum(["passed", "failed", "pending", "todo", "skipped"]),
        }),
      ),
    }),
  ),
});
const playwrightSuiteSchema = z.object({
  title: z.string(),
  file: z.string().optional(),
  suites: z.array(z.unknown()).default([]),
  specs: z
    .array(
      z.object({
        title: z.string(),
        file: z.string(),
        tests: z.array(
          z.object({
            projectName: z.string(),
            expectedStatus: z.string(),
            results: z.array(
              z.object({ status: z.string(), retry: z.number().optional() }),
            ),
          }),
        ),
      }),
    )
    .default([]),
});

/** @param {string} root @param {string} file */
function portableFile(root, file) {
  return isAbsolute(file) ? relative(root, file) : file;
}

/** @param {unknown} input @param {string} root @param {string} suite @returns {Observation[]} */
export function normalizeVitest(input, root, suite) {
  const report = vitestSchema.parse(input);
  const rows = report.testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      suite,
      file: portableFile(root, file.name),
      project: "",
      name: test.fullName.trim(),
      status:
        test.status === "failed"
          ? /** @type {const} */ ("failed")
          : test.status === "passed"
            ? /** @type {const} */ ("passed")
            : /** @type {const} */ ("skipped"),
    })),
  );
  if (rows.length === 0)
    throw new Error("Reporter contained no test observations");
  return rows;
}

/** @param {unknown} input @param {string} root @param {string} suite @returns {Observation[]} */
export function normalizePlaywright(input, root, suite) {
  const report = z.object({ suites: z.array(z.unknown()) }).parse(input);
  /** @type {Observation[]} */
  const rows = [];
  /** @param {unknown} inputSuite @param {string[]} parents */
  function visit(inputSuite, parents) {
    const node = playwrightSuiteSchema.parse(inputSuite);
    const titles = [...parents, node.title];
    for (const spec of node.specs)
      for (const test of spec.tests) {
        if (
          test.results.length > 1 ||
          test.results.some((result) => (result.retry ?? 0) !== 0)
        )
          throw new Error("Retries are forbidden in flake hunt");
        const status = test.results[0]?.status ?? "skipped";
        rows.push({
          suite,
          file: portableFile(root, spec.file),
          project: test.projectName,
          name: [...titles, spec.title].join(" > "),
          status:
            status === "skipped"
              ? "skipped"
              : status === test.expectedStatus
                ? "passed"
                : "failed",
        });
      }
    for (const child of node.suites) visit(child, titles);
  }
  for (const node of report.suites) visit(node, []);
  if (rows.length === 0)
    throw new Error("Reporter contained no test observations");
  return rows;
}

/** @param {Omit<Observation, "status">} row */
export function identity(row) {
  return createHash("sha256")
    .update(JSON.stringify([row.suite, row.file, row.project, row.name]))
    .digest("hex");
}

/** @param {Observation[][]} samples @returns {Row[]} */
export function aggregate(samples) {
  /** @type {Map<string, Row>} */
  const rows = new Map();
  for (const sample of samples) {
    const seen = new Set();
    for (const observation of sample) {
      const key = identity(observation);
      if (seen.has(key))
        throw new Error(`Duplicate test identity: ${observation.name}`);
      seen.add(key);
      const row = rows.get(key) ?? {
        ...observation,
        attempts: 0,
        failed: 0,
        skipped: 0,
      };
      if (observation.status === "skipped") row.skipped += 1;
      else {
        row.attempts += 1;
        if (observation.status === "failed") row.failed += 1;
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.failed - a.failed || identity(a).localeCompare(identity(b)),
  );
}

/** @typedef {{ref: string, event: string, runUrl: string, sha: string, attempt: string}} Context */
/** @typedef {{find: (marker: string) => Promise<number | undefined>, create: (title: string, body: string) => Promise<void>, update: (number: number, body: string) => Promise<void>}} IssueClient */
/** @param {Row[]} rows @param {Context} context @param {IssueClient} client */
export async function publishFailures(rows, context, client) {
  if (
    context.ref !== "refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(context.event)
  )
    return;
  for (const row of rows.filter((row) => row.failed > 0)) {
    const marker = `<!-- platform-flake:${identity(row)} -->`;
    const title = `Nightly flake: ${row.suite} ${row.name}`.slice(0, 240);
    const body = `${marker}\n\nТест: ${row.name}\nФайл: ${row.file}\nSuite: ${row.suite}\nProject: ${row.project || "node"}\n\nПадения: ${row.failed}/${row.attempts} (${((100 * row.failed) / row.attempts).toFixed(1)}%). Пропуски: ${row.skipped}.\nПрогон: ${context.runUrl} (attempt ${context.attempt})\nКоммит: ${context.sha}\nАртефакты: ${context.runUrl}#artifacts — flake-${row.suite}-${context.attempt}; логи и JSON каждого повтора, browser diagnostics при падении. Хранятся семь дней.\n\nКаждый повтор независим; retries выключены. Даже одно падение требует диагноза. Доля 100% может означать постоянный дефект. Исправление подтвердите зелёным ночным прогоном на main.\n`;
    const number = await client.find(marker);
    if (number === undefined) await client.create(title, body);
    else await client.update(number, body);
  }
}

/** @param {string} directory @returns {string[]} */
function sampleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sampleFiles(path)
      : entry.name.endsWith(".observations.json")
        ? [path]
        : [];
  });
}
/** @param {string} value */
function cell(value) {
  return value
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}
/** @param {Row[]} rows */
export function summary(rows) {
  return `## Nightly flake hunt\n\n| Suite | File / test | Project | Failures / executed | Failure rate | Skipped |\n|---|---|---|---|---|---|\n${rows.map((row) => `| ${cell(row.suite)} | ${cell(`${row.file}: ${row.name}`)} | ${cell(row.project)} | ${row.failed}/${row.attempts} | ${row.attempts === 0 ? "n/a" : `${((100 * row.failed) / row.attempts).toFixed(1)}%`} | ${row.skipped} |`).join("\n")}\n\nPlanned: five independent runs, no retries. Setup/reporting failures remain red in the test jobs; missing samples are not counted as passes.\n`;
}

/** @param {string[]} args @param {unknown} [body] */
function gh(args, body) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
  });
}
/** @param {string} repository @returns {IssueClient} */
function githubClient(repository) {
  return {
    find: async (marker) => {
      // List all open hunt issues, rather than using GitHub's eventually indexed search.
      const issues = z
        .array(
          z.array(
            z.object({ number: z.number(), body: z.string().nullable() }),
          ),
        )
        .parse(
          JSON.parse(
            gh([
              "api",
              "--paginate",
              "--slurp",
              `repos/${repository}/issues?state=open&per_page=100`,
            ]),
          ),
        )
        .flat();
      return issues.find((issue) => issue.body?.includes(marker) === true)
        ?.number;
    },
    create: async (title, body) => {
      gh(
        [
          "api",
          "--method",
          "POST",
          `repos/${repository}/issues`,
          "--input",
          "-",
        ],
        { title, body, labels: ["needs-triage"] },
      );
    },
    update: async (number, body) => {
      gh(
        [
          "api",
          "--method",
          "PATCH",
          `repos/${repository}/issues/${number}`,
          "--input",
          "-",
        ],
        { body },
      );
    },
  };
}

async function main() {
  const directory = process.argv[2];
  if (directory === undefined)
    throw new Error(
      "Usage: nightly-flake-report.mjs <artifact-directory> [--publish]",
    );
  const files = sampleFiles(directory);
  if (files.length === 0) throw new Error("No flake observations downloaded");
  const rows = aggregate(
    files.map((file) =>
      z.array(observationSchema).parse(JSON.parse(readFileSync(file, "utf8"))),
    ),
  );
  const markdown = summary(rows);
  writeFileSync(resolve(directory, "summary.md"), markdown);
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath !== undefined) appendFileSync(summaryPath, markdown);
  if (process.argv.includes("--publish")) {
    const env = z
      .object({
        GITHUB_REF: z.string(),
        GITHUB_EVENT_NAME: z.string(),
        GITHUB_REPOSITORY: z.string(),
        GITHUB_SERVER_URL: z.string().url(),
        GITHUB_RUN_ID: z.string(),
        GITHUB_SHA: z.string(),
        GITHUB_RUN_ATTEMPT: z.string(),
      })
      .parse(process.env);
    await publishFailures(
      rows,
      {
        ref: env.GITHUB_REF,
        event: env.GITHUB_EVENT_NAME,
        runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
        sha: env.GITHUB_SHA,
        attempt: env.GITHUB_RUN_ATTEMPT,
      },
      githubClient(env.GITHUB_REPOSITORY),
    );
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  await main();
