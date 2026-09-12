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
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import { signalProcessGroup } from "./process-group-signal.mjs";
import { evidenceDirectory } from "./evidence-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendRequire = createRequire(
  resolve(root, "apps/backend/package.json"),
);
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const { PostgreSqlContainer } = backendRequire("@testcontainers/postgresql");
const { chromium } = webRequire("@playwright/test");
const { default: AxeBuilder } = webRequire("@axe-core/playwright");
const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error("Run pnpm smoke:billing-contact");
const apiPort = 6406;
const webPort = 6407;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const evidence = evidenceDirectory("issue-406");
const messages = [];
const sockets = new Set();
const smtp = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 localhost synthetic SMTP\r\n");
  let buffer = "";
  let data = false;
  let message = [];
  socket.on("data", (chunk) => {
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
const children = [];
let database;
let identity;
let browser;
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
async function command(args, env) {
  const child = run(args, env);
  const code = await new Promise((done) => child.once("exit", done));
  assert.equal(code, 0, `Command failed: ${args.join(" ")}`);
}
async function waitReady(url, accepts) {
  for (let index = 0; index < 120; index++) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && accepts(body)) return;
    } catch {
      /* process startup */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`Readiness timed out: ${url}`);
}
async function assertPortFree(port) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", done);
  });
  await new Promise((done) => probe.close(done));
}
try {
  await assertPortFree(apiPort);
  await assertPortFree(webPort);
  await new Promise((done) => smtp.listen(0, "127.0.0.1", done));
  const smtpAddress = smtp.address();
  assert(smtpAddress && typeof smtpAddress !== "string");
  database = await new PostgreSqlContainer("postgres:18.4-alpine").start();
  identity = await startFullStackIdentity({ apiBaseUrl, webBaseUrl });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
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
  run(
    ["--filter", "@inside/backend", "exec", "tsx", "src/entrypoints/api.ts"],
    env,
  );
  await waitReady(
    `${apiBaseUrl}/health`,
    (body) => JSON.parse(body).status === "ready",
  );
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
    // Снимки-свидетельства делаются на 390 и целой страницей, поэтому индикатор режима
    // разработки в них попадать не должен. Переменную читает `next.config.ts` из #594: до его
    // мержа строка ничего не меняет.
    {
      ...env,
      NODE_ENV: "development",
      WATCHPACK_POLLING: "true",
      HIDE_DEV_INDICATOR: "true",
    },
  );
  await waitReady(`${webBaseUrl}/account/purchases`, (body) =>
    body.includes("Email"),
  );
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch();
  for (const [name, width, height] of [
    ["desktop", 1440, 1024],
    ["mobile", 390, 844],
  ]) {
    const token = await identity.createAccessToken(`billing-${name}`);
    const established = await fetch(`${apiBaseUrl}/accounts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.token}` },
    });
    assert.equal(established.status, 201);
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      {
        name: identity.cookieName,
        value: await identity.createSession(token),
        url: webBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
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
    assert(contactHeadingId, "Contact section must label itself by its heading");
    const a11y = await new AxeBuilder({ page })
      .include(`section[aria-labelledby='${contactHeadingId}']`)
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(a11y.violations, []);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
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
      (await page.request.get(`${webBaseUrl}/api/account/billing/contact`)).headers()[
        "cache-control"
      ],
      "private, no-store",
    );
    await context.close();
  }
  console.log(
    "Billing contact proof passed: desktop/mobile, BFF/API/PostgreSQL/SMTP, reload, WCAG and overflow; all recipients synthetic.",
  );
} finally {
  await browser?.close();
  for (const child of children)
    if (child.exitCode === null && child.pid)
      signalProcessGroup(child.pid, "SIGTERM");
  await Promise.all(
    children
      .filter((child) => child.exitCode === null)
      .map(
        (child) =>
          new Promise((done) => {
            child.once("exit", done);
            setTimeout(done, 5000).unref();
          }),
      ),
  );
  await identity?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => smtp.close(done));
  await database?.stop();
}
