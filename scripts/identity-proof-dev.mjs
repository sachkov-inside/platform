import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;
if (pnpmPath === undefined) {
  throw new Error("Run the identity proof through the pinned pnpm CLI");
}

const baseEnvironment = resolve(root, ".env");
if (existsSync(baseEnvironment)) {
  process.loadEnvFile(baseEnvironment);
}
const proofEnvironment = parseEnv(
  readFileSync(resolve(root, ".identity-proof/platform.env"), "utf8"),
);

const child = spawn(process.execPath, [pnpmPath, "dev"], {
  cwd: root,
  env: {
    ...process.env,
    ...proofEnvironment,
    NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolveExit) => {
  child.once("exit", (code) => resolveExit(code ?? 1));
});
process.exitCode = exitCode;
