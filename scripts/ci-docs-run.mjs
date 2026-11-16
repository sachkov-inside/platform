// @ts-check
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { classifyPath, selectCoverage } from "./ci-coverage-plan.mjs";
import { docsContextSchema, selectDocsEvidence } from "./ci-docs-evidence.mjs";
import { readPackageScripts } from "./package-scripts.mjs";

const contractFiles = {
  "scripts/check-agent-documentation.mjs":
    "96e735faf47f54cb34f45259935f3e6a59aa32e9",
  "scripts/check-materials-documentation.mjs":
    "2db86a99f3288b1b39ffedce5ea54200bc332a03",
  "scripts/check-new-em-dashes.mjs": "37b961f7c8dbdb31a3deeec950326291a5b26fd6",
  "scripts/documentation-references.mjs":
    "daec2e9733e255aec7b9014ebfe25ef9379663e4",
  "scripts/package-scripts.mjs": "0891e9fcda14076f8076de2a5915cfd3285756ed",
};
const commands = Object.keys(contractFiles).slice(0, 3);
const docsCommand = commands.map((path) => `node ${path}`).join(" && ");
/** @param {string|Buffer} value */
const hash = (value) => createHash("sha256").update(value).digest("hex");
/** @param {string} path */
async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Unexpected file data");
    digest.update(chunk);
  }
  return digest.digest("hex");
}

/** A bounded owned process; stdout is data, never a downloaded executable (#2266).
 * @param {string} command @param {string[]} args @param {{cwd:string,env:NodeJS.ProcessEnv,signal?:AbortSignal,timeout?:number,maxBytes?:number,forward?:boolean}} options
 */
export async function execute(command, args, options) {
  const child = spawnOwned(command, args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  /** @type {Buffer[]} */ const chunks = [];
  let bytes = 0;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {(reason:Error)=>void} */ let refuse = () => {};
  const bounded = new Promise(
    /** @param {(value:never)=>void} _ @param {(reason:Error)=>void} reject */ (
      _,
      reject,
    ) => {
      refuse = reject;
      timer = setTimeout(
        () => reject(new Error(`${command} observation timed out`)),
        options.timeout ?? 15000,
      );
    },
  );
  child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 2 * 1024 * 1024)) {
      refuse(new Error(`${command} output exceeds bound`));
      return;
    }
    chunks.push(chunk);
    if (options.forward === true) process.stdout.write(chunk);
  });
  child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 2 * 1024 * 1024))
      refuse(new Error(`${command} output exceeds bound`));
    if (options.forward === true) process.stderr.write(chunk);
  });
  try {
    const code = await Promise.race([commandExit(child), bounded]);
    if (code !== 0) throw new Error(`${command} failed (${String(code)})`);
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    await stopOwned(child);
  }
}

