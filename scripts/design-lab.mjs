// @ts-check
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

// Prototype #1468: the existing supervisor owns the complete Storybook process tree.
const requestedPort = Number(process.env["DESIGN_LAB_PORT"] ?? 0);
if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 0 ||
  requestedPort > 65535
)
  throw new Error("DESIGN_LAB_PORT must be an integer between 0 and 65535");
const probe = createServer();
/** @type {number} */
const port = await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(requestedPort, "127.0.0.1", () => {
    const address = probe.address();
    if (address === null || typeof address === "string") {
      probe.close();
      reject(new Error("No loopback port was assigned"));
      return;
    }
    probe.close((error) =>
      error === undefined ? resolve(address.port) : reject(error),
    );
  });
});
console.log(
  `Design laboratory #1468: http://localhost:${port}/iframe.html?id=prototypes-design-lab--overview&viewMode=story`,
);
console.log(
  `Owner PID: ${process.pid}; stop: kill -TERM ${process.pid}; restart: pnpm design:lab`,
);
let interrupted = false;
const child = spawnOwned(
  "pnpm",
  [
    "exec",
    "storybook",
    "dev",
    "--config-dir",
    ".storybook-lab",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--exact-port",
    "--no-open",
    "--disable-telemetry",
  ],
  {
    cwd: fileURLToPath(new URL("../apps/web", import.meta.url)),
    stdio: "inherit",
  },
);
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interrupted = true;
    void stopOwned(child);
  });
}
try {
  process.exitCode = (await commandExit(child)) ?? 1;
  if (interrupted) process.exitCode = 0;
} finally {
  await stopOwned(child);
}
