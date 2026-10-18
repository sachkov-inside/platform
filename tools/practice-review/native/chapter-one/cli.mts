import { z } from "zod";
import { parseArgs } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chapterSnapshotSchema, chapterTaskCodes } from "./contracts.mjs";
import { command, docker, setCommandLease } from "./process.mjs";
import { startChapterStand } from "./stand.mjs";
import { checkPersistence } from "./acceptance.mjs";
import { prepareProject, expectedStatuses, scenarios } from "./fixtures.mjs";
import { observeProject } from "./observe.mjs";
import { runAgent } from "./agent.mjs";
import { startResourceLease } from "./lease.mjs";

const options = parseArgs({
  options: {
    contracts: { type: "boolean", default: false },
    fixtures: { type: "boolean", default: false },
    output: { type: "string" },
    scenario: { type: "string" },
    task: { type: "string" },
    model: { type: "string", default: "gpt-6.1-sol" },
    timeout: { type: "string", default: "240000" },
  },
}).values;
if (
  options.scenario !== undefined &&
  !scenarios.some((scenario) => scenario === options.scenario)
)
  throw Error("Unknown scenario");
if (
  options.task !== undefined &&
  !(chapterTaskCodes as readonly string[]).includes(options.task)
)
  throw Error("Task is outside frozen chapter one");
const timeoutMs = Number(options.timeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000)
  throw Error("Timeout must be 1000–600000 ms");
