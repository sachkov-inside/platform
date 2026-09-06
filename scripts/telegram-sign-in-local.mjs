import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = new URL(process.env.WEB_BASE_URL);
const api = new URL(process.env.BACKEND_BASE_URL);
if (web.hostname !== "127.0.0.1" || api.hostname !== "127.0.0.1" || process.env.NODE_ENV !== "development") {
  throw new Error("This launcher requires explicit loopback URLs and NODE_ENV=development");
}
const environment = {
  ...process.env, API_HOST: "127.0.0.1", API_PORT: api.port,
  MCP_HOST: "127.0.0.1", MCP_PORT: "3602",
  NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
};
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", ["--filter", "@inside/backend", command], { cwd: root, env: environment, stdio: "inherit" });
  if (result.status !== 0) process.exit(1);
}
const commands = [
  ["--filter", "@inside/web", "dev", "--hostname", "127.0.0.1", "--port", web.port],
  ...["dev:api", "dev:mcp", "dev:material-assets-worker", "dev:profile-avatars-worker", "dev:video-deletions-worker"].map(command => ["--filter", "@inside/backend", command]),
];
const children = commands.map(args => spawn("pnpm", args, { cwd: root, env: environment, stdio: "inherit", detached: true }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.pid && child.exitCode === null) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Child already exited. */ }
  }
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
for (const child of children) child.once("exit", code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
