import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** A detached supervisor sees pipe EOF even when the experiment is killed without a signal handler. */
export function startResourceLease(report: string) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("watchdog.mjs", import.meta.url)), report],
    {
      detached: true,
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(Error("Resource watchdog failed"));
    });
  });
  child.stdin.on("error", () => {
    /* register() receives the write error; close() joins the exit. */
  });
  // Keep an early spawn failure observed until close() joins it.
  void closed.catch(() => undefined);
  return {
    async register(
      message:
        | { labId: string }
        | { composeProject: string }
        | { processGroup: number; leaseToken: string }
        | { finishedGroup: number },
    ) {
      await new Promise<void>((resolve, reject) =>
        child.stdin.write(JSON.stringify(message) + "\n", (error) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        }),
      );
    },
    finished(pid: number) {
      child.stdin.write(JSON.stringify({ finishedGroup: pid }) + "\n");
    },
    async close() {
      child.stdin.end();
      await closed;
    },
  };
}
