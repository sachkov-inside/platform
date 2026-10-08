// @ts-check
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  symlink,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("..", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const diagnostics = [
  "billing-contact-proof",
  "buyer-journey-smoke",
  "enrollment-browser-smoke",
  "identity-hardening-proof",
  "full-stack-smoke",
  "editor-local-review",
  "identity-proof-dev",
  "identity-proof-start",
  "local-stand",
  "setup-local",
  "stand-gateway-session",
  "telegram-sign-in-local",
];

/**
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<{ code: number | null; signal: NodeJS.Signals | null }>}
 */
function processClosed(child) {
  return new Promise((resolve, reject) => {
    child.once(
      "close",
      (
        /** @type {number | null} */ code,
        /** @type {NodeJS.Signals | null} */ signal,
      ) => resolve({ code, signal }),
    );
    child.once("error", reject);
  });
}

/** @param {import("node:child_process").ChildProcess} child @returns {Promise<{pid: number; port: number}>} */
function descendantReady(child) {
  return new Promise((resolve, reject) => {
    child.once("message", (/** @type {unknown} */ tree) => {
      if (
        typeof tree !== "object" ||
        tree === null ||
        !("pid" in tree) ||
        !("port" in tree) ||
        typeof tree.pid !== "number" ||
        !Number.isInteger(tree.pid) ||
        tree.pid <= 0 ||
        typeof tree.port !== "number" ||
        !Number.isInteger(tree.port) ||
        tree.port <= 0
      )
        reject(new Error("Invalid descendant readiness"));
      else resolve({ pid: tree.pid, port: tree.port });
    });
    child.once("error", reject);
  });
}

/**
 * Launch the real script with fake Docker/pnpm/provider boundaries. The command tree itself is real:
 * its launcher reports a listening descendant that ignores TERM, then waits or exits as requested.
 * @param {string} script
 * @param {"wait" | "finish" | "fail" | "cleanup" | "unavailable" | "timeout"} [mode]
 */
async function fixture(script, mode = "wait") {
  const directory = await mkdtemp(join(tmpdir(), "inside-diagnostic-owner-"));
  const fixtureScripts = join(directory, "scripts");
  await mkdir(fixtureScripts);
  await mkdir(join(directory, "tools/authoring"), { recursive: true });
  await mkdir(join(directory, "apps/web"), { recursive: true });
  await mkdir(join(directory, ".identity-proof/tls"), { recursive: true });
  await writeFile(join(directory, ".identity-proof/platform.env"), "");
  await writeFile(
    join(directory, ".env.example"),
    "OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9\n",
  );
  for (const name of await readdir(scripts)) {
    if (!name.endsWith(".mjs")) continue;
    if (name === `${script}.mjs`)
      await copyFile(join(scripts, name), join(fixtureScripts, name));
    else await symlink(join(scripts, name), join(fixtureScripts, name));
  }
  await symlink(join(root, "node_modules"), join(directory, "node_modules"));
  await writeFile(
    join(directory, "tools/authoring/target.mjs"),
    'export function resolveLocalTarget() { return "http://127.0.0.1:1"; }',
  );
  const record = join(directory, "tree.json");
  const descendant = `
    const server = require('node:net').createServer();
    process.on('SIGTERM', () => {});
    process.on('SIGINT', () => {});
    server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({pid: process.pid, port: server.address().port}) + '\\n'));
  `;
  const command = `
    import { spawn } from 'node:child_process';
    import { writeFileSync, existsSync } from 'node:fs';
    // Cleanup commands are side effects at the fake Docker boundary, not another fixture tree.
    if (${JSON.stringify(mode)} === 'cleanup') {
      if (!process.argv.includes('down')) process.exit(process.argv.includes('compose:up') ? 7 : 0);
    } else if (process.argv.includes('down')) process.exit(0);
    if (existsSync(${JSON.stringify(record)})) process.exit(${JSON.stringify(mode)} === 'finish' ? 7 : 0);
    const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'pipe', 'inherit'] });
    descendant.stdout.once('data', data => {
      writeFileSync(${JSON.stringify(record)}, String(data));
      if (${JSON.stringify(mode)} !== 'timeout') process.stdout.write('Authoring gateway for the stand\\n');
      if (${JSON.stringify(mode)} === 'finish') process.exit(0);
      if (${JSON.stringify(mode)} === 'fail') process.exit(7);
    });
  `;
  const pnpm = join(directory, "fake-pnpm.mjs");
  await writeFile(pnpm, command);
  await writeFile(
    join(directory, "pnpm"),
    `#!${process.execPath}\n${command}`,
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, "docker"),
    `#!${process.execPath}\n${command}`,
    { mode: 0o755 },
  );
  // Only this executable belongs to the temporary fixture; the real stand is never opened.
  await rm(join(fixtureScripts, "authoring-stand-gateway.mjs"));
  await writeFile(join(fixtureScripts, "authoring-stand-gateway.mjs"), command);
  const stubs = {
    "local-setup-lock.mjs":
      "export async function acquireLocalSetupLock() { return async () => {}; }",
    "shared-identity-directory.mjs":
      "export function ensureSharedIdentityDirectory() { return 'unused'; }",
    "check-database.mjs":
      "export function checkDatabaseUrl() { return 'postgresql://fake:fake@127.0.0.1:9/check'; } export function ensureCheckDatabase() {} export function resetCheckDatabase() {}",
    "full-stack-identity.mjs":
      "export async function startFullStackIdentity() { return { environment: {}, close: async () => {} }; }",
    "full-stack-practice.mjs":
      "export async function seedFullStackPractice() {} export async function startPracticeReadProxy() {}",
    "full-stack-task.mjs": "export async function seedFullStackTask() {}",
    "whole-page-screenshot.mjs":
      "export async function screenshotWholePage() {}",
    "@testcontainers/postgresql":
      "export class PostgreSqlContainer { async start() { return { getConnectionUri: () => 'postgresql://fake:fake@127.0.0.1:9/check', stop: async () => {} }; } }",
    "@axe-core/playwright": "export default class AxeBuilder {}",
    "@playwright/test": "export const chromium = {};",
  };
  await writeFile(
    join(directory, "preload.mjs"),
    `
    import { registerHooks } from 'node:module';
    import { mock } from 'node:test';
    if (${JSON.stringify(mode)} === 'timeout') mock.timers.enable({ apis: ['setTimeout'] });
    import { watch } from 'node:fs';
    import { readFile } from 'node:fs/promises';
    const stubs = ${JSON.stringify(stubs)};
    registerHooks({
      resolve(specifier, context, next) {
        const key = Object.keys(stubs).find(key => specifier === key || specifier.endsWith('/' + key));
        return key === undefined ? next(specifier, context) : { url: 'diagnostic-stub:' + key, shortCircuit: true };
      },
      load(url, context, next) {
        return url.startsWith('diagnostic-stub:')
          ? { format: 'module', source: stubs[url.slice('diagnostic-stub:'.length)], shortCircuit: true }
          : next(url, context);
      }
    });
    const watcher = watch(${JSON.stringify(directory)}, { persistent: false }, async (_, name) => {
      if (String(name) !== 'tree.json') return;
      watcher.close();
      process.send(JSON.parse(await readFile(${JSON.stringify(record)}, 'utf8')));
      if (${JSON.stringify(mode)} === 'timeout') mock.timers.tick(60_000);
    });
  `,
  );
  await writeFile(
    join(directory, "owner.mjs"),
    script === "stand-gateway-session"
      ? `
    import { withStandGateway } from './scripts/stand-gateway-session.mjs';
    await withStandGateway('author@example.test', async () => {
      ${mode === "finish" ? "return;" : "await new Promise(() => {});"}
    });
  `
      : `await import('./scripts/${script}.mjs');`,
  );
  const owner = spawn(
    process.execPath,
    ["--import", join(directory, "preload.mjs"), join(directory, "owner.mjs")],
    {
      cwd: directory,
      env: {
        ...process.env,
        PATH:
          mode === "unavailable"
            ? directory
            : `${directory}:${process.env["PATH"] ?? ""}`,
        npm_execpath: pnpm,
        NODE_ENV: "development",
        WEB_BASE_URL: "http://127.0.0.1:20621",
        BACKEND_BASE_URL: "http://127.0.0.1:20622",
        DATABASE_URL: "postgresql://fake:fake@127.0.0.1:9/check",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const closed = processClosed(owner);
  /** @type {string[]} */
  const output = [];
  for (const stream of [owner.stdout, owner.stderr])
    stream?.on("data", (chunk) => output.push(String(chunk)));
  /** @type {number | undefined} */
  let descendantPid;
  /** @type {import("node:net").Socket | undefined} */
  let socket;
  let handedOff = false;
  try {
    const tree = await Promise.race([
      descendantReady(owner),
      once(AbortSignal.timeout(10_000), "abort").then(() => {
        throw new Error(`Command did not report readiness: ${output.join("")}`);
      }),
      closed.then(() => {
        throw new Error(
          `Script failed before command readiness: ${output.join("")}`,
        );
      }),
    ]);
    descendantPid = tree.pid;
    socket = connect(tree.port, "127.0.0.1");
    const descendantClosed = once(socket, "close").then(() => undefined);
    await once(socket, "connect", { signal: AbortSignal.timeout(5_000) });
    handedOff = true;
    return {
      owner,
      closed,
      output,
      descendantPid,
      directory,
      socket,
      descendantClosed,
    };
  } finally {
    if (!handedOff) {
      socket?.destroy();
      owner.kill("SIGKILL");
      await closed;
      await rm(directory, { recursive: true, force: true });
    }
  }
}

/**
 * A capture pipe belongs to the owner, so its close cannot prove cleanup after owner SIGKILL.
 * The descendant's live TCP connection closes only when that real process is terminated.
 * @param {Awaited<ReturnType<typeof fixture>>} running
 */
async function treeClosed(running) {
  return Promise.race([
    Promise.all([running.closed, running.descendantClosed]).then(
      ([result]) => result,
    ),
    once(AbortSignal.timeout(15_000), "abort").then(() => {
      throw new Error(`Tree did not close: ${running.output.join("")}`);
    }),
  ]);
}

/** @param {Awaited<ReturnType<typeof fixture>>} running */
async function dispose(running) {
  running.owner.kill("SIGKILL");
  running.socket.destroy();
  try {
    process.kill(running.descendantPid, "SIGKILL");
  } catch {
    /* Already stopped. */
  }
  await running.closed;
  await rm(running.directory, { recursive: true, force: true });
}

for (const script of diagnostics) {
  for (const signal of /** @type {const} */ ([
    "SIGINT",
    "SIGTERM",
    "SIGKILL",
  ])) {
    test(
      `${script} clears its TERM-resistant descendant after owner ${signal}`,
      { timeout: 25_000 },
      async () => {
        const running = await fixture(script);
        try {
          process.kill(running.descendantPid, 0);
          assert(running.owner.kill(signal));
          const { code, signal: actualSignal } = await treeClosed(running);
          if (signal === "SIGKILL") assert.equal(actualSignal, "SIGKILL");
          else
            assert.equal(
              code,
              signal === "SIGINT" ? 130 : 143,
              running.output.join(""),
            );
        } finally {
          await dispose(running);
        }
      },
    );
  }
}

test(
  "stand gateway finishes only after its TERM-resistant descendant stops",
  { timeout: 25_000 },
  async () => {
    const running = await fixture("stand-gateway-session", "finish");
    try {
      const { code } = await treeClosed(running);
      assert.equal(code, 0);
    } finally {
      await dispose(running);
    }
  },
);

for (const script of [
  "identity-proof-dev",
  "identity-proof-start",
  "setup-local",
  "local-stand",
  "editor-local-review",
  "full-stack-smoke",
  "billing-contact-proof",
  "identity-hardening-proof",
]) {
  test(
    `${script} clears descendants when a short launcher fails`,
    { timeout: 25_000 },
    async () => {
      const running = await fixture(script, "fail");
      try {
        const { code } = await treeClosed(running);
        assert(typeof code === "number" && code !== 0);
      } finally {
        await dispose(running);
      }
    },
  );
}

for (const signal of /** @type {const} */ (["SIGTERM", "SIGKILL"])) {
  test(
    `setup-local interrupts the cleanup command tree after ${signal}`,
    { timeout: 25_000 },
    async () => {
      const running = await fixture("setup-local", "cleanup");
      try {
        assert(running.owner.kill(signal));
        const { code, signal: actualSignal } = await treeClosed(running);
        if (signal === "SIGKILL") assert.equal(actualSignal, "SIGKILL");
        else assert.equal(code, 143, running.output.join(""));
      } finally {
        await dispose(running);
      }
    },
  );
}

for (const script of diagnostics) {
  test(
    `${script} rejects a supervisor startup failure without hanging`,
    { timeout: 15_000 },
    async () => {
      await assert.rejects(
        fixture(script, "unavailable"),
        /Script failed before command readiness/u,
      );
    },
  );
}

test(
  "stand gateway startup timeout clears its TERM-resistant descendant",
  { timeout: 25_000 },
  async () => {
    const running = await fixture("stand-gateway-session", "timeout");
    try {
      const { code } = await treeClosed(running);
      assert.equal(code, 1);
      assert.match(
        running.output.join(""),
        /The authoring gateway did not start in time/u,
      );
    } finally {
      await dispose(running);
    }
  },
);
