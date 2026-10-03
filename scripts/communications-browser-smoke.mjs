// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapSession } from "@logto/node";
import { z } from "zod";
import {
  reservePort,
  startWithRoutes,
  stopProcessGroup,
  stopServerOnPort,
} from "./smoke-stand.mjs";
// The backend fixture writes its stand environment as strings; the smoke reads three of them.
const fixtureStateSchema = z
  .object({
    LOGTO_AUDIENCE: z.string(),
    token: z.string(),
    providerUrl: z.string(),
  })
  .catchall(z.string());
const directory = await mkdtemp(join(tmpdir(), "inside-communications-smoke-"));
const fixturePath = join(directory, "fixture.json");
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {string[]} */
const output = [];
/**
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function start(args, env) {
  const child = spawn("pnpm", args, {
    detached: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (/** @type {Buffer} */ data) => {
    output.push(data.toString());
  });
  child.stderr.on("data", (/** @type {Buffer} */ data) => {
    output.push(data.toString());
  });
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
    if (child.exitCode !== null || child.signalCode !== null)
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
  throw new Error("Communications smoke startup timed out");
}
try {
  const fixture = start(
    [
      "--filter",
      "@inside/backend",
      "exec",
      "tsx",
      "scripts/communications-browser-fixture.ts",
    ],
    { COMMUNICATIONS_FIXTURE_PATH: fixturePath },
  );
  const state = await waitFor(
    async () =>
      fixtureStateSchema.parse(JSON.parse(await readFile(fixturePath, "utf8"))),
    fixture,
  );
  const port = await reservePort();
  const webUrl = `http://127.0.0.1:${String(port)}`;
  const cookieSecret = "synthetic-communications-cookie-key";
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
    LOGTO_APP_ID: "communications-smoke",
    LOGTO_APP_SECRET: "synthetic-app-secret",
    LOGTO_COOKIE_SECRET: cookieSecret,
    LOGTO_ENDPOINT: "https://communications.smoke.test",
    WEB_BASE_URL: webUrl,
    FULLSTACK_WEB_BASE_URL: webUrl,
    FULLSTACK_LOGTO_COOKIE_NAME: "logto_communications-smoke",
    FULLSTACK_LOGTO_SESSION: session,
    COMMUNICATIONS_PROVIDER_URL: state.providerUrl,
  };
  // Управление Telegram ушло из редактора Platform (#419): `/authoring/communications` отвечает
  // 404 любой сессии, и `broadcasts.spec.ts` проверяет именно это. Поэтому готовность и полноту
  // маршрутов показывает главная страница: она отвечает без сессии.
  await startWithRoutes({
    baseUrl: webUrl,
    routes: ["/"],
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
    stop: (web) => stopServerOnPort(web, port),
    ready: (web) =>
      waitFor(
        async () =>
          (
            await fetch(webUrl, {
              redirect: "manual",
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
      "playwright.fullstack.config.ts",
      "broadcasts.spec.ts",
    ],
    env,
  );
  /** @type {Promise<number | null>} */
  const exited = new Promise((resolve) => test.on("exit", resolve));
  const code = await exited;
  if (code !== 0) throw new Error(`Browser assertions failed: ${String(code)}`);
  process.stdout.write(
    "Communications smoke passed: Telegram management stays outside the Platform editor on desktop and mobile.\n",
  );
} catch (error) {
  process.stderr.write(output.join("").slice(-18000));
  throw error;
} finally {
  for (const child of children.reverse()) await stopProcessGroup(child);
  await rm(directory, { recursive: true, force: true });
}
