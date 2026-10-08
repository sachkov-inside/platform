// @ts-check
// Explicit, loopback-only review runtime. Real Platform/DB/storage; synthetic local identity/video provider.
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { createServer, request as proxyRequest } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startFullStackIdentity } from "./full-stack-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmExecutable = process.env["npm_execpath"];
if (!pnpmExecutable) throw new Error("Run pnpm editor:local");
const pnpmPath = pnpmExecutable;
const webBaseUrl = "http://127.0.0.1:4396";
const apiBaseUrl = "http://127.0.0.1:4397";
const identity = await startFullStackIdentity({ apiBaseUrl, webBaseUrl });
// Never inherit production database/provider/identity configuration from the shell.
const environment = {
  // The isolated editor review keeps the published demonstration catalogue in its own database.
  LOCAL_SEED_DEMO: "published",
  PATH: process.env["PATH"],
  HOME: process.env["HOME"],
  ...parseEnv(readFileSync(resolve(root, ".env.example"), "utf8")),
  ...identity.environment,
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://inside:inside@127.0.0.1:54396/inside",
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9036",
  API_HOST: "127.0.0.1",
  API_PORT: "4397",
  BACKEND_BASE_URL: apiBaseUrl,
  KINESCOPE_PROVIDER_MODE: "test",
  OWNER_PERMISSION: "platform:admin",
  // A machine with a low open-file limit needs polling for `next dev`; see local-development.md.
  ...(process.env["WATCHPACK_POLLING"]
    ? { WATCHPACK_POLLING: process.env["WATCHPACK_POLLING"] }
    : {}),
};
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let closing = false;
/** @type {Promise<void> | undefined} */
let closePromise;
/** @type {Set<import("node:net").Socket>} */
const sockets = new Set();
const gateway = createServer(async (request, response) => {
  if (request.headers.host !== "127.0.0.1:4396") {
    response.writeHead(403).end();
    return;
  }
  try {
    if (request.url?.startsWith("/__local-api/")) {
      if (
        request.headers.origin !== undefined &&
        request.headers.origin !== webBaseUrl
      ) {
        response.writeHead(403).end();
        return;
      }
      const upstream = proxyRequest(
        {
          hostname: "127.0.0.1",
          port: 4397,
          path: request.url.slice("/__local-api".length),
          method: request.method,
          headers: {
            ...request.headers,
            host: "127.0.0.1:4397",
            authorization: `Bearer ${(await identity.createAccessToken()).token}`,
          },
        },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("error", () =>
        response.writeHead(502).end("Local API is starting"),
      );
      request.pipe(upstream);
      return;
    }
    const session = await identity.createSession(
      await identity.createAccessToken(),
    );
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 4398,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          cookie: `${identity.cookieName}=${session}`,
          "x-forwarded-host": "127.0.0.1:4396",
          "x-forwarded-proto": "http",
        },
      },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502).end("Local editor is starting");
    });
    request.pipe(upstream);
  } catch {
    response.writeHead(503).end("Local identity unavailable");
  }
});
gateway.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
gateway.on("upgrade", (request, socket, head) => {
  if (request.headers.host !== "127.0.0.1:4396") {
    socket.destroy();
    return;
  }
  const upstream = connect(4398, "127.0.0.1", () => {
    upstream.write(
      `${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(
        request.headers,
      )
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
/** @param {string[]} args @param {boolean} [service] */
function run(args, service = false) {
  if (closing) throw new Error("Local editor interrupted");
  const child = spawnOwned(process.execPath, [pnpmPath, ...args], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
    void close();
  });
  child.once("exit", (code) => {
    if (!closing && (service || code !== 0)) {
      process.exitCode = code ?? 1;
      void close();
    }
  });
  children.push(child);
  return child;
}
/** @param {string[]} args */
async function command(args) {
  const child = run(args);
  try {
    const code = await commandExit(child);
    if (code !== 0) throw new Error(`Local setup failed: ${args.join(" ")}`);
  } finally {
    await stopOwned(child);
  }
}
function close() {
  closing = true;
  closePromise ??= (async () => {
    gateway.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all(children.map((child) => stopOwned(child)));
    await identity.close();
  })();
  return closePromise;
}
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"]))
  process.once(signal, () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void close();
  });
try {
  await command(["--filter", "@inside/backend", "db:migrate"]);
  await command(["--filter", "@inside/backend", "db:seed"]);
  await command(["--filter", "@inside/backend", "release:bootstrap-owner"]);
  run(["dev:api"], true);
  run(
    [
      "--filter",
      "@inside/web",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "4398",
    ],
    true,
  );
  /** @type {Promise<void>} */
  const listening = new Promise((done) =>
    gateway.listen(4396, "127.0.0.1", done),
  );
  await listening;
  process.stdout.write(
    `Local editor: ${webBaseUrl}/authoring/materials — local administrator, synthetic Kinescope provider.\n`,
  );
} catch (error) {
  await close();
  if (process.exitCode !== 130 && process.exitCode !== 143) throw error;
}
