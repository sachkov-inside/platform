import { spawn } from "node:child_process";
import { processDeadline } from "../process-deadline.mjs";
import { fileURLToPath } from "node:url";

let commandLease:
  | {
      token: string;
      register: (pid: number) => Promise<void>;
      finished: (pid: number) => void;
    }
  | undefined;
export function setCommandLease(lease: typeof commandLease) {
  commandLease = lease;
}

/** Own a complete subprocess group; the Docker owner separately removes exec'd containers. */
export async function command(
  program: string,
  args: readonly string[],
  options: {
    cwd?: string;
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    acceptFailure?: boolean;
  } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const lease = commandLease;
      const child = spawn(
        lease === undefined ? program : process.execPath,
        lease === undefined
          ? [...args]
          : [
              fileURLToPath(new URL("command-wrapper.mjs", import.meta.url)),
              lease.token,
            ],
        {
          cwd: options.cwd,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const deadline = processDeadline(child, options.timeoutMs ?? 120_000);
      const abort = () => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        } catch {
          /* Already closed. */
        }
      };
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdin.on("error", () => {
        /* A failed child may close before reading stdin. */
      });
      if (lease === undefined) child.stdin.end(options.input);
      else {
        void (async () => {
          if (child.pid === undefined) throw Error("Owned command has no PID");
          await lease.register(child.pid);
          child.stdin.end(
            JSON.stringify({
              program,
              args,
              ...(options.input === undefined ? {} : { input: options.input }),
            }),
          );
        })().catch((error: unknown) => {
          abort();
          reject(
            error instanceof Error ? error : Error("Command lease failed"),
          );
        });
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted === true) abort();
      child.once("error", (error) => {
        deadline.dispose();
        options.signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("close", (code) => {
        if (child.pid !== undefined) lease?.finished(child.pid);
        deadline.dispose();
        options.signal?.removeEventListener("abort", abort);
        if (
          (code === 0 || options.acceptFailure === true) &&
          !deadline.timedOut &&
          options.signal?.aborted !== true
        )
          resolve({ stdout, stderr, code });
        else
          reject(
            new Error(
              `${program} failed (${deadline.timedOut ? "timeout" : options.signal?.aborted === true ? "interrupted" : String(code)}): ${stderr.slice(-1500)}`,
            ),
          );
      });
    },
  );
}

export const docker = (
  args: readonly string[],
  options?: Parameters<typeof command>[2],
) => command("docker", args, options);

export async function assertNoLabResources(runId: string) {
  const containers = await docker([
    "ps",
    "-aq",
    "--filter",
    `label=inside.chapter-lab=${runId}`,
  ]);
  const networks = await docker([
    "network",
    "ls",
    "-q",
    "--filter",
    `label=inside.chapter-lab=${runId}`,
  ]);
  if (containers.stdout.trim() !== "" || networks.stdout.trim() !== "")
    throw Error("Owned lab resources remain after cleanup");
}
