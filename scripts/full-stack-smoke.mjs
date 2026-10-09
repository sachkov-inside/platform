// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkDatabaseUrl, resetCheckDatabase } from "./check-database.mjs";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import {
  seedFullStackPractice,
  startPracticeReadProxy,
} from "./full-stack-practice.mjs";
import { seedFullStackTaskC } from "./full-stack-task-c.mjs";
import { seedFullStackTask } from "./full-stack-task.mjs";

import { z } from "zod";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmExecutable = process.env["npm_execpath"];

if (pnpmExecutable === undefined) {
  throw new Error("Run the full-stack smoke through the pinned pnpm CLI");
}
const pnpmPath = pnpmExecutable;
const fullStackBrowserCommand = "test:fullstack";

// Only an explicitly exported DATABASE_URL may point the smoke at another database; a personal `.env`
// usually names the stand database, which this smoke must never migrate, seed or rewrite.
const explicitDatabaseUrl = process.env["DATABASE_URL"];
const environmentPath = resolve(repositoryRoot, ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}
if (explicitDatabaseUrl === undefined) {
  resetCheckDatabase({ cwd: repositoryRoot });
  process.env["DATABASE_URL"] = checkDatabaseUrl(
    process.env["POSTGRES_HOST_PORT"] ?? 5432,
  );
}
const apiPort = process.env["API_PORT"] ?? "3001";
const apiBaseUrl =
  process.env["BACKEND_BASE_URL"] ?? `http://127.0.0.1:${apiPort}`;
const webPort = process.env["FULLSTACK_WEB_PORT"] ?? "3000";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const mcpPort = process.env["FULLSTACK_MCP_PORT"] ?? "3002";
const mcpServerUrl = `http://127.0.0.1:${mcpPort}/mcp`;
const childEnvironment = { ...process.env };
childEnvironment["NODE_ENV"] ??= "development";
// Сид включает продажу руководства, а API и billing отказываются стартовать с продажей без банка и
// адреса для чеков. Прогон ничего не покупает, поэтому ему хватает локального контура стенда:
// двойник банка по недостижимому адресу и перехват писем. Явные значения окружения важнее.
childEnvironment["TBANK_PROVIDER_MODE"] ??= "test";
childEnvironment["TBANK_TEST_API_BASE_URL"] ??= "http://127.0.0.1:9/v2";
childEnvironment["BILLING_CONTACT_ENCRYPTION_KEY"] ??=
  "aW5zaWRlLWxvY2FsLWJpbGxpbmctY29udGFjdC1rZXk=";
childEnvironment["BILLING_CONTACT_SMTP_HOST"] ??= "127.0.0.1";
childEnvironment["BILLING_CONTACT_SMTP_PORT"] ??= "9";
childEnvironment["BILLING_CONTACT_FROM"] ??= "no-reply@inside.localhost";
childEnvironment["BILLING_CONTACT_SMTP_LOCAL_CAPTURE"] ??= "true";
// Хранилище прогона — локальное хранилище Compose; адрес закреплён здесь, а не взят молча из
// значения backend по умолчанию, потому что по нему же строится CSP сборки web ниже.
childEnvironment["OBJECT_STORAGE_ENDPOINT"] =
  childEnvironment["OBJECT_STORAGE_ENDPOINT"]?.trim() ||
  "http://127.0.0.1:9000";
// OWNER получает platform:admin для реальных операций каталога/назначения; отдельный MCP автор — только materials:manage.
// Разрешение делегированных Account стенда принадлежит прогону, а не личному `.env`: иначе
// `release:bootstrap-owner` возьмёт оттуда чужое значение и прогон начнёт зависеть от машины.
const stackAuthorPermission = "materials:manage";
// Отдельные identities проверок доступа (#904). У каждой ровно одно основание: одно разрешение или
// ничего. Доступ к одному Product ученик получает в самом сценарии, без bridge и `wholePlatform`.
const separateAccessIdentities = [
  {
    subject: "fullstack-materials-only",
    permission: stackAuthorPermission,
    sessionVariable: "FULLSTACK_LOGTO_MATERIALS_ONLY_SESSION",
  },
  {
    subject: "fullstack-billing-only",
    permission: "billing:manage",
    sessionVariable: "FULLSTACK_LOGTO_BILLING_ONLY_SESSION",
  },
  {
    subject: "fullstack-product-a-learner",
    permission: undefined,
    sessionVariable: "FULLSTACK_LOGTO_PRODUCT_A_LEARNER_SESSION",
  },
  {
    subject: "fullstack-reader-a",
    permission: undefined,
    sessionVariable: "FULLSTACK_LOGTO_READER_A_SESSION",
  },
  {
    subject: "fullstack-reader-b",
    permission: undefined,
    sessionVariable: "FULLSTACK_LOGTO_READER_B_SESSION",
  },
];
Object.assign(childEnvironment, {
  // The smoke reads the published demonstration catalogue in its own check database.
  LOCAL_SEED_DEMO: "published",
  OWNER_PERMISSION: stackAuthorPermission,
  PLATFORM_RELEASE_VERSION: "v1",
  PLATFORM_SOURCE_SHA: "1".repeat(40),
});
const learningMcpUrl = `${mcpServerUrl}/learning`;
const fullStackIdentity = await startFullStackIdentity({
  apiBaseUrl,
  webBaseUrl,
  learningResource: learningMcpUrl,
});
Object.assign(childEnvironment, fullStackIdentity.environment);
const practiceDelayMs = Number(
  process.env["FULLSTACK_PRACTICE_READ_DELAY_MS"] ?? "0",
);
const practiceReadProxy =
  practiceDelayMs > 0
    ? await startPracticeReadProxy(apiBaseUrl, practiceDelayMs)
    : undefined;
