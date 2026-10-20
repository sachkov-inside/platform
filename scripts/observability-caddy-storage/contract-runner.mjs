// @ts-check
import { fileURLToPath } from "node:url";
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";

/** @param {string[]} args */
export async function runCaddyContracts(args) {
  return runOwnedProcess(
    "python3",
    ["-B", "scripts/observability-caddy-storage/contract_runner.py", ...args],
    {
      timeoutMs: args[1] === "timeout" ? 700 : 15000,
      terminateGraceMs: 2500,
      cleanupBudgetMs: 5000,
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCaddyContracts(process.argv.slice(2));
  process.exitCode = result.reason === "exit" && result.code === 0 ? 0 : 1;
}
