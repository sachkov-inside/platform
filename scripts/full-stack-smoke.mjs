import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkDatabaseUrl, resetCheckDatabase } from "./check-database.mjs";
import { startFullStackIdentity } from "./full-stack-identity.mjs";

import { signalProcessGroup } from "./process-group-signal.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run the full-stack smoke through the pinned pnpm CLI");
}

// Only an explicitly exported DATABASE_URL may point the smoke at another database; a personal `.env`
// usually names the stand database, which this smoke must never migrate, seed or rewrite.
const explicitDatabaseUrl = process.env.DATABASE_URL;
const environmentPath = resolve(repositoryRoot, ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}
if (explicitDatabaseUrl === undefined) {
  resetCheckDatabase({ cwd: repositoryRoot });
  process.env.DATABASE_URL = checkDatabaseUrl(process.env.POSTGRES_HOST_PORT ?? 5432);
}
const apiPort = process.env.API_PORT ?? "3001";
const apiBaseUrl =
  process.env.BACKEND_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const webPort = process.env.FULLSTACK_WEB_PORT ?? "3000";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const mcpPort = process.env.FULLSTACK_MCP_PORT ?? "3002";
const mcpServerUrl = `http://127.0.0.1:${mcpPort}/mcp`;
const childEnvironment = { ...process.env };
childEnvironment.NODE_ENV ??= "development";
// Сид включает продажу руководства, а API и billing отказываются стартовать с продажей без банка и
// адреса для чеков. Прогон ничего не покупает, поэтому ему хватает локального контура стенда:
// двойник банка по недостижимому адресу и перехват писем. Явные значения окружения важнее.
childEnvironment.TBANK_PROVIDER_MODE ??= "test";
childEnvironment.TBANK_TEST_API_BASE_URL ??= "http://127.0.0.1:9/v2";
childEnvironment.BILLING_CONTACT_ENCRYPTION_KEY ??= "aW5zaWRlLWxvY2FsLWJpbGxpbmctY29udGFjdC1rZXk=";
childEnvironment.BILLING_CONTACT_SMTP_HOST ??= "127.0.0.1";
childEnvironment.BILLING_CONTACT_SMTP_PORT ??= "9";
childEnvironment.BILLING_CONTACT_FROM ??= "no-reply@inside.localhost";
childEnvironment.BILLING_CONTACT_SMTP_LOCAL_CAPTURE ??= "true";
// Хранилище прогона — локальное хранилище Compose; адрес закреплён здесь, а не взят молча из
// значения backend по умолчанию, потому что по нему же строится CSP сборки web ниже.
childEnvironment.OBJECT_STORAGE_ENDPOINT =
  childEnvironment.OBJECT_STORAGE_ENDPOINT?.trim() || "http://127.0.0.1:9000";
