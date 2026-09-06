import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapSession } from "@logto/node";
import { signalProcessGroup } from "./process-group-signal.mjs";
const directory = await mkdtemp(join(tmpdir(), "inside-communications-smoke-"));
const fixturePath = join(directory, "fixture.json");
const children = [];
const output = [];
function start(args, env) {
  const child = spawn("pnpm", args, { detached: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { output.push(data.toString()); });
  child.stderr.on("data", data => { output.push(data.toString()); });
  children.push(child); return child;
}
async function waitFor(operation, child) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Child exited: ${String(child.exitCode)}`);
    try { const result = await operation(); if (result) return result; } catch { /* Startup is polled until ready. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Communications smoke startup timed out");
}
async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port"); await new Promise(resolve => server.close(resolve)); return address.port; }
try {
  const fixture = start(["--filter", "@inside/backend", "exec", "tsx", "scripts/communications-browser-fixture.ts"], { COMMUNICATIONS_FIXTURE_PATH: fixturePath });
  const state = await waitFor(async () => JSON.parse(await readFile(fixturePath, "utf8")), fixture);
  const port = await freePort();
  const webUrl = `http://127.0.0.1:${String(port)}`;
  const cookieSecret = "synthetic-communications-cookie-key";
  const session = await wrapSession({ idToken: "synthetic.id.token", accessToken: JSON.stringify({ [`@${state.LOGTO_AUDIENCE}`]: { token: state.token, scope: "", expiresAt: Math.floor(Date.now() / 1000) + 300 } }) }, cookieSecret);
  const env = { ...state, NODE_ENV: "development", LOGTO_APP_ID: "communications-smoke", LOGTO_APP_SECRET: "synthetic-app-secret", LOGTO_COOKIE_SECRET: cookieSecret, LOGTO_ENDPOINT: "https://communications.smoke.test", WEB_BASE_URL: webUrl, FULLSTACK_WEB_BASE_URL: webUrl, FULLSTACK_LOGTO_COOKIE_NAME: "logto_communications-smoke", FULLSTACK_LOGTO_SESSION: session, COMMUNICATIONS_PROVIDER_URL: state.providerUrl };
  const web = start(["--filter", "@inside/web", "dev", "--hostname", "127.0.0.1", "--port", String(port)], env);
  await waitFor(async () => (await fetch(`${webUrl}/authoring/communications`)).ok, web);
  const test = start(["--filter", "@inside/web", "exec", "playwright", "test", "--config", "playwright.fullstack.config.ts", "communications.spec.ts"], env);
  const code = await new Promise(resolve => test.on("exit", resolve));
  if (code !== 0) throw new Error(`Browser assertions failed: ${String(code)}`);
  process.stdout.write("Communications browser/HTTP smoke passed on desktop and mobile against real Nest/PostgreSQL and a Telegram contract stub.\n");
} catch (error) {
  process.stderr.write(output.join("").slice(-18000));
  throw error;
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    signalProcessGroup(child.pid, "SIGTERM");
    await Promise.race([new Promise(resolve => child.on("exit", resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
    if (child.exitCode === null) signalProcessGroup(child.pid, "SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
