import assert from "node:assert/strict";
import { stopOwned } from "../../owned-process.mjs";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRestorePostgres } from "../domain-restore/postgres.mjs";

// These stop failed diagnostics; they are not readiness delays or retry budgets.
export const failureBudgets = {
  capability: 60_000,
  http: 10_000,
  database: 10_000,
  childCleanup: 15_000,
  serverCleanup: 15_000,
};

export async function bounded(label, milliseconds, operation, signal) {
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(
        new Error(`${label} failure budget exceeded (${milliseconds} ms)`),
      ),
    milliseconds,
  );
  const combined = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;
  let rejectAbort;
  try {
    combined.throwIfAborted();
    return await Promise.race([
      Promise.resolve().then(() => operation(combined)),
      new Promise((_resolve, reject) => {
        rejectAbort = () => reject(combined.reason);
        combined.addEventListener("abort", rejectAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (rejectAbort) combined.removeEventListener("abort", rejectAbort);
  }
}

export async function createTransferOwnership(output) {
  const name = `inside-mixed-restore-${randomUUID()}`;
  const interrupted = new AbortController();
  const handlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal,
      () => {
        process.exitCode = signal === "SIGINT" ? 130 : 143;
        interrupted.abort(new Error(`Diagnostic interrupted by ${signal}`));
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.once(signal, handler);
  let postgres;
  let acquisitionStarted = false;
  return {
    name,
    signal: interrupted.signal,
    async postgres() {
      interrupted.signal.throwIfAborted();
      // The daemon-owned container has its own bounded bootstrap and TCP EOF cleanup.
      // Host supervisors cannot kill that cleanup together with the diagnostic's process tree.
      postgres = await createRestorePostgres("domain-contract-transfer", {
        containerName: name,
        daemonLifetime: output,
        onContainerAcquired: () => {
          acquisitionStarted = true;
          process.stdout.write(
            JSON.stringify({
              phase: "owned-Docker-acquisition-started",
              name,
              pid: process.pid,
            }) + "\n",
          );
        },
      });
      interrupted.signal.throwIfAborted();
      return postgres;
    },
    async close() {
      try {
        await postgres?.close();
        const outcomes = [
          {
            resource: "externalDockerOwner",
            name,
            mechanism: "daemon TCP lifeline",
            success: postgres
              ? postgres.evidence.containerAbsent === true
              : !acquisitionStarted,
          },
        ];
        await writeFile(
          resolve(output, "docker-owner.json"),
          JSON.stringify(outcomes[0], null, 2),
        );
        return outcomes;
      } finally {
        for (const [signal, handler] of handlers)
          process.removeListener(signal, handler);
      }
    },
  };
}

export async function stopDiagnosticChild(child, children) {
  await bounded("capability process cleanup", failureBudgets.childCleanup, () =>
    stopOwned(child),
  );
  assert(
    child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null,
    "Capability process did not settle",
  );
  children.delete(child);
}
