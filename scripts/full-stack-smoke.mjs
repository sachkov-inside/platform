import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { wrapSession } from "@logto/node";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { signalProcessGroup } from "./process-group-signal.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run the full-stack smoke through the pinned pnpm CLI");
}

const environmentPath = resolve(repositoryRoot, ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}
const apiPort = process.env.API_PORT ?? "3001";
const apiBaseUrl =
  process.env.BACKEND_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const webPort = process.env.FULLSTACK_WEB_PORT ?? "3000";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const mcpPort = process.env.FULLSTACK_MCP_PORT ?? "3002";
const mcpServerUrl = `http://127.0.0.1:${mcpPort}/mcp`;
const fullStackAccessTokenTtlSeconds = 300;
const childEnvironment = { ...process.env };
childEnvironment.NODE_ENV ??= "development";
const fullStackIdentity = await startFullStackIdentity();
Object.assign(childEnvironment, fullStackIdentity.environment);
const processes = [];
const activeProcesses = new Set();
let cleanupPromise;
let interruptedSignal;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  await runPnpm(["--filter", "@inside/backend", "db:migrate"]);
  await runPnpm(["--filter", "@inside/backend", "db:seed"]);
  await runPnpm(
    ["--filter", "@inside/backend", "release:bootstrap-owner"],
    childEnvironment,
  );
  await runPnpm(["--filter", "@inside/web", "build"], {
    ...childEnvironment,
    NODE_ENV: "production",
  });

  processes.push(
    startPnpm("API", ["dev:api"], childEnvironment),
    startPnpm("MCP", ["dev:mcp"], {
      ...childEnvironment,
      MCP_HOST: "127.0.0.1",
      MCP_PORT: mcpPort,
      MCP_SERVER_URL: mcpServerUrl,
    }),
    startPnpm(
      "Web",
      [
        "--filter",
        "@inside/web",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        webPort,
      ],
      {
        ...childEnvironment,
        NODE_ENV: "production",
        BACKEND_BASE_URL: apiBaseUrl,
      },
    ),
  );

  const health = await waitForJson(`${apiBaseUrl}/health`, processes);
  assertHealth(health);
  await waitForHttp(
    `${mcpServerUrl.replace(/\/mcp$/u, "")}/.well-known/oauth-protected-resource/mcp`,
    processes,
  );
  await waitForHttp(webBaseUrl, processes);
  await runPnpm(["--filter", "@inside/web", "smoke:backend"], {
    ...childEnvironment,
    BACKEND_BASE_URL: apiBaseUrl,
  });
  const mcpAccessToken = await fullStackIdentity.createAccessToken();
  await runPnpm(["--filter", "@inside/backend", "smoke:mcp-authoring"], {
    ...childEnvironment,
    MCP_SMOKE_ACCESS_TOKEN: mcpAccessToken.token,
    MCP_SMOKE_SERVER_URL: mcpServerUrl,
  });
  await runPnpm(
    ["--filter", "@inside/backend", "smoke:grant-full-stack-membership"],
    childEnvironment,
  );
  const browserAccessToken = await fullStackIdentity.createAccessToken();
  const fullStackSession = await fullStackIdentity.createSession(browserAccessToken);
  await runPnpm(["--filter", "@inside/web", "test:fullstack"], {
    ...childEnvironment,
    FULLSTACK_API_BASE_URL: apiBaseUrl,
    FULLSTACK_MEMBERSHIP_ACQUISITION_URL:
      childEnvironment.MEMBERSHIP_ACQUISITION_URL ?? "https://t.me/tribute",
    FULLSTACK_LOGTO_COOKIE_NAME: fullStackIdentity.cookieName,
    FULLSTACK_LOGTO_SESSION: fullStackSession,
    FULLSTACK_WEB_BASE_URL: webBaseUrl,
  });

  process.stdout.write(
    `Full-stack smoke passed: Library ${webBaseUrl}/library; Reader ${webBaseUrl}/materials/kak-ustroen-inside-platform; live API ${apiBaseUrl}; delegated MCP ${mcpServerUrl}; PostgreSQL reachable\n`,
  );
} catch (error) {
  if (interruptedSignal === undefined) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${formatProcessOutput(processes)}`, {
      cause: error,
    });
  }
} finally {
  await cleanup();
  await fullStackIdentity.close();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

function startPnpm(name, arguments_, environment, detached = true) {
  const output = [];
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
    detached: detached && process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { name, child, output, detached };
  activeProcesses.add(entry);
  child.once("exit", () => activeProcesses.delete(entry));
  child.stdout?.on("data", (chunk) => retainOutput(output, chunk));
  child.stderr?.on("data", (chunk) => retainOutput(output, chunk));
  return entry;
}

async function runPnpm(arguments_, environment = childEnvironment) {
  const entry = startPnpm("pnpm", arguments_, environment, false);
  const exitCode = await new Promise((resolveExit) => {
    entry.child.once("exit", (code) => resolveExit(code));
  });
  if (exitCode !== 0) {
    throw new Error(`pnpm ${arguments_.join(" ")} failed:\n${entry.output.join("")}`);
  }
}

async function waitForJson(url, entries) {
  const response = await waitForHttp(url, entries);
  return response.json();
}

async function waitForHttp(url, entries) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertProcessesRunning(entries);
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) {
        return response;
      }
      const body = (await response.text()).slice(0, 1_000);
      throw new Error(
        `${url} returned HTTP ${String(response.status)}${body.length > 0 ? `:\n${body}` : ""}\n${formatProcessOutput(entries)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("returned HTTP")) {
        throw error;
      }
      // A connection failure means the process is still starting.
    }
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for ${url}\n${formatProcessOutput(entries)}`);
}

function assertHealth(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.process !== "api" ||
    value.status !== "ok" ||
    value.database !== "reachable"
  ) {
    throw new Error(`Unexpected API health response: ${JSON.stringify(value)}`);
  }
}

function assertProcessesRunning(entries) {
  const stopped = entries.find(({ child }) => child.exitCode !== null);
  if (stopped !== undefined) {
    throw new Error(`${stopped.name} exited early:\n${stopped.output.join("")}`);
  }
}

async function stopProcess({ child, detached }) {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32" || !detached) {
    child.kill("SIGTERM");
  } else if (!signalProcessGroup(child.pid, "SIGTERM")) {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) {
    if (process.platform === "win32" || !detached) {
      child.kill("SIGKILL");
    } else if (!signalProcessGroup(child.pid, "SIGKILL")) {
      child.kill("SIGKILL");
    }
  }
}

function cleanup() {
  cleanupPromise ??= Promise.all(
    [...activeProcesses].map((entry) => stopProcess(entry)),
  ).then(() => undefined);
  return cleanupPromise;
}

async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await cleanup();
}

function retainOutput(output, chunk) {
  output.push(chunk.toString());
  while (output.join("").length > 40_000) {
    output.shift();
  }
}

function formatProcessOutput(entries) {
  return entries.map(({ name, output }) => `${name}:\n${output.join("")}`).join("\n");
}

async function startFullStackIdentity() {
  const issuer = "https://identity.fullstack.test/oidc";
  const subject = "fullstack-owner";
  const audience = apiBaseUrl;
  const appId = "inside-web-fullstack";
  const cookieSecret = "inside-fullstack-cookie-secret-key";
  const keyPair = await generateKeyPair("ES384");
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "ES384",
    kid: "fullstack-key-1",
  };
  const server = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Full-stack JWKS server has no TCP port");
  }
  return {
    cookieName: `logto_${appId}`,
    createAccessToken: async () => {
      const now = Math.floor(Date.now() / 1_000);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "ES384", kid: "fullstack-key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt(now)
        .setExpirationTime(now + fullStackAccessTokenTtlSeconds)
        .sign(keyPair.privateKey);
      return { token, expiresAt: now + fullStackAccessTokenTtlSeconds };
    },
    createSession: async ({ token, expiresAt }) => {
      return wrapSession(
        {
          idToken: "fullstack.id.token",
          accessToken: JSON.stringify({
            [`@${audience}`]: {
              token,
              scope: "",
              expiresAt,
            },
          }),
        },
        cookieSecret,
      );
    },
    environment: {
      LOGTO_APP_ID: appId,
      LOGTO_APP_SECRET: "inside-fullstack-app-secret",
      LOGTO_AUDIENCE: audience,
      LOGTO_COOKIE_SECRET: cookieSecret,
      LOGTO_ENDPOINT: "https://identity.fullstack.test",
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
      OWNER_LOGTO_ISSUER: issuer,
      OWNER_LOGTO_SUBJECT: subject,
      WEB_BASE_URL: webBaseUrl,
    },
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) =>
          error === undefined ? resolveClose() : rejectClose(error),
        );
      }),
  };
}
