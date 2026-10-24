// @ts-check
// Disposable local PostgreSQL + real SMTP adapter + BFF/browser. All identities/recipients are synthetic.
import assert from "node:assert/strict";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import { evidenceDirectory } from "./evidence-path.mjs";
import { reservePort, startWithRoutes } from "./smoke-stand.mjs";

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
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
/** @type {Promise<void> | undefined} */
let stoppingProcesses;
function stopProcesses() {
  stoppingProcesses ??= Promise.all(
    children.map((child) => stopOwned(child)),
  ).then(() => undefined);
  return stoppingProcesses;
}
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void stopProcesses();
    void browser?.close();
  });
}
/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(args, env) {
  if (interruptedSignal !== undefined)
    throw new Error("Billing proof interrupted");
  const child = spawnOwned(process.execPath, [pnpmPath, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.once("error", (error) => process.stderr.write(`${String(error)}\n`));
  children.push(child);
  return child;
}
/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
async function command(args, env) {
  const child = run(args, env);
  try {
    const code = await commandExit(child);
    assert.equal(code, 0, `Command failed: ${args.join(" ")}`);
  } finally {
    await stopOwned(child);
  }
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
    if (
      interruptedSignal !== undefined ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
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
  database = await new PostgreSqlContainer(
    "ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
  ).start();
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
    stop: (web) => stopOwned(web),
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
    await page.goto(`${webBaseUrl}/account#purchases`);
    await page.waitForURL((url) => url.pathname === "/account");
    // The retired purchase page has no saved-contact form. Order Email belongs to checkout.
    assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
    /**
     * Browser fetch preserves the authenticated BFF/origin boundary without inventing a UI.
     * @param {string} path
     * @param {"GET" | "POST"} method
     * @param {unknown} [input]
     */
    async function request(path, method, input) {
      const options = {
        method,
        credentials: "same-origin",
        ...(input === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            }),
      };
      /** @type {unknown} */
      const value = await page.evaluate(
        `(async () => { const response = await fetch(${JSON.stringify(path)}, ${JSON.stringify(options)}); return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() }; })()`,
      );
      return z
        .object({
          status: z.number().int(),
          cacheControl: z.string().nullable(),
          body: z.unknown(),
        })
        .parse(value);
    }
    const contactPath = "/api/account/billing/contact";
    const readSchema = z.object({
      ok: z.literal(true),
      contact: z
        .object({
          email: z.email(),
          revision: z.number().int(),
          verifiedAt: z.iso.datetime(),
        })
        .nullable(),
    });
    const initial = await request(contactPath, "GET");
    assert.equal(initial.status, 200);
    assert.deepEqual(
      initial.cacheControl
        ?.split(",")
        .map((value) => value.trim())
        .sort(),
      ["no-store", "private"],
    );
    assert.equal(readSchema.parse(initial.body).contact, null);
    const before = messages.length;
    const startInput = {
      operationId: randomUUID(),
      expectedRevision: 0,
      email: `${name}@example.test`,
    };
    const start = await request(`${contactPath}/start`, "POST", startInput);
    assert.equal(start.status, 200);
    const challenge = z
      .object({
        ok: z.literal(true),
        challengeRef: z.uuid(),
        expiresAt: z.iso.datetime(),
        delivery: z.literal("sent"),
      })
      .parse(start.body);
    assert.equal(messages.length, before + 1);
    const repeated = await request(`${contactPath}/start`, "POST", startInput);
    assert.deepEqual(repeated.body, start.body);
    assert.equal(messages.length, before + 1);
    const raw = messages.at(-1);
    assert(raw);
    // The actual Nodemailer envelope must target only this synthetic Account's address.
    assert.match(raw, new RegExp(`To:.*${name}@example\\.test`, "iu"));
    const split = raw.indexOf("\n\n");
    const text = /Content-Transfer-Encoding: base64/iu.test(raw)
      ? Buffer.from(
          raw.slice(split + 2).replaceAll("\n", ""),
          "base64",
        ).toString("utf8")
      : raw.slice(split + 2);
    const code = /: ([0-9]{6})\./u.exec(text)?.[1];
    assert(code, "Synthetic SMTP must carry a verification code");
    const foreignToken = await fullStackIdentity.createAccessToken(
      `other-billing-${name}`,
    );
    const foreignAccount = await fetch(`${apiBaseUrl}/accounts`, {
      method: "POST",
      headers: { authorization: `Bearer ${foreignToken.token}` },
    });
    assert.equal(foreignAccount.status, 201);
    const foreign = await launched.newContext();
    try {
      await foreign.addCookies([
        {
          name: fullStackIdentity.cookieName,
          value: await fullStackIdentity.createSession(foreignToken),
          url: webBaseUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const foreignPage = await foreign.newPage();
      await foreignPage.goto(`${webBaseUrl}/account`);
      await foreignPage
        .locator("dialog:modal")
        .getByRole("button", { name: "Принять условия и продолжить" })
        .click();
      await foreignPage.waitForURL((url) => url.pathname !== "/welcome");
      const foreignRead = await foreign.request.get(
        `${webBaseUrl}${contactPath}`,
      );
      assert.equal(readSchema.parse(await foreignRead.json()).contact, null);
      const foreignConfirmation = await foreign.request.post(
        `${webBaseUrl}${contactPath}/confirm`,
        {
          headers: { origin: webBaseUrl },
          data: {
            operationId: randomUUID(),
            challengeRef: challenge.challengeRef,
            code,
          },
        },
      );
      assert.deepEqual(await foreignConfirmation.json(), {
        ok: false,
        code: "challenge_invalid",
      });
    } finally {
      await foreign.close();
    }
    const invalid = await request(`${contactPath}/confirm`, "POST", {
      operationId: randomUUID(),
      challengeRef: challenge.challengeRef,
      code: code === "000000" ? "111111" : "000000",
    });
    assert.deepEqual(invalid.body, { ok: false, code: "challenge_invalid" });
    assert.equal(
      readSchema.parse((await request(contactPath, "GET")).body).contact,
      null,
    );
    const confirmInput = {
      operationId: randomUUID(),
      challengeRef: challenge.challengeRef,
      code,
    };
    const confirmed = await request(
      `${contactPath}/confirm`,
      "POST",
      confirmInput,
    );
    assert.equal(confirmed.status, 200);
    const result = z
      .object({ ok: z.literal(true), revision: z.number().int().positive() })
      .parse(confirmed.body);
    assert.deepEqual(
      (await request(`${contactPath}/confirm`, "POST", confirmInput)).body,
      confirmed.body,
    );
    await page.reload();
    const persisted = await request(contactPath, "GET");
    assert.deepEqual(
      persisted.cacheControl
        ?.split(",")
        .map((value) => value.trim())
        .sort(),
      ["no-store", "private"],
    );
    assert.equal(
      readSchema.parse(persisted.body).contact?.email,
      startInput.email,
    );
    assert.equal(
      readSchema.parse(persisted.body).contact?.revision,
      result.revision,
    );
    await context.close();
  }
  console.log(
    "Billing contact API proof passed: desktop/mobile browser-authenticated BFF/API/PostgreSQL/SMTP, replay, invalid code, reload and no-store; retired contact form absent, all recipients synthetic.",
  );
} catch (error) {
  if (interruptedSignal === undefined) throw error;
} finally {
  await browser?.close();
  await stopProcesses();
  await identity?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => smtp.close(done));
  await database?.stop();
}

if (interruptedSignal !== undefined)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