const webBackendUrl = practiceReadProxy?.origin ?? apiBaseUrl;
// Web собирается как production, а превью и аватары браузер берёт по подписанным адресам локального
// хранилища. Production CSP его не пускает (ADR 0028), поэтому сборка smoke называет адрес явно: тот,
// который подписывает backend.
const webEnvironment = {
  ...childEnvironment,
  NODE_ENV: "production",
  CSP_LOCAL_OBJECT_STORAGE_ORIGIN: new URL(
    childEnvironment["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]?.trim() ||
      childEnvironment["OBJECT_STORAGE_ENDPOINT"],
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
/**
 * @typedef {{
 *   name: string;
 *   child: import("node:child_process").ChildProcess;
 *   output: string[];
 * }} ProcessEntry
 */
const developmentHealthSchema = z
  .object({
    process: z.literal("api"),
    status: z.literal("ready"),
    database: z.literal("reachable"),
    release: z.object({ release: z.literal("development") }).passthrough(),
    schema: z.object({ migrationCount: z.number().int() }).passthrough(),
  })
  .passthrough();

/** @type {ProcessEntry[]} */
const processes = [];
/** @type {Set<ProcessEntry>} */
const activeProcesses = new Set();
/** @type {Promise<void> | undefined} */
let cleanupPromise;
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  await runPnpm(["--filter", "@inside/backend", "db:migrate"]);
  await runPnpm(["--filter", "@inside/backend", "db:seed"]);
  await runPnpm(["--filter", "@inside/backend", "release:bootstrap-owner"], {
    ...childEnvironment,
    OWNER_PERMISSION: "platform:admin",
  });
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
      { ...webEnvironment, BACKEND_BASE_URL: webBackendUrl },
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
  await grantAccountPermission(mcpMaterialsOnlySubject, stackAuthorPermission);
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
  /** @type {Record<string, string>} */
  const separateAccessSessions = {};
  for (const identity of separateAccessIdentities) {
    const accessToken = await fullStackIdentity.createAccessToken(
      identity.subject,
    );
    await establishFullStackAccount(accessToken.token);
    if (identity.permission !== undefined) {
      await grantAccountPermission(identity.subject, identity.permission);
    }
    separateAccessSessions[identity.sessionVariable] =
      await fullStackIdentity.createSession(accessToken);
  }
  const browserAccessToken = await fullStackIdentity.createAccessToken();
  const practiceFixture = await seedFullStackPractice(
    apiBaseUrl,
    browserAccessToken.token,
  );
  const freePracticeFixture = await seedFullStackPractice(
    apiBaseUrl,
    browserAccessToken.token,
    "free",
  );
  const taskFixture = await seedFullStackTask(
    apiBaseUrl,
    browserAccessToken.token,
  );
  const taskCFixture = await seedFullStackTaskC(
    apiBaseUrl,
    browserAccessToken.token,
  );
  const fullStackSession =
    await fullStackIdentity.createSession(browserAccessToken);
  const fullStackMemberSession =
    await fullStackIdentity.createSession(memberAccessToken);
  await runPnpm(fullStackTestArguments(), {
    ...childEnvironment,
    FULLSTACK_API_BASE_URL: apiBaseUrl,
    FULLSTACK_PRACTICE_SLUG: practiceFixture.slug,
    FULLSTACK_FREE_PRACTICE_SLUG: freePracticeFixture.slug,
    FULLSTACK_TASK_PRODUCT_SLUG: taskFixture.productSlug,
    FULLSTACK_TASK_CODE: taskFixture.code,
    FULLSTACK_MATERIAL_IMAGE_VARIANTS: JSON.stringify(
      taskCFixture.materialImageVariants,
    ),
    FULLSTACK_TASK_IMAGE_VARIANTS: JSON.stringify(
      taskCFixture.taskImageVariants,
    ),
    FULLSTACK_TASK_C_PRODUCT_SLUG: taskCFixture.productSlug,
    FULLSTACK_TASK_C_CODE: taskCFixture.code,
    FULLSTACK_TASK_C_CLOSED_CODE: taskCFixture.closedCode,
    FULLSTACK_TASK_C_CLOSED_ASSET_ID: taskCFixture.closedAssetId,
    // The learner's agent (#948): a refresh token it exchanges for a learner MCP token when it
    // needs one, so the token is fresh however late in the run the scenario starts.
    FULLSTACK_LEARNING_MCP_URL: learningMcpUrl,
    FULLSTACK_IDENTITY_TOKEN_URL: `${fullStackIdentity.environment.LOGTO_ENDPOINT}/oidc/token`,
    FULLSTACK_NON_MEMBER_REFRESH_TOKEN: fullStackIdentity.createRefreshToken(
      "fullstack-non-member",
    ),
    FULLSTACK_IMPORTED_MATERIAL_IDS: [
      practiceFixture.materialId,
      freePracticeFixture.materialId,
      taskFixture.materialId,
      ...taskCFixture.materialIds,
    ].join(","),
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
    ...separateAccessSessions,
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
  await practiceReadProxy?.close();
  rmSync(webReleaseIdentityPath, { force: true });
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

function fullStackTestArguments() {
  const arguments_ = ["--filter", "@inside/web", fullStackBrowserCommand];
  const grep = process.env["FULLSTACK_TEST_GREP"]?.trim();
  if (grep !== undefined && grep.length > 0) {
    arguments_.push("--grep", grep);
  }
  return arguments_;
}

/**
 * @param {string} name
 * @param {string[]} arguments_
 * @param {NodeJS.ProcessEnv} environment
 * @returns {ProcessEntry}
 */
function startPnpm(name, arguments_, environment) {
  if (interruptedSignal !== undefined)
    throw new Error("Full-stack smoke interrupted");
  /** @type {string[]} */
  const output = [];
  const child = spawnOwned(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { name, child, output };
  activeProcesses.add(entry);
  child.once("error", (error) => output.push(String(error)));
  child.stdout?.on("data", (/** @type {Buffer} */ chunk) =>
    retainOutput(output, chunk),
  );
  child.stderr?.on("data", (/** @type {Buffer} */ chunk) =>
    retainOutput(output, chunk),
  );
  return entry;
}

/**
 * @param {string[]} arguments_
 * @param {NodeJS.ProcessEnv} [environment]
 */
async function runPnpm(arguments_, environment = childEnvironment) {
  const entry = startPnpm("pnpm", arguments_, environment);
  if (arguments_.includes(fullStackBrowserCommand)) {
    // Stream browser measurements before the bounded failure log can evict their chunks.
    entry.child.stdout?.pipe(process.stdout, { end: false });
    entry.child.stderr?.pipe(process.stderr, { end: false });
  }
  try {
    const exitCode = await commandExit(entry.child);
    if (exitCode !== 0) {
      throw new Error(
        `pnpm ${arguments_.join(" ")} failed:\n${entry.output.join("")}`,
      );
    }
  } finally {
    await stopOwned(entry.child);
    activeProcesses.delete(entry);
  }
}

/**
 * @param {string} url
 * @param {ProcessEntry[]} entries
 * @returns {Promise<unknown>}
 */
async function waitForJson(url, entries) {
  const response = await waitForHttp(url, entries);
  return response.json();
}

/**
 * Выдаёт Account одно разрешение через trusted owner bootstrap. Выдача только добавляет, поэтому
 * у subject, который больше нигде не получает прав, остаётся ровно это разрешение.
 * @param {string} subject
 * @param {string} permission
 */
async function grantAccountPermission(subject, permission) {
  await runPnpm(["--filter", "@inside/backend", "release:bootstrap-owner"], {
    ...childEnvironment,
    OWNER_LOGTO_SUBJECT: subject,
    OWNER_PERMISSION: permission,
  });
}

/** @param {string} accessToken */
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

/**
 * @param {string} url
 * @param {ProcessEntry[]} entries
 */
async function waitForHttp(url, entries) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertProcessesRunning(entries);
    try {
      const response = await globalThis.fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
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

/** @param {unknown} value */
function assertHealth(value) {
  if (!developmentHealthSchema.safeParse(value).success) {
    throw new Error(`Unexpected API health response: ${JSON.stringify(value)}`);
  }
}

/** @param {ProcessEntry[]} entries */
function assertProcessesRunning(entries) {
  if (interruptedSignal !== undefined)
    throw new Error("Full-stack smoke interrupted");
  const stopped = entries.find(
    ({ child }) =>
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null,
  );
  if (stopped !== undefined) {
    throw new Error(
      `${stopped.name} exited early:\n${stopped.output.join("")}`,
    );
  }
}

function cleanup() {
  cleanupPromise ??= Promise.all(
    [...activeProcesses].map((entry) => stopOwned(entry.child)),
  ).then(() => undefined);
  return cleanupPromise;
}

/** @param {NodeJS.Signals} signal */
async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await cleanup();
}

/**
 * @param {string[]} output
 * @param {Buffer} chunk
 */
function retainOutput(output, chunk) {
  output.push(chunk.toString());
  while (output.join("").length > 40_000) {
    output.shift();
  }
}

/** @param {ProcessEntry[]} entries */
function formatProcessOutput(entries) {
  return entries
    .map(({ name, output }) => `${name}:\n${output.join("")}`)
    .join("\n");
}
