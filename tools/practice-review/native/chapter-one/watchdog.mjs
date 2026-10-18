// @ts-check
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { fileURLToPath } from "node:url";

const messageSchema = z.union([
  z.object({ labId: z.uuid() }).strict(),
  z
    .object({
      composeProject: z
        .string()
        .regex(
          /^inside-chapter-fixture-[a-f0-9]{8}-(?:local-evidence|alternative|defect|missing-evidence|injection)$/u,
        ),
    })
    .strict(),
  z
    .object({ processGroup: z.number().int().positive(), leaseToken: z.uuid() })
    .strict(),
  z.object({ finishedGroup: z.number().int().positive() }).strict(),
]);
/** @type {Set<string>} */
const labels = new Set();
/** @type {Map<number,string>} */
const processes = new Map();
let pending = "";
let invalid = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += String(chunk);
  let end;
  while ((end = pending.indexOf("\n")) !== -1) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    try {
      const raw = /** @type {unknown} */ (JSON.parse(line));
      const message = messageSchema.parse(raw);
      if ("processGroup" in message)
        processes.set(message.processGroup, message.leaseToken);
      else if ("finishedGroup" in message)
        processes.delete(message.finishedGroup);
      else
        labels.add(
          "labId" in message
            ? `inside.chapter-lab=${message.labId}`
            : `com.docker.compose.project=${message.composeProject}`,
        );
    } catch {
      invalid = true;
    }
  }
});
process.stdin.on("end", () => {
  void cleanup();
});

async function cleanup() {
  /** @type {string[]} */
  const failures = [];
  if (invalid || pending !== "") failures.push("invalid-lease-message");
  /** @param {string[]} args */
  const docker = (args) =>
    spawnSync("docker", args, {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  for (const [pid, token] of processes) {
    const current = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (
      current.status === 0 &&
      current.stdout.includes(
        `${fileURLToPath(new URL("command-wrapper.mjs", import.meta.url))} ${token}`,
      )
    ) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* The command may have just completed. */
      }
    }
  }
  const deadline = performance.now() + 15000;
  let absentSince;
  for (;;) {
    /** @type {string[]} */
    const sweepFailures = [];
    for (const label of labels) {
      for (const kind of ["container", "network"]) {
        const listArgs =
          kind === "container" ? ["ps", "-aq"] : ["network", "ls", "-q"];
        const listed = docker([...listArgs, "--filter", `label=${label}`]);
        if (listed.status !== 0) {
          sweepFailures.push(`list:${kind}:${label}`);
          continue;
        }
        const ids = listed.stdout.trim().split(/\s+/u).filter(Boolean);
        if (ids.length > 0)
          docker(
            kind === "container"
              ? ["rm", "-f", ...ids]
              : ["network", "rm", ...ids],
          );
        const remaining = docker([...listArgs, "--filter", `label=${label}`]);
        if (remaining.status !== 0 || remaining.stdout.trim() !== "")
          sweepFailures.push(`remaining:${kind}:${label}`);
      }
    }

    if (sweepFailures.length === 0) {
      absentSince ??= performance.now();
      if (performance.now() - absentSince >= 2000) break;
    } else absentSince = undefined;
    if (performance.now() >= deadline) {
      failures.push(...sweepFailures, "resource-settlement-timeout");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const target = process.argv[2];
  if (target !== undefined)
    writeFileSync(
      target,
      JSON.stringify({ labels: [...labels], failures }, null, 2),
      { mode: 0o600 },
    );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