/** @param {string} root @param {NodeJS.ProcessEnv} env @param {AbortSignal} signal */
async function captureContext(root, env, signal) {
  /** @param {string[]} args */
  const git = async (args) =>
    (await execute("git", args, { cwd: root, env, signal }))
      .toString("utf8")
      .trim();
  const sourceSha = await git(["rev-parse", "HEAD"]);
  if (env["GITHUB_SHA"] !== undefined && env["GITHUB_SHA"] !== sourceSha)
    throw new Error("Checkout differs from Actions source");
  const comparisonBase = await git(["merge-base", "HEAD", "origin/main"]);
  const entries = (await git(["ls-tree", "-r", "--full-tree", "HEAD"])).split(
    "\n",
  );
  /** @param {string} entry */
  const significant = (entry) =>
    !(
      entry.startsWith("100644 blob ") &&
      classifyPath(entry.slice(entry.indexOf("\t") + 1)) === "documentation"
    );
  const producerHash = hash(entries.filter(significant).join("\n"));
  const accepted = (await git(["ls-tree", "-r", "--full-tree", "origin/main"]))
    .split("\n")
    .filter(significant)
    .join("\n");
  const currentBlobs = new Map(
    entries.map((row) => [row.slice(row.indexOf("\t") + 1), row.slice(12, 52)]),
  );
  const contractSupported =
    Object.entries(contractFiles).every(
      ([path, blob]) => currentBlobs.get(path) === blob,
    ) &&
    readPackageScripts(join(root, "package.json")).scripts["docs:check"] ===
      docsCommand;
  const clean =
    (await git(["status", "--porcelain", "--untracked-files=no"])) === "";
  const event = env["GITHUB_EVENT_NAME"] ?? "local";
  const paths = (
    await git(["diff", "--name-only", "--no-renames", comparisonBase, "HEAD"])
  )
    .split("\n")
    .filter(Boolean);
  const docsOnly =
    ["pull_request", "merge_group"].includes(event) &&
    selectCoverage(paths, event).required.join(",") === "docs";
  const gitPath = (await execute("which", ["git"], { cwd: root, env, signal }))
    .toString("utf8")
    .trim();
  const fingerprint = {
    contract: "tracked-docs-node-v1",
    node: process.version,
    nodeBinary: await hashFile(process.execPath),
    git: await git(["--version"]),
    gitBinary: await hashFile(gitPath),
    gitConfig: hash(
      (await git(["config", "--null", "--list"]))
        .split("\0")
        // Checkout credentials do not participate in these local, read-only Git operations.
        .filter((entry) => !/^http\..*\.extraheader\n/iu.test(entry))
        .sort()
        .join("\0"),
    ),
    os: platform(),
    arch: arch(),
    kernel: release(),
    imageOS: env["ImageOS"] ?? null,
    imageVersion: env["ImageVersion"] ?? null,
    variables: Object.fromEntries(
      [
        "CI",
        "GITHUB_ACTIONS",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "NODE_OPTIONS",
        "NODE_PATH",
        "HOME",
        "PATH",
        ...Object.keys(env).filter((key) => key.startsWith("GIT_")),
      ]
        .sort()
        .map((key) => [key, env[key] ?? null]),
    ),
  };
  const expectedNode = (
    await readFile(join(root, ".node-version"), "utf8")
  ).trim();
  const environmentComplete =
    platform() === "linux" &&
    arch() === "x64" &&
    env["RUNNER_ENVIRONMENT"] === "github-hosted" &&
    env["RUNNER_OS"] === "Linux" &&
    env["RUNNER_ARCH"] === "X64" &&
    env["ImageOS"] === "ubuntu24" &&
    (env["ImageVersion"] ?? "") !== "" &&
    process.version === `v${expectedNode}` &&
    env["CI"] === "true" &&
    env["GITHUB_ACTIONS"] === "true";
  const context = docsContextSchema.parse({
    version: 1,
    repository: env["GITHUB_REPOSITORY"] ?? "local/repository",
    event,
    sourceSha,
    treeSha: await git(["rev-parse", "HEAD^{tree}"]),
    comparisonBase,
    comparisonHash: hash(
      await execute(
        "git",
        [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--diff-filter=AMR",
          "-U0",
          comparisonBase,
          "HEAD",
          "--",
          "apps/web",
          "docs",
        ],
        { cwd: root, env, signal },
      ),
    ),
    producerHash,
    environmentHash: hash(JSON.stringify(fingerprint)),
    trustedProducer:
      contractSupported && clean && docsOnly && producerHash === hash(accepted),
    environmentComplete,
  });
  return { context, contractSupported };
}

