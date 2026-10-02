// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  reservePort,
  startWithRoutes,
  stopProcessGroup,
} from "./smoke-stand.mjs";

/**
 * Сквозной путь покупателя курса: страница продукта, вход через Telegram у тестового провайдера,
 * бесплатная и закрытая глава, покупка на двойнике банка, открытые материалы и право на общий чат.
 * Стенд поднимает `apps/backend/scripts/buyer-journey-fixture.ts`, браузер ходит в настоящий web.
 */
// The backend fixture writes the stand addresses the browser and the web process need.
const fixtureStateSchema = z.object({
  BACKEND_BASE_URL: z.string(),
  LOGTO_ENDPOINT: z.string(),
  LOGTO_AUDIENCE: z.string(),
  LOGTO_APP_ID: z.string(),
  CONTROL_URL: z.string(),
  GUIDE_SLUG: z.string(),
});
const directory = await mkdtemp(join(tmpdir(), "inside-buyer-journey-"));
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
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (/** @type {Buffer} */ data) => {
      output.push(data.toString());
      process.stdout.write(data);
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
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(`Child exited: ${String(child.exitCode)}`);
    try {
      const result = await operation();
      if (result) return result;
    } catch {
      /* Startup is polled until ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Buyer journey startup timed out");
}
try {
  const [apiPort, bankPort, webPort] = [
    await reservePort(),
    await reservePort(),
    await reservePort(),
  ];
  const webUrl = `http://127.0.0.1:${String(webPort)}`;
  const fixture = start(
    [
      "--filter",
      "@inside/backend",
      "exec",
      "tsx",
      "scripts/buyer-journey-fixture.ts",
    ],
    {
      BUYER_JOURNEY_FIXTURE_PATH: fixturePath,
      BUYER_JOURNEY_API_PORT: String(apiPort),
      BUYER_JOURNEY_BANK_PORT: String(bankPort),
      BUYER_JOURNEY_WEB_BASE_URL: webUrl,
    },
  );
  const state = await waitFor(
    async () =>
      fixtureStateSchema.parse(JSON.parse(await readFile(fixturePath, "utf8"))),
    fixture,
  );
  const env = {
    NODE_ENV: "development",
    BACKEND_BASE_URL: state.BACKEND_BASE_URL,
    LOGTO_ENDPOINT: state.LOGTO_ENDPOINT,
    LOGTO_AUDIENCE: state.LOGTO_AUDIENCE,
    LOGTO_APP_ID: state.LOGTO_APP_ID,
    LOGTO_APP_SECRET: "synthetic-buyer-journey-app-secret",
    LOGTO_COOKIE_SECRET: "synthetic-buyer-journey-cookie-secret-775",
    WEB_BASE_URL: webUrl,
    FULLSTACK_WEB_BASE_URL: webUrl,
    BUYER_JOURNEY_CONTROL_URL: state.CONTROL_URL,
    BUYER_JOURNEY_GUIDE_SLUG: state.GUIDE_SLUG,
  };
  // Адреса, которые открывает сценарий: сервер без любого из них перезапускается.
  await startWithRoutes({
    baseUrl: webUrl,
    routes: [
      "/",
      `/products/${state.GUIDE_SLUG}`,
      `/products/${state.GUIDE_SLUG}/buy`,
      "/materials/kak-ustroen-inside-platform",
      "/account",
      "/auth/status",
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
          String(webPort),
        ],
        env,
      ),
    stop: stopProcessGroup,
    ready: (web) =>
      waitFor(async () => (await fetch(`${webUrl}/`)).status > 0, web),
  });
  const test = start(
    [
      "--filter",
      "@inside/web",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.buyer-journey.config.ts",
    ],
    env,
  );
  /** @type {Promise<number | null>} */
  const exited = new Promise((resolve) => test.on("exit", resolve));
  const code = await exited;
  if (code !== 0) {
    // [DEBUG-863] temporary probes, removed before the pull request is ready.
    for (const url of [
      `${webUrl}/products/${state.GUIDE_SLUG}`,
      `${webUrl}/products/${state.GUIDE_SLUG}/programme`,
      `${webUrl}/products/no-such-product`,
      `${state.BACKEND_BASE_URL}/library/guides/${state.GUIDE_SLUG}`,
      `${state.BACKEND_BASE_URL}/library/home`,
    ]) {
      try {
        const response = await fetch(url);
        const body = await response.text();
        process.stdout.write(
          `[DEBUG-863] ${url} ${String(response.status)} ${body.replace(/\s+/gu, " ").slice(0, 1500)}\n`,
        );
      } catch (error) {
        process.stdout.write(`[DEBUG-863] ${url} threw ${String(error)}\n`);
      }
    }
    throw new Error(`Browser assertions failed: ${String(code)}`);
  }
  process.stdout.write(
    "Buyer journey passed on desktop and mobile against real Nest/PostgreSQL, the stand bank double and a synthetic Telegram sign-in provider.\n",
  );
} catch (error) {
  process.stderr.write(output.join("").slice(-18000));
  throw error;
} finally {
  for (const child of children.reverse()) await stopProcessGroup(child);
  await rm(directory, { recursive: true, force: true });
}
