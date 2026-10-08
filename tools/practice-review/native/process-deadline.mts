import { isOwnedProcess, stopOwned } from "../../../scripts/owned-process.mjs";
import type { ChildProcess } from "node:child_process";
import { signalProcessGroup } from "../../../scripts/process-group-signal.mjs";

/** Bounds owned detached process groups, including children which ignore SIGTERM. */
export function processDeadline(
  child: ChildProcess,
  timeoutMs: number,
  graceMs = 1000,
) {
  let timedOut = false;
  let stopping = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    if (stopping || child.pid === undefined) return;
    stopping = true;
    if (isOwnedProcess(child)) {
      void stopOwned(child, graceMs);
      return;
    }
    if (!signalProcessGroup(child.pid, "SIGTERM")) child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.pid !== undefined && !signalProcessGroup(child.pid, "SIGKILL"))
        child.kill("SIGKILL");
    }, graceMs);
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  function dispose() {
    clearTimeout(timeout);
    if (killTimer !== undefined) clearTimeout(killTimer);
  }
  child.once("close", dispose);
  child.once("error", dispose);
  return {
    get timedOut() {
      return timedOut;
    },
    stop,
    dispose,
  };
}
