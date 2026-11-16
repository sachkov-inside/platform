// @ts-check
// `pnpm stand:finish`: the stand part of `agent-worktree finish` (the `finish` steps of
// `.worktree-resources.json`). It stops this worktree's light instance and releases the shared
// stand reservation only when this worktree holds it. A failed or hanging step is reported and
// the command still exits 0, so the worktree cleanup goes on; a reservation left behind is
// released by the next stand operation once the worktree directory is gone.
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { commandExit } from "./diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";

// The release may wait in the stand queue behind an image build; finish does not wait longer.
const stepTimeLimitMilliseconds = 5 * 60_000;

export const standFinishSteps = Object.freeze([
  { name: "light instance", args: ["stand:light", "down"] },
  { name: "stand reservation", args: ["stand", "release", "--if-owned"] },
]);

/**
 * @param {object} options
 * @param {readonly { name: string; args: string[] }[]} options.steps
 * @param {(args: string[]) => Promise<number | null>} options.run exit status of one step; null after a signal
 * @param {(message: string) => void} options.report
 */
export async function finishStand({ steps, run, report }) {
  for (const step of steps) {
    try {
      const code = await run(step.args);
      if (code !== 0)
        report(
          `${step.name}: exited with ${String(code)}; finish continues, see the output above`,
        );
    } catch (error) {
      report(
        `${step.name}: ${error instanceof Error ? error.message : "failed"}; finish continues`,
      );
    }
  }
}

/**
 * Runs one pnpm step as an owned process tree and stops the whole tree at the time limit.
 * @param {{ pnpmPath: string; cwd: string; args: string[]; limitMilliseconds: number }} options
 * @returns {Promise<number | null>} exit status; null after a signal
 */
export async function runStep({ pnpmPath, cwd, args, limitMilliseconds }) {
  const child = spawnOwned(...pnpmInvocation(pnpmPath, args), {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
  });
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  /** @type {Promise<never>} */
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("time limit reached"));
    }, limitMilliseconds);
  });
  try {
    return await Promise.race([commandExit(child), limit]);
  } finally {
    clearTimeout(timer);
    await stopOwned(child);
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const pnpmPath = process.env["npm_execpath"];
  if (pnpmPath === undefined)
    throw new Error("Run the stand finish through pnpm stand:finish");
  const worktree = process.env["INIT_CWD"] ?? process.cwd();
  await finishStand({
    steps: standFinishSteps,
    run: (args) =>
      runStep({
        pnpmPath,
        cwd: worktree,
        args,
        limitMilliseconds: stepTimeLimitMilliseconds,
      }),
    report: (message) => process.stderr.write(`Stand finish: ${message}\n`),
  });
}