/** Read-only JSON/ZIP provider port. @typedef {(path:string,binary?:boolean)=>Promise<Buffer>} ProviderRead */
/** @param {z.infer<typeof docsContextSchema>} current @param {ProviderRead} read @param {string} now */
export async function lookupDocsEvidence(current, read, now) {
  const runs = z
    .object({
      workflow_runs: z.array(
        z
          .object({
            id: z.number(),
            head_sha: z.string(),
            run_attempt: z.number(),
          })
          .passthrough(),
      ),
    })
    .parse(
      JSON.parse(
        (
          await read(
            `actions/workflows/ci.yml/runs?status=success&event=pull_request&per_page=10`,
          )
        ).toString("utf8"),
      ),
    );
  for (const run of runs.workflow_runs.slice(0, 10)) {
    try {
      const headCommit = z
        .object({ tree: z.object({ sha: z.string() }) })
        .passthrough()
        .parse(
          JSON.parse(
            (await read(`git/commits/${run.head_sha}`)).toString("utf8"),
          ),
        );
      if (headCommit.tree.sha !== current.treeSha) continue;
      const inventory = z
        .object({
          total_count: z.number(),
          artifacts: z.array(
            z
              .object({
                id: z.number(),
                name: z.string(),
                expired: z.boolean(),
                size_in_bytes: z.number(),
              })
              .passthrough(),
          ),
        })
        .parse(
          JSON.parse(
            (
              await read(`actions/runs/${run.id}/artifacts?per_page=100`)
            ).toString("utf8"),
          ),
        );
      if (
        inventory.total_count > 100 ||
        inventory.total_count !== inventory.artifacts.length
      )
        continue;
      /** @param {string} name @param {string} file */
      const artifactData = async (name, file) => {
        const matches = inventory.artifacts.filter(
          (item) =>
            item.name === name && !item.expired && item.size_in_bytes <= 65536,
        );
        const item = matches[0];
        if (matches.length !== 1 || item === undefined)
          throw new Error("Missing unique artifact");
        const zip = await read(`actions/artifacts/${item.id}/zip`, true);
        return { metadata: { ...item, zipHash: hash(zip) }, zip, file };
      };
      const docs = await artifactData(
        `ci-docs-evidence-${run.run_attempt}`,
        "docs-evidence.json",
      );
      const source = await artifactData(
        `ci-source-evidence-${run.run_attempt}`,
        "source-evidence.json",
      );
      /** @param {{zip:Buffer,file:string}} artifact */
      const unpack = async (artifact) => {
        const directory = await mkdtemp(join(tmpdir(), "ci-docs-artifact-"));
        try {
          const path = join(directory, "evidence.zip");
          await writeFile(path, artifact.zip);
          const bytes = await execute("unzip", ["-p", path, artifact.file], {
            cwd: directory,
            env: process.env,
            maxBytes: 65536,
          });
          return /** @type {unknown} */ (JSON.parse(bytes.toString("utf8")));
        } finally {
          await rm(directory, { recursive: true });
        }
      };
      const receipt = z
        .object({
          context: docsContextSchema,
        })
        .passthrough()
        .parse(await unpack(docs));
      const candidate = {
        run: /** @type {unknown} */ (
          JSON.parse((await read(`actions/runs/${run.id}`)).toString("utf8"))
        ),
        jobs: z
          .object({ total_count: z.number(), jobs: z.array(z.unknown()) })
          .parse(
            JSON.parse(
              (
                await read(
                  `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
                )
              ).toString("utf8"),
            ),
          ),
        headCommit,
        checkoutCommit: /** @type {unknown} */ (
          JSON.parse(
            (await read(`git/commits/${receipt.context.sourceSha}`)).toString(
              "utf8",
            ),
          )
        ),
        docsArtifact: docs.metadata,
        sourceArtifact: source.metadata,
        receipt,
        sourceEvidence: await unpack(source),
      };
      if (
        candidate.jobs.total_count > 100 ||
        candidate.jobs.total_count !== candidate.jobs.jobs.length
      )
        continue;
      const result = selectDocsEvidence({
        current,
        candidate: { ...candidate, jobs: candidate.jobs.jobs },
        now,
      });
      if (result.reused) {
        // A rerun can replace the provider's current attempt during observation.
        const latest = z
          .object({
            run_attempt: z.number(),
            head_sha: z.string(),
            status: z.string(),
            conclusion: z.string().nullable(),
          })
          .parse(
            JSON.parse((await read(`actions/runs/${run.id}`)).toString("utf8")),
          );
        if (
          latest.run_attempt === result.runAttempt &&
          latest.head_sha === run.head_sha &&
          latest.status === "completed" &&
          latest.conclusion === "success"
        )
          return result;
      }
    } catch {
      /* Missing or unverifiable provider evidence runs the ordinary checks (#2266). */
    }
  }
  return { reused: false, reason: "no-proved-identical-run" };
}

/** @param {{root?:string,env?:NodeJS.ProcessEnv,output?:string}} [options] */
export async function runDocsCI(options = {}) {
  const root = options.root ?? process.cwd(),
    env = options.env ?? process.env;
  const output =
    options.output ??
    join(root, "ci-artifacts/docs-evidence/docs-evidence.json");
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let capture;
  try {
    capture = await captureContext(root, env, cancellation.signal);
  } catch {
    capture = null;
  }
  /** @type {Awaited<ReturnType<typeof lookupDocsEvidence>>} */ let admission =
    { reused: false, reason: "unsupported-context" };
  const lookupStart = performance.now();
  try {
    if (
      capture?.context.event === "merge_group" &&
      capture.context.trustedProducer &&
      capture.context.environmentComplete
    ) {
      let reads = 0;
      /** @type {ProviderRead} */
      const read = async (path, binary = false) => {
        if (++reads > 40 || performance.now() - lookupStart > 60000)
          throw new Error("Provider lookup bound reached");
        return execute(
          "gh",
          ["api", `repos/${capture.context.repository}/${path}`],
          {
            cwd: root,
            env,
            signal: cancellation.signal,
            maxBytes: binary ? 65536 : 2 * 1024 * 1024,
            timeout: 10000,
          },
        );
      };
      try {
        admission = await lookupDocsEvidence(
          capture.context,
          read,
          new Date().toISOString(),
        );
      } catch {
        admission = { reused: false, reason: "provider-unavailable" };
      }
    }
    const lookupDurationMs = Math.round(performance.now() - lookupStart),
      started = performance.now();
    if (!admission.reused) {
      if (cancellation.signal.aborted)
        throw new Error("Documentation check interrupted");
      if (capture?.contractSupported) {
        const snapshot = await mkdtemp(join(tmpdir(), "ci-docs-source-"));
        try {
          const archive = join(snapshot, "source.tar");
          await execute(
            "git",
            ["archive", capture.context.sourceSha, `--output=${archive}`],
            { cwd: root, env, signal: cancellation.signal, timeout: 60000 },
          );
          await execute("tar", ["-xf", archive, "-C", snapshot], {
            cwd: root,
            env,
            signal: cancellation.signal,
            timeout: 60000,
          });
          await rm(archive);
          const gitdir = (
            await execute("git", ["rev-parse", "--absolute-git-dir"], {
              cwd: root,
              env,
              signal: cancellation.signal,
            })
          )
            .toString("utf8")
            .trim();
          for (const script of commands)
            await execute(
              process.execPath,
              [
                join(snapshot, script),
                ...(script.endsWith("check-new-em-dashes.mjs")
                  ? ["--base", capture.context.comparisonBase]
                  : []),
              ],
              {
                cwd: snapshot,
                env: {
                  ...env,
                  GIT_DIR: gitdir,
                  GIT_WORK_TREE: snapshot,
                  GIT_OPTIONAL_LOCKS: "0",
                },
                signal: cancellation.signal,
                timeout: 60000,
                forward: true,
              },
            );
        } finally {
          await rm(snapshot, { recursive: true });
        }
      } else
        await execute("pnpm", ["docs:check"], {
          cwd: root,
          env,
          signal: cancellation.signal,
          timeout: 180000,
          forward: true,
        });
    }
    const receipt = {
      version: 1,
      mode: admission.reused ? "reused" : "executed",
      runId: Number(env["GITHUB_RUN_ID"] ?? 0),
      runAttempt: Number(env["GITHUB_RUN_ATTEMPT"] ?? 0),
      context: capture?.context ?? null,
      durationMs: admission.reused
        ? 0
        : Math.round(performance.now() - started),
      lookupDurationMs,
      admission,
    };
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
    const summary = env["GITHUB_STEP_SUMMARY"];
    if (summary !== undefined)
      await appendFile(
        summary,
        `## Documentation evidence\n\n${receipt.mode}; lookup ${lookupDurationMs} ms; executed checks ${receipt.durationMs} ms.\n\n${JSON.stringify(admission)}\n`,
      );
    console.log(`Documentation evidence: ${receipt.mode}`);
    return receipt;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await runDocsCI();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
