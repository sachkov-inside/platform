// @ts-check
// Disposable local PostgreSQL + real SMTP adapter + BFF/browser. All identities/recipients are synthetic.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import { evidenceDirectory } from "./evidence-path.mjs";
import {
  reservePort,
  startWithRoutes,
  stopProcessGroup,
  stopServerOnPort,
} from "./smoke-stand.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendRequire = createRequire(
  resolve(root, "apps/backend/package.json"),
);
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
// The proof borrows the applications' test dependencies; their types come from the same packages.
// createRequire returns `any`, so each module is asserted to the type proof-dependencies declares.
/* oxlint-disable typescript/no-unsafe-type-assertion -- proof-dependencies types these modules. */
const { PostgreSqlContainer } =
  /** @type {typeof import("../apps/backend/test/support/proof-dependencies.js")} */ (
    backendRequire("@testcontainers/postgresql")
  );
const { chromium } =
  /** @type {typeof import("../apps/web/test/support/proof-dependencies.mjs")} */ (
    webRequire("@playwright/test")
  );
const { default: AxeBuilder } =
  /** @type {{ default: typeof import("../apps/web/test/support/proof-dependencies.mjs").AxeBuilder }} */ (
    webRequire("@axe-core/playwright")
  );
/* oxlint-enable typescript/no-unsafe-type-assertion */
const pnpmExecutable = process.env["npm_execpath"];
if (!pnpmExecutable) throw new Error("Run pnpm smoke:billing-contact");
const pnpmPath = pnpmExecutable;
const apiPort = await reservePort();
const webPort = await reservePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const evidence = evidenceDirectory("issue-406");
/** @type {string[]} */
const messages = [];
/** @type {Set<import("node:net").Socket>} */
const sockets = new Set();
const smtp = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 localhost synthetic SMTP\r\n");
  let buffer = "";
  let data = false;
  /** @type {string[]} */
  let message = [];
  socket.on("data", (/** @type {Buffer} */ chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\r\n")) {
      const end = buffer.indexOf("\r\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line !== ".") {
          message.push(line);
          continue;
        }
        messages.push(message.join("\n"));
        message = [];
        data = false;
        socket.write("250 captured locally\r\n");
        continue;
      }
      if (line.startsWith("EHLO"))
        socket.write("250-localhost\r\n250 8BITMIME\r\n");
      else if (line === "DATA") {
        data = true;
        socket.write("354 send data\r\n");
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else if (line.startsWith("RCPT TO:") && !/@example\.test>$/iu.test(line))
        socket.write("550 synthetic recipients only\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {import("../apps/backend/test/support/proof-dependencies.js").StartedPostgreSqlContainer | undefined} */
let database;
/** @type {Awaited<ReturnType<typeof startFullStackIdentity>> | undefined} */
let identity;
/** @type {import("../apps/web/test/support/proof-dependencies.mjs").Browser | undefined} */
let browser;
/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(args, env) {
  const child = spawn(process.execPath, [pnpmPath, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    detached: true,
  });
  children.push(child);
  return child;
}
/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
async function command(args, env) {
  const child = run(args, env);
  /** @type {Promise<number | null>} */
  const exited = new Promise((done) => child.once("exit", done));
  const code = await exited;
  assert.equal(code, 0, `Command failed: ${args.join(" ")}`);
}
/**
 * Опрашивает адрес, пока ответ не подойдёт. Редиректы не выполняются: ответ даёт сам процесс.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} url
 * @param {(response: Response) => Promise<boolean>} accepts
 */
async function waitReady(child, url, accepts) {
  for (let index = 0; index < 120; index++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Process exited before readiness: ${url}`);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (await accepts(response)) return;
    } catch {
      /* process startup */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`Readiness timed out: ${url}`);
}
try {
  /** @type {Promise<void>} */
  const smtpListening = new Promise((done) =>
    smtp.listen(0, "127.0.0.1", done),
  );
  await smtpListening;
  const smtpAddress = smtp.address();
  assert(smtpAddress && typeof smtpAddress !== "string");
  database = await new PostgreSqlContainer("postgres:18.4-alpine").start();
  const fullStackIdentity = await startFullStackIdentity({
    apiBaseUrl,
    webBaseUrl,
  });
  identity = fullStackIdentity;
  const env = {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    ...parseEnv(await readFile(resolve(root, ".env.example"), "utf8")),
    ...identity.environment,
    NODE_ENV: "test",
    DATABASE_URL: database.getConnectionUri(),
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    BACKEND_BASE_URL: apiBaseUrl,
    BILLING_CONTACT_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
    BILLING_CONTACT_SMTP_PORT: String(smtpAddress.port),
    BILLING_CONTACT_FROM: "inside@example.test",
  };
  await command(["--filter", "@inside/backend", "db:migrate"], env);
  const api = run(
    ["--filter", "@inside/backend", "exec", "tsx", "src/entrypoints/api.ts"],
    env,
  );
  await waitReady(
    api,
    `${apiBaseUrl}/health`,
    async (response) =>
      response.ok &&
      z
        .object({ status: z.unknown() })
        .passthrough()
        .parse(await response.json()).status === "ready",
  );
  // Снимки-свидетельства делаются на 390 и целой страницей, поэтому индикатор режима
  // разработки в них попадать не должен. Переменную читает `next.config.ts` из #594: до его
  // мержа строка ничего не меняет.
  const webEnv = {
    ...env,
    NODE_ENV: "development",
    WATCHPACK_POLLING: "true",
    HIDE_DEV_INDICATOR: "true",
  };
  // Адреса, к которым обращается сценарий: сервер без любого из них перезапускается. У адреса,
  // который принимает только POST, существующий маршрут отвечает на GET кодом 405, а не 404.
  await startWithRoutes({
    baseUrl: webBaseUrl,
    routes: [
      "/account",
      "/account/purchases",
      "/welcome",
      "/auth/status",
      "/api/account",
      "/api/account/billing",
      "/api/account/billing/community-admission",
      "/api/account/billing/contact",
      "/api/account/billing/contact/confirm",
      "/api/account/billing/contact/start",
      "/api/account/billing/enrollments",
      "/api/account/community-entry",
      "/api/account/terms",
    ],
    start: () =>
      run(
        [
          "--filter",
          "@inside/web",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        webEnv,
      ),
    stop: (web) => stopServerOnPort(web, webPort),
    // Отсутствующий маршрут отвечает 404, его ловит `startWithRoutes`; готовность ждёт любого
    // ответа сервера.
    ready: (web) =>
      waitReady(web, `${webBaseUrl}/account/purchases`, (response) =>
        Promise.resolve(response.status < 500),
      ),
  });
  await mkdir(evidence, { recursive: true });
  const launched = await chromium.launch();
  browser = launched;
  for (const [name, width, height] of /** @type {const} */ ([
    ["desktop", 1440, 1024],
    ["mobile", 390, 844],
  ])) {
    const token = await fullStackIdentity.createAccessToken(`billing-${name}`);
    const established = await fetch(`${apiBaseUrl}/accounts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.token}` },
    });
    assert.equal(established.status, 201);
    const context = await launched.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      {
        name: fullStackIdentity.cookieName,
        value: await fullStackIdentity.createSession(token),
        url: webBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${webBaseUrl}/account/purchases`);
    // Новый Account сначала попадает на экран условий использования. После принятия экран ведёт
    // в кабинет, поэтому покупки открываются ещё раз.
    await page
      .locator("dialog:modal")
      .getByRole("button", { name: "Принять условия и продолжить" })
      .click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await page.goto(`${webBaseUrl}/account/purchases`);
    await page.getByLabel("Email", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Закрыть подключение Telegram" })
      .click();
    await page.screenshot({
      path: resolve(evidence, `contact-empty-${name}.png`),
      fullPage: true,
    });
    await page
      .getByLabel("Email", { exact: true })
      .fill(`${name}@example.test`);
    const before = messages.length;
    await page
      .getByRole("button", { name: "Получить код", exact: true })
      .click();
    await page.getByLabel("Код из письма").waitFor();
    assert.equal(messages.length, before + 1);
    const raw = messages.at(-1);
    assert(raw);
    // Nodemailer chooses base64 for this Russian plain-text message.
    const split = raw.indexOf("\n\n");
    const text = /Content-Transfer-Encoding: base64/iu.test(raw)
      ? Buffer.from(
          raw.slice(split + 2).replaceAll("\n", ""),
          "base64",
        ).toString("utf8")
      : raw.slice(split + 2);
    const code = /: ([0-9]{6})\./u.exec(text)?.[1];
    assert(code, "Synthetic SMTP must carry a verification code");
    await page.screenshot({
      path: resolve(evidence, `contact-code-${name}.png`),
      fullPage: true,
    });
    // Раздел находится по своему заголовку: связь `aria-labelledby` даёт `useId`, поэтому
    // постоянного идентификатора у него нет и вписать его сюда нельзя.
    const contactSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Email для чеков и сообщений" }),
    });
    const contactHeadingId = await contactSection
      .first()
      .getAttribute("aria-labelledby");
    assert(
      contactHeadingId,
      "Contact section must label itself by its heading",
    );
    const a11y = await new AxeBuilder({ page })
      .include(`section[aria-labelledby='${contactHeadingId}']`)
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(a11y.violations, []);
    // The expression runs inside the page; scripts compile without the DOM library.
    assert(
      await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
    );
    await page.getByLabel("Код из письма").fill(code);
    await page
      .getByRole("button", { name: "Подтвердить email", exact: true })
      .click();
    await page.getByText("Email подтверждён.", { exact: true }).waitFor();
    await page.getByText(`${name}@example.test`, { exact: true }).waitFor();
    await page.screenshot({
      path: resolve(evidence, `contact-verified-${name}.png`),
      fullPage: true,
    });
    await page.reload();
    await page.getByText(`${name}@example.test`, { exact: true }).waitFor();
    assert.equal(
      (
        await page.request.get(`${webBaseUrl}/api/account/billing/contact`)
      ).headers()["cache-control"],
      "private, no-store",
    );
    await context.close();
  }
  console.log(
    "Billing contact proof passed: desktop/mobile, BFF/API/PostgreSQL/SMTP, reload, WCAG and overflow; all recipients synthetic.",
  );
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stopProcessGroup(child);
  await identity?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => smtp.close(done));
  await database?.stop();
}
