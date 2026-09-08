// Explicit, loopback-only review runtime. Real Platform/DB/storage; synthetic local identity/video provider.
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { createServer, request as proxyRequest } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import { signalProcessGroup } from "./process-group-signal.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.npm_execpath) throw new Error("Run pnpm editor:local");
const webBaseUrl = "http://127.0.0.1:4396";
const apiBaseUrl = "http://127.0.0.1:4397";
const identity = await startFullStackIdentity({ apiBaseUrl, webBaseUrl });
// Never inherit production database/provider/identity configuration from the shell.
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
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
};
const children = [];
let closing = false;
const sockets = new Set();
const gateway = createServer(async (request, response) => {
  if (request.headers.host !== "127.0.0.1:4396") {
    response.writeHead(403).end();
    return;
  }
  try {
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
function run(args) {
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    env: environment,
    stdio: "inherit",
    detached: true,
  });
  children.push(child);
  return child;
}
async function command(args) {
  const child = run(args);
  const code = await new Promise((done) => child.once("exit", done));
  if (code !== 0) throw new Error(`Local setup failed: ${args.join(" ")}`);
}
async function close() {
  if (closing) return;
  closing = true;
  gateway.close();
  for (const socket of sockets) socket.destroy();
  for (const child of children)
    if (child.exitCode === null && child.pid)
      signalProcessGroup(child.pid, "SIGTERM");
  await identity.close();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close();
  });
try {
  await command(["--filter", "@inside/backend", "db:migrate"]);
  await command(["--filter", "@inside/backend", "db:seed"]);
  await command(["--filter", "@inside/backend", "release:bootstrap-owner"]);
  run(["dev:api"]);
  run([
    "--filter",
    "@inside/web",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4398",
  ]);
  await new Promise((done) => gateway.listen(4396, "127.0.0.1", done));
  process.stdout.write(
    `Local editor: ${webBaseUrl}/authoring/materials — local administrator, synthetic Kinescope provider.\n`,
  );
} catch (error) {
  await close();
  throw error;
}
