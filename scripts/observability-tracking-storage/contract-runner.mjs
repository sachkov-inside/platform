// @ts-check
import { fileURLToPath } from "node:url";
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";

/** @param {string[]} args @param {{timeoutMs?:number}} [options] */
export async function runTrackingContracts(args, options = {}) {
  return runOwnedProcess(
    "python3",
    [
      "-B",
      "scripts/observability-tracking-storage/contract_runner.py",
      ...args,
    ],
    {
      timeoutMs: options.timeoutMs ?? 15000,
      // Python capture owns native-child reap, including its two-second TERM grace.
      terminateGraceMs: 2500,
      cleanupBudgetMs: 5000,
    },
  );
}

// Private native regression CLI; the ordinary test wrapper calls the same owner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runTrackingContracts(process.argv.slice(2), {
    timeoutMs: process.argv[3] === "timeout" ? 700 : 15000,
  });
  process.exitCode = result.code === 0 && result.reason === "exit" ? 0 : 1;
}
