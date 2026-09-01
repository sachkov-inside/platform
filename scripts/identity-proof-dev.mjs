import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { readIdentityProofEndpoints } from "./identity-proof-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;
if (pnpmPath === undefined) {
  throw new Error("Run the identity proof through the pinned pnpm CLI");
}

const proofEnvironment = parseEnv(
  readFileSync(resolve(root, ".identity-proof/platform.env"), "utf8"),
);
const { apiPort, webPort } = readIdentityProofEndpoints(process.env);

const child = spawn(process.execPath, [pnpmPath, "dev"], {
  cwd: root,
  env: {
    ...process.env,
    ...proofEnvironment,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
    PORT: String(webPort),
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