// OWNER получает platform:admin для реальных операций каталога/назначения; отдельный MCP автор — только materials:manage.
// Разрешение делегированных Account стенда принадлежит прогону, а не личному `.env`: иначе
// `release:bootstrap-owner` возьмёт оттуда чужое значение и прогон начнёт зависеть от машины.
const stackAuthorPermission = "materials:manage";
Object.assign(childEnvironment, {
  // The smoke reads the published demonstration catalogue in its own check database.
  LOCAL_SEED_DEMO: "published",
  OWNER_PERMISSION: stackAuthorPermission,
  PLATFORM_RELEASE_VERSION: "v1",
  PLATFORM_SOURCE_SHA: "1".repeat(40),
});
const fullStackIdentity = await startFullStackIdentity({
  apiBaseUrl,
  webBaseUrl,
});
Object.assign(childEnvironment, fullStackIdentity.environment);
// Web собирается как production, а превью и аватары браузер берёт по подписанным адресам локального
// хранилища. Production CSP его не пускает (ADR 0028), поэтому сборка smoke называет адрес явно: тот,
// который подписывает backend.
const webEnvironment = {
  ...childEnvironment,
  NODE_ENV: "production",
  CSP_LOCAL_OBJECT_STORAGE_ORIGIN: new URL(
    childEnvironment.OBJECT_STORAGE_SIGNED_GET_ENDPOINT?.trim() || childEnvironment.OBJECT_STORAGE_ENDPOINT,
  ).origin,
};
const webReleaseIdentityPath = resolve(
  repositoryRoot,
  "apps/web/release-identity.json",
);
if (existsSync(webReleaseIdentityPath)) {
  throw new Error(`Refusing to replace ${webReleaseIdentityPath}`);
}
writeFileSync(
  webReleaseIdentityPath,
  `${JSON.stringify({
    release: "v1",
    sourceSha: "1".repeat(40),
  })}\n`,
  { mode: 0o444 },
);
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
    { ...childEnvironment, OWNER_PERMISSION: "platform:admin" },
  );
  await runPnpm(["--filter", "@inside/web", "build"], webEnvironment);

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
      { ...webEnvironment, BACKEND_BASE_URL: apiBaseUrl },
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
  // Отдельный автор Materials для пробы отказа в смоуке MCP. Этот subject не используется больше
  // нигде, а выдача разрешений только добавляет: поэтому у Account ровно `materials:manage`.
  const mcpMaterialsOnlySubject = "fullstack-mcp-materials-only";
  const mcpMaterialsOnlyAccessToken = await fullStackIdentity.createAccessToken(
    mcpMaterialsOnlySubject,
  );
  await runPnpm(["--filter", "@inside/backend", "release:bootstrap-owner"], {
    ...childEnvironment,
    OWNER_LOGTO_SUBJECT: mcpMaterialsOnlySubject,
    OWNER_PERMISSION: stackAuthorPermission,
  });
  await runPnpm(["--filter", "@inside/backend", "smoke:mcp-authoring"], {
    ...childEnvironment,
    MCP_SMOKE_ACCESS_TOKEN: mcpAccessToken.token,
    MCP_SMOKE_MATERIALS_ONLY_ACCESS_TOKEN: mcpMaterialsOnlyAccessToken.token,
    MCP_SMOKE_SERVER_URL: mcpServerUrl,
  });
  const memberAccessToken = await fullStackIdentity.createAccessToken(
    fullStackIdentity.memberSubject,
  );
  await establishFullStackAccount(memberAccessToken.token);
  const nonMemberAccessToken = await fullStackIdentity.createAccessToken(
    "fullstack-non-member",
  );
  const expiredMemberAccessToken = await fullStackIdentity.createAccessToken(
    "fullstack-expired-member",
  );
  const staleMemberAccessToken = await fullStackIdentity.createAccessToken(
    "fullstack-stale-member",
  );
  await establishFullStackAccount(nonMemberAccessToken.token);
  await establishFullStackAccount(expiredMemberAccessToken.token);
  await establishFullStackAccount(staleMemberAccessToken.token);
  await runPnpm(
    ["--filter", "@inside/backend", "smoke:grant-full-stack-membership"],
    {
      ...childEnvironment,
      FULLSTACK_MEMBER_LOGTO_SUBJECT: fullStackIdentity.memberSubject,
      FULLSTACK_EXPIRED_MEMBER_LOGTO_SUBJECT: "fullstack-expired-member",
      FULLSTACK_STALE_MEMBER_LOGTO_SUBJECT: "fullstack-stale-member",
    },
  );
  const browserAccessToken = await fullStackIdentity.createAccessToken();
  const fullStackSession =
    await fullStackIdentity.createSession(browserAccessToken);
  const fullStackMemberSession =
    await fullStackIdentity.createSession(memberAccessToken);
  await runPnpm(fullStackTestArguments(), {
    ...childEnvironment,
    FULLSTACK_API_BASE_URL: apiBaseUrl,
    FULLSTACK_LOGTO_COOKIE_NAME: fullStackIdentity.cookieName,
    FULLSTACK_LOGTO_MEMBER_SESSION: fullStackMemberSession,
    FULLSTACK_LOGTO_NON_MEMBER_SESSION:
      await fullStackIdentity.createSession(nonMemberAccessToken),
    FULLSTACK_LOGTO_EXPIRED_MEMBER_SESSION:
      await fullStackIdentity.createSession(expiredMemberAccessToken),
    FULLSTACK_LOGTO_STALE_MEMBER_SESSION: await fullStackIdentity.createSession(
      staleMemberAccessToken,
    ),
    FULLSTACK_LOGTO_SESSION: fullStackSession,
    // Сессии для проверки самого срока: у первой доступ уже истёк и продлевается, у второй
    // продлить его нечем. Ожидание пяти минут для этого не нужно.
    FULLSTACK_LOGTO_SESSION_PAST_EXPIRY:
      await fullStackIdentity.createSessionPastExpiry(),
    FULLSTACK_LOGTO_SESSION_WITHOUT_RENEWAL:
      await fullStackIdentity.createSessionWithoutRenewal(),
    FULLSTACK_WEB_BASE_URL: webBaseUrl,
  });

  process.stdout.write(
    `Full-stack smoke passed: Home ${webBaseUrl}/; Reader ${webBaseUrl}/materials/kak-ustroen-inside-platform; live API ${apiBaseUrl}; delegated MCP ${mcpServerUrl}; PostgreSQL reachable\n`,
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
  rmSync(webReleaseIdentityPath, { force: true });
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

function fullStackTestArguments() {
  const arguments_ = ["--filter", "@inside/web", "test:fullstack"];
  const grep = process.env.FULLSTACK_TEST_GREP?.trim();
  if (grep !== undefined && grep.length > 0) {
    arguments_.push("--grep", grep);
  }
  return arguments_;
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
    throw new Error(
      `pnpm ${arguments_.join(" ")} failed:\n${entry.output.join("")}`,
    );
  }
}

async function waitForJson(url, entries) {
  const response = await waitForHttp(url, entries);
  return response.json();
}

async function establishFullStackAccount(accessToken) {
  const response = await globalThis.fetch(`${apiBaseUrl}/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (response.status !== 201) {
    throw new Error(
      `Full-stack member Account establishment returned HTTP ${String(response.status)}: ${await response.text()}`,
    );
  }
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
    await new Promise((resolveDelay) =>
      globalThis.setTimeout(resolveDelay, 150),
    );
  }
  throw new Error(
    `Timed out waiting for ${url}\n${formatProcessOutput(entries)}`,
  );
}

function assertHealth(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.process !== "api" ||
    value.status !== "ready" ||
    value.database !== "reachable" ||
    typeof value.release !== "object" ||
    value.release === null ||
    value.release.release !== "development" ||
    typeof value.schema !== "object" ||
    value.schema === null ||
    !Number.isInteger(value.schema.migrationCount)
  ) {
    throw new Error(`Unexpected API health response: ${JSON.stringify(value)}`);
  }
}

function assertProcessesRunning(entries) {
  const stopped = entries.find(({ child }) => child.exitCode !== null);
  if (stopped !== undefined) {
    throw new Error(
      `${stopped.name} exited early:\n${stopped.output.join("")}`,
    );
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
  return entries
    .map(({ name, output }) => `${name}:\n${output.join("")}`)
    .join("\n");
}