const runId = randomUUID();
const output = resolve(options.output ?? `.reports/chapter-one-lab/${runId}`);
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const frozen = await readFile(
  new URL("snapshot.json", import.meta.url),
  "utf8",
);
const snapshot = chapterSnapshotSchema.parse(JSON.parse(frozen));
const controller = new AbortController();
const interrupted = () => {
  controller.abort();
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
const summary: {
  runId: string;
  contentCommit: string;
  snapshotSha256: string;
  platformSource?: string;
  labInputsSha256?: string;
  workingTreeStatus?: string;
  labInputsEndSha256?: string;
  fixtures: {
    scenario: string;
    commit: string;
    commands: { command: string; code: number | null }[];
  }[];
  model: string;
  agentImage?: string;
  contracts: string[];
  trials: unknown[];
  failures: string[];
  limitations: string[];
  cleanup: string;
} = {
  runId,
  contentCommit: snapshot.commit,
  snapshotSha256: createHash("sha256").update(frozen).digest("hex"),
  model: options.model,
  contracts: [],
  trials: [],
  fixtures: [],
  failures: [],
  cleanup: "pending",
  limitations: [
    "Synthetic learner authorization with host-issued PKCE grant, not native-client OAuth or real Logto.",
    "Task definitions are frozen from committed YAML and seeded into the real schema; authoring import, Reader and full lesson rendering are not exercised.",
    "No live GitHub repository, Issues, CI, PR or merge evidence; these criteria must remain unverified or show the observed configuration violation.",
    "Local reports are agent self-checks, not grades, learning proof or production acceptance.",
    "Only this source protocol is exercised; other running stands may use a newer protocol.",
  ],
};
const save = () =>
  writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
async function inputsDigest(repository: string) {
  const inputRoot = fileURLToPath(new URL("./", import.meta.url));
  const inputHash = createHash("sha256");
  for (const file of (
    await readdir(inputRoot, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .sort((a, b) =>
      join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)),
    )) {
    inputHash.update(join(file.parentPath, file.name).slice(inputRoot.length));
    inputHash.update(await readFile(join(file.parentPath, file.name)));
  }
  inputHash.update(await readFile(join(repository, "package.json")));
  return inputHash.digest("hex");
}
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
let stand: Awaited<ReturnType<typeof startChapterStand>> | undefined;
const lease = startResourceLease(join(output, "watchdog.json"));
setCommandLease({
  token: runId,
  register: (pid) => lease.register({ processGroup: pid, leaseToken: runId }),
  finished: (pid) => {
    lease.finished(pid);
  },
});
try {
  summary.platformSource = (
    await command("git", ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  summary.workingTreeStatus = (
    await command("git", ["-C", repository, "status", "--porcelain"])
  ).stdout;
  summary.labInputsSha256 = await inputsDigest(repository);
  summary.agentImage = (
    await docker([
      "image",
      "inspect",
      "inside-chapter-one-agent:0.163.0",
      "--format",
      "{{.Id}}",
    ])
  ).stdout.trim();
  await save();
  console.log(`Chapter-one lab ${runId}: ${output}`);
  await lease.register({ labId: runId });
  stand = await startChapterStand(snapshot, runId, controller.signal);
  summary.contracts = await checkPersistence(stand, snapshot);
  console.log(
    `Persistence and context: ${String(summary.contracts.length)} passed`,
  );
  await save();
  if (!options.contracts) {
    for (const scenario of options.scenario === undefined
      ? scenarios
      : [z.enum(scenarios).parse(options.scenario)]) {
      const scenarioRoot = join(output, scenario);
      await mkdir(scenarioRoot);
      const project = join(scenarioRoot, "project");
      const prepared = await prepareProject(
        project,
        scenario,
        controller.signal,
        summary.agentImage,
        runId,
      );
      if (scenario !== "missing-evidence") {
        await lease.register({
          composeProject: `inside-chapter-fixture-${runId.slice(0, 8)}-${scenario}`,
        });
        const observations = await observeProject(
          project,
          `${runId.slice(0, 8)}-${scenario}`,
          prepared.commit,
          controller.signal,
          summary.agentImage,
          runId,
        );
        await writeFile(
          join(scenarioRoot, "observations.json"),
          JSON.stringify(observations, null, 2),
        );
        summary.fixtures.push({
          scenario,
          commit: prepared.commit,
          commands: observations.map(({ command, code }) => ({
            command,
            code,
          })),
        });
        if (scenario === "local-evidence" || scenario === "alternative") {
          const unexpected = observations.filter((item) =>
            item.command.includes("temporary forbidden")
              ? item.code === 0
              : item.code !== 0,
          );
          if (unexpected.length > 0)
            throw Error(
              `Invalid positive fixture: ${unexpected.map((item) => item.command).join(", ")}`,
            );
        }
      }
      if (options.fixtures) {
        await save();
        continue;
      }
      for (const task of snapshot.tasks.filter(
        (item) => options.task === undefined || item.code === options.task,
      )) {
        const trial = join(scenarioRoot, task.code);
        await mkdir(trial);
        const trialId = randomUUID();
        await lease.register({ labId: trialId });
        console.log(`Review: ${scenario} / ${task.code}`);
        try {
          const result = await runAgent({
            stand,
            project,
            output: trial,
            code: task.code,
            expected: expectedStatuses(task.code, scenario),
            runId: trialId,
            model: options.model,
            signal: controller.signal,
            timeoutMs,
            injection: scenario === "injection",
            image: summary.agentImage,
          });
          summary.trials.push({
            scenario,
            task: task.code,
            projectCommit: prepared.commit,
            ...result,
          });
          console.log(
            `${result.failures.length === 0 ? "PASS" : "FAIL"}: ${result.failures.join(", ")}`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown failure";
          summary.trials.push({
            scenario,
            task: task.code,
            failures: ["infrastructure-or-process-failure"],
            error: message,
          });
          console.log(`FAIL: ${message.slice(0, 240)}`);
          if (controller.signal.aborted) throw error;
        }
        await save();
      }
    }
  }
} catch (error) {
  summary.failures.push(
    error instanceof Error ? error.message : "Unknown failure",
  );
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  try {
    try {
      await stand?.close();
    } finally {
      setCommandLease(undefined);
      await lease.close();
    }
    summary.cleanup =
      "owned database, servers and per-trial containers stopped";
  } catch {
    summary.cleanup = "cleanup failed; inspect labelled resources";
    process.exitCode = 1;
  }
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  summary.labInputsEndSha256 = await inputsDigest(repository);
  if (summary.labInputsSha256 !== summary.labInputsEndSha256) {
    summary.failures.push("lab-inputs-changed-during-run");
    process.exitCode = 1;
  }
  await save();
}
if (
  summary.trials.some(
    (trial) =>
      typeof trial === "object" &&
      trial !== null &&
      "failures" in trial &&
      Array.isArray(trial.failures) &&
      trial.failures.length > 0,
  )
)
  process.exitCode = 1;
console.log(`Evidence: ${join(output, "summary.json")}`);
