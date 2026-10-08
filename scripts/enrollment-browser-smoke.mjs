// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapSession } from "@logto/node";
import { z } from "zod";
import { reservePort, startWithRoutes } from "./smoke-stand.mjs";
// The backend fixture writes its stand environment as strings; the smoke reads three of them.
const fixtureStateSchema = z
  .object({
    LOGTO_AUDIENCE: z.string(),
    token: z.string(),
    providerUrl: z.string(),
  })
  .catchall(z.string());
const directory = await mkdtemp(join(tmpdir(), "inside-enrollment-smoke-"));
const fixturePath = join(directory, "fixture.json");
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {string[]} */
const output = [];
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
/** @type {Promise<void> | undefined} */
let cleanupPromise;
function cleanup() {
  cleanupPromise ??= Promise.all(
    children.map((child) => stopOwned(child)),
  ).then(() => undefined);
  return cleanupPromise;
}
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void cleanup();
  });
}
/**
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function start(args, env) {
  if (interruptedSignal !== undefined) throw new Error("Smoke interrupted");
  const child = spawnOwned("pnpm", args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (/** @type {Buffer} */ data) => {
    output.push(data.toString());
    process.stdout.write(data);
  });
  child.stderr?.on("data", (/** @type {Buffer} */ data) => {
    output.push(data.toString());
    process.stdout.write(data);
  });
  child.once("error", (error) => output.push(String(error)));
  children.push(child);
  return child;
}
/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<T>}
 */
async function waitFor(operation, child) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (
      interruptedSignal !== undefined ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      throw new Error(
        `Child exited: ${String(child.exitCode ?? child.signalCode)}`,
      );
    try {
      const result = await operation();
      if (result) return result;
    } catch {
      /* Startup is polled until ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Enrollment smoke startup timed out");
}
try {
  const fixture = start(
    [
      "--filter",
      "@inside/backend",
      "exec",
      "tsx",
      "scripts/enrollment-browser-fixture.ts",
    ],
    { ENROLLMENT_FIXTURE_PATH: fixturePath },
  );
  const state = await waitFor(
    async () =>
      fixtureStateSchema.parse(JSON.parse(await readFile(fixturePath, "utf8"))),
    fixture,
  );
  const port = await reservePort();
  const webUrl = `http://127.0.0.1:${String(port)}`;
  const cookieSecret = "synthetic-enrollment-cookie-key-624-local";
  const session = await wrapSession(
    {
      idToken: "synthetic.id.token",
      accessToken: JSON.stringify({
        [`@${state.LOGTO_AUDIENCE}`]: {
          token: state.token,
          scope: "",
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        },
      }),
    },
    cookieSecret,
  );
  const env = {
    ...state,
    NODE_ENV: "development",
    LOGTO_APP_ID: "enrollment-smoke",
    LOGTO_APP_SECRET: "synthetic-app-secret",
    LOGTO_COOKIE_SECRET: cookieSecret,
    LOGTO_ENDPOINT: "https://enrollment.smoke.test",
    WEB_BASE_URL: webUrl,
    FULLSTACK_WEB_BASE_URL: webUrl,
    FULLSTACK_LOGTO_COOKIE_NAME: "logto_enrollment-smoke",
    FULLSTACK_LOGTO_SESSION: session,
    ENROLLMENT_PROVIDER_URL: state.providerUrl,
  };
  // Адреса, к которым обращается сценарий: сервер без любого из них перезапускается. У адреса,
  // который принимает только POST, существующий маршрут отвечает на GET кодом 405, а не 404.
  await startWithRoutes({
    baseUrl: webUrl,
    routes: [
      "/",
      "/welcome",
      "/authoring/billing",
      "/account",
      "/account/subscription",
      "/auth/status",
      "/api/account",
      "/api/account/billing",
      "/api/account/billing/community-admission",
      "/api/account/billing/contact",
      "/api/account/billing/enrollments",
      "/api/account/terms",
      "/api/authoring/billing/activation-rules/list",
      "/api/authoring/billing/activation-rules/save",
      "/api/authoring/billing/content/list",
      "/api/authoring/billing/enrollments/apply-expansion",
      "/api/authoring/billing/enrollments/assign",
      "/api/authoring/billing/enrollments/change",
      "/api/authoring/billing/enrollments/list",
      "/api/authoring/billing/enrollments/preview-expansion",
      "/api/authoring/billing/offers/save",
      "/api/authoring/billing/recipients/lookup",
      "/api/authoring/billing/respondents/status",
      "/api/authoring/billing/tiers/list",
      "/api/authoring/billing/tribute/status",
      "/api/home/materials",
      "/api/personal-home",
    ],
    start: () =>
      start(
        [
          "--filter",
          "@inside/web",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        env,
      ),
    stop: (web) => stopOwned(web),
    ready: (web) =>
      waitFor(
        async () =>
          (
            await fetch(`${webUrl}/authoring/billing`, {
              signal: AbortSignal.timeout(30_000),
            })
          ).status < 500,
        web,
      ),
  });
  const test = start(
    [
      "--filter",
      "@inside/web",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.enrollment.config.ts",
      "enrollment.spec.ts",
    ],
    env,
  );
  const code = await commandExit(test);
  if (code !== 0) throw new Error(`Browser assertions failed: ${String(code)}`);
  process.stdout.write(
    "Enrollment browser/HTTP smoke passed on desktop and mobile against real Nest/PostgreSQL and synthetic identity only.\n",
  );
} catch (error) {
  process.stderr.write(output.join("").slice(-18000));
  if (interruptedSignal === undefined) throw error;
} finally {
  await cleanup();
  await rm(directory, { recursive: true, force: true });
}

if (interruptedSignal !== undefined)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
