// @ts-check
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";

/** Existing default process owner budgets and group ownership, no extra session or runtime work. */
export function runPostgresContracts() {
  return runOwnedProcess("python3", [
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-postgres-storage",
  ]);
}
