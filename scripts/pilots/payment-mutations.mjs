// @ts-check
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnOwned, stopOwned } from "../owned-process.mjs";
import { commandExit } from "../diagnostic-command.mjs";
import { z } from "zod";
import { classifyMutationResult } from "./mutation-result.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(
  process.argv[2] ?? join(root, ".reports/2251/mutations"),
);
await mkdir(output, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sandbox = await mkdtemp(join(tmpdir(), "platform-payment-mutations-"));
const source =
  "apps/backend/src/modules/billing/facets/billing-payments/billing-payments.ts";
const decision = 'payment.Status === "CONFIRMED" || refunded';
const target = `if (${decision}) {`;
const mutants = [
  {
    name: "authorized-as-capture",
    expression: 'payment.Status === "AUTHORIZED" || refunded',
    expected: "killed",
    expectedFailed: 2,
    meaning: "grant on authorization without capture",
  },
  {
    name: "ignore-capture",
    expression: "false",
    expected: "killed",
    expectedFailed: 2,
    meaning: "never fulfill a captured payment",
  },
  {
    name: "unknown-as-capture",
    expression: `${decision} || payment.Status === "PAY_CHECKING"`,
    expected: "killed",
    expectedFailed: 1,
    meaning: "grant on an undecided payment",
  },
  {
    name: "equivalent-order",
    expression: 'refunded || payment.Status === "CONFIRMED"',
    expected: "survived",
    expectedFailed: 0,
    meaning: "equivalent: reorder pure boolean operands",
  },
  {
    name: "ignore-refund-proof",
    expression: 'payment.Status === "CONFIRMED"',
    expected: "survived",
    expectedFailed: 0,
    meaning: "coverage gap: refund can prove capture before CONFIRMED delivery",
  },
];
/** @type {Array<Record<string, unknown>>} */
const results = [];
const interruption = new AbortController();
process.once("SIGINT", () => interruption.abort());
process.once("SIGTERM", () => interruption.abort());
const startedAt = new Date().toISOString();
await writeFile(
  join(output, "run.json"),
  JSON.stringify({ head, sandbox, startedAt }, null, 2),
);

/** @param {string} name @param {string} command @param {string[]} args */
async function run(name, command, args) {
  const started = performance.now();
  const log = createWriteStream(join(output, `${name}.log`));
  const child = spawnOwned(command, args, {
    cwd: sandbox,
    env: {
      ...process.env,
      PROPERTY_SEED: "42",
      PAYMENT_MUTATION_ERRORS_PATH: join(output, `${name}.errors.json`),
    },
    signal: interruption.signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let deadline;
  try {
    const exitCode = await Promise.race([
      commandExit(child),
      /** @type {Promise<never>} */ (
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error(`${name} exceeded 120 seconds`)),
            120_000,
          );
        })
      ),
    ]);
    if (exitCode !== null && typeof exitCode !== "number")
      throw new Error("Invalid process result");
    return { exitCode, durationMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(deadline);
    await stopOwned(child);
    await Promise.all(
      [child.stdout, child.stderr]
        .filter((stream) => stream !== null)
        .map((stream) => finished(stream)),
    );
    await new Promise((resolve) => log.end(resolve));
  }
}

/** @param {string} name */
async function probe(name) {
  const report = join(output, `${name}.json`);
  await rm(report, { force: true });
  const errorsPath = join(output, `${name}.errors.json`);
  await rm(errorsPath, { force: true });
  const processResult = await run(name, "pnpm", [
    "--filter",
    "@inside/backend",
    "test:integration",
    "billing-sequences.test.ts",
    "--reporter=./test/support/payment-mutation-reporter.ts",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${report}`,
  ]);
  const data = z
    .object({
      numFailedTests: z.number(),
      numPassedTests: z.number(),
      testResults: z.array(
        z.object({
          assertionResults: z.array(
            z.object({ failureMessages: z.array(z.string()) }),
          ),
        }),
      ),
    })
    .parse(JSON.parse(await readFile(report, "utf8")));
  const failedTests = data.numFailedTests;
  const errors = z
    .object({
      tests: z.array(
        z.object({ state: z.string(), errors: z.array(z.unknown()) }),
      ),
      suiteErrors: z.array(z.unknown()),
    })
    .parse(JSON.parse(await readFile(errorsPath, "utf8")));
  const status = classifyMutationResult({
    exitCode: processResult.exitCode,
    ...errors,
  });
  if (
    errors.tests.filter((test) => test.state === "failed").length !==
    failedTests
  )
    throw new Error("Reporter counts disagree");
  return {
    name,
    status,
    failedTests,
    passedTests: Number(data.numPassedTests),
    ...processResult,
  };
}

try {
  const archive = join(sandbox, "source.tar");
  execFileSync("git", ["archive", head, `--output=${archive}`], { cwd: root });
  execFileSync("tar", ["-x", "-C", sandbox, "-f", archive]);
  await rm(archive);
  for (const [name, args] of /** @type {Array<[string, string[]]>} */ ([
    [
      "install",
      [
        "--filter",
        "@inside/backend...",
        "install",
        "--offline",
        "--frozen-lockfile",
      ],
    ],
    ["generate", ["build:generated"]],
  ])) {
    const result = await run(name, "pnpm", args);
    results.push({ name, ...result });
    if (result.exitCode !== 0) throw new Error(`${name} failed; see ${output}`);
  }
  const original = await readFile(join(sandbox, source), "utf8");
  if (original.split(target).length !== 2)
    throw new Error("Decision seam changed: expected exactly one match");
  const baseline = await probe("baseline");
  results.push(baseline);
  if (baseline.status !== "survived")
    throw new Error("Baseline must pass before mutation");
  for (const mutant of mutants) {
    await writeFile(
      join(sandbox, source),
      original.replace(target, `if (${mutant.expression}) {`),
    );
    const result = await probe(mutant.name);
    results.push({
      ...result,
      expected: mutant.expected,
      expectedFailed: mutant.expectedFailed,
      meaning: mutant.meaning,
    });
    await writeFile(join(sandbox, source), original);
    if (
      result.status !== mutant.expected ||
      result.failedTests !== mutant.expectedFailed
    )
      throw new Error(`Unexpected ${mutant.name}: ${result.status}`);
  }
} finally {
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      {
        head,
        source,
        target,
        seed: 42,
        startedAt,
        endedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  await rm(sandbox, { recursive: true, force: true });
  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify({ sandbox, removed: true }),
  );
}
console.log(`Mutation pilot complete: ${join(output, "summary.json")}`);
