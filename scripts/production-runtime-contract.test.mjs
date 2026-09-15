import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const productionTemplates = readdirSync(resolve(repositoryRoot, "config/compose/production"))
  .map((name) => read(`config/compose/production/${name}`))
  .join("\n");

// The activation protocol has exactly these operations; a prefix would expose any future sub-route.
const activationPaths = ["binding", "own-access", "attempts", "evidence"]
  .map((operation) => `/integrations/telegram/v1/subscription-activation/${operation}`)
  .join(" ");
// The bank, Tribute and Telegram call exactly these API callbacks; each Caddy matcher is POST-only.
const callbackRoutes = [
  ["tbank_notification", "/billing/tbank/notification"],
  ["tribute_webhook", "/integrations/tribute/v1/webhook"],
  ["telegram_activation", activationPaths],
  ["community_dispatch", "/internal/billing-dispatch/authorize"],
  ["notification_dispatch", "/internal/notifications/dispatch/authorize"],
  ["communications_authorize", "/integrations/telegram/v1/communications/authorize"],
  ["communications_validate", "/integrations/telegram/v1/communications/validate-content"],
];

const runtime = {
  caddy: read("infra/production/runtime/platform.caddy"),
  compose: read("compose.production.yaml"),
  composeEnvironment: read("config/compose/production/compose.env.example"),
  productionTemplates,
  releaseWorkflow: read(".github/workflows/release.yml"),
};

describe("production runtime architecture contract", () => {
  it("runs nine application processes from manifest-selected images beside a private broker", () => {
    assertRuntimeContract(runtime);
  });

  it("rejects a source build added to the runtime Compose", () => {
    assert.throws(
      () => assertRuntimeContract({
        ...runtime,
        compose: runtime.compose.replace(
          "    command: [\"node\", \"dist/entrypoints/api.js\"]",
          "    build: .\n    command: [\"node\", \"dist/entrypoints/api.js\"]",
        ),
      }),
      /must not build application source/u,
    );
  });

  it("rejects the local bank double and mail interceptor in the production runtime", () => {
    for (const service of ["bank-double", "mailpit"]) {
      assert.throws(
        () => assertRuntimeContract({
          ...runtime,
          compose: runtime.compose.replace("\n  web:\n", `\n  ${service}:\n    image: example\n\n  web:\n`),
        }),
        /must not accept the local bank double or mail interceptor/u,
      );
    }
    for (const declaration of ["TBANK_PROVIDER_MODE=test", "TBANK_TEST_API_BASE_URL=http://bank.invalid/v2",
      "BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true"]) {
      assert.throws(
        () => assertRuntimeContract({
          ...runtime,
          productionTemplates: `${runtime.productionTemplates}\n${declaration}\n`,
        }),
        /must not accept the local bank double or mail interceptor/u,
      );
    }
  });

  it("rejects a broad integration proxy that exposes unknown callbacks", () => {
    assert.throws(
      () => assertRuntimeContract({
        ...runtime,
        caddy: runtime.caddy.replace(
          "respond @unknown_integration 404",
          "reverse_proxy @unknown_integration {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}",
        ),
      }),
      /unknown integration routes must fail closed/u,
    );
  });

  it("publishes each payment and Telegram callback as one exact POST route", () => {
    for (const [name, path] of callbackRoutes) {
      assert.throws(
        () => assertRuntimeContract({ ...runtime, caddy: runtime.caddy.replace(`path ${path}\n`, "path /internal/*\n") }),
        /must publish only exact POST callbacks/u,
        `${name} must not widen to a prefix`,
      );
      assert.throws(
        () => assertRuntimeContract({ ...runtime, caddy: runtime.caddy.replace(new RegExp(`(@${name} \\{\\s+)method POST`, "u"), "$1method GET POST") }),
        /must publish only exact POST callbacks/u,
        `${name} must stay POST-only`,
      );
    }
  });

  it("keeps the broker private, digest-pinned and TLS-only", () => {
    assert.throws(
      () => assertRuntimeContract({ ...runtime, compose: runtime.compose.replace("  rabbitmq:\n", "  rabbitmq:\n    ports: [\"5671:5671\"]\n") }),
      /broker must not publish a port/u,
    );
    assert.throws(
      () => assertRuntimeContract({ ...runtime, compose: runtime.compose.replace(/image: rabbitmq:[^\n]+/u, "image: rabbitmq:4.2.4-alpine") }),
      /broker image must be pinned by digest/u,
    );
    assert.throws(
      () => assertRuntimeContract({ ...runtime, compose: runtime.compose.replace("listeners.tcp = none", "listeners.tcp.default = 5672") }),
      /broker must accept only AMQPS/u,
    );
  });

  it("rejects a Logto sign-in callback that allows other HTTP methods", () => {
    assert.throws(
      () => assertRuntimeContract({
        ...runtime,
        caddy: runtime.caddy.replace("method POST", "method GET"),
      }),
      /Logto linked-identity callback must allow only POST/u,
    );
  });
});

function assertRuntimeContract(files) {
  if (/^\s+build:/mu.test(files.compose)) {
    throw new Error("production runtime must not build application source");
  }
  // Двойник банка и перехватчик писем принадлежат стенду: production не запускает их и не
  // объявляет их адреса даже в шаблонах.
  const standOnly = /bank-double|mailpit|TBANK_PROVIDER_MODE\s*[:=]\s*["']?test|TBANK_TEST_|BILLING_CONTACT_SMTP_LOCAL_CAPTURE/u;
  for (const [name, contents] of [["runtime Compose", files.compose], ["environment templates", files.productionTemplates]]) {
    if (standOnly.test(contents)) {
      throw new Error(`production ${name} must not accept the local bank double or mail interceptor`);
    }
  }
  const services = [
    "rabbitmq",
    "migrations",
    "api",
    "mcp",
    "material-assets-worker",
    "profile-avatars-worker",
    "video-deletions-worker",
    "billing-worker",
    "notifications-worker",
    "web",
  ];
  for (const service of services) {
    assert.match(files.compose, new RegExp(`^  ${service}:$`, "mu"));
  }
  const serviceBlock = files.compose.split("\nservices:\n")[1]?.split("\nnetworks:\n")[0] ?? "";
  assert.deepEqual(
    [...serviceBlock.matchAll(/^ {2}[a-z][a-z0-9-]*:$/gmu)].map(([line]) => line.trim()),
    services.map((service) => `${service}:`),
  );
  assert.match(files.compose, /image: \$\{PLATFORM_BACKEND_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_BACKEND_IMAGE_DIGEST:/u);
  assert.match(files.compose, /image: \$\{PLATFORM_WEB_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_WEB_IMAGE_DIGEST:/u);
  assert.doesNotMatch(
    files.composeEnvironment,
    /PLATFORM_(?:BACKEND|WEB)_IMAGE_(?:REPOSITORY|DIGEST)/u,
  );
  assert.equal(
    files.compose.match(/\$\{PLATFORM_RELEASE_ENV_FILE:[^}]+\}/gu)?.length,
    9,
  );
  // Свой брокер окружения: только внутренняя сеть, точный digest образа и слушатель одного AMQPS.
  const broker = files.compose.split("\n  rabbitmq:\n")[1]?.split(/\n {2}[a-z][a-z0-9-]*:\n/u)[0] ?? "";
  if (/^\s+ports:/mu.test(broker)) throw new Error("production broker must not publish a port");
  if (!/image: rabbitmq:[0-9.]+-alpine@sha256:[0-9a-f]{64}$/mu.test(broker)) {
    throw new Error("production broker image must be pinned by digest");
  }
  if (!/listeners\.tcp = none\n\s+listeners\.ssl\.default = 5671/u.test(files.compose)) {
    throw new Error("production broker must accept only AMQPS");
  }
  for (const worker of ["billing-worker", "notifications-worker"]) {
    assert.ok(files.compose.includes(`      - \${PLATFORM_CONFIG_DIR:?PLATFORM_CONFIG_DIR is required}/${worker}.env\n`));
  }
  assert.doesNotMatch(files.compose, /PLATFORM_CONFIG_DIR:[^}]+\}\/runtime\.env/u);
  assert.doesNotMatch(files.compose, /^ {2}(?:postgres|caddy):$/mu);
  assert.match(files.compose, /database:\n {4}external: true\n {4}name: \$\{FOUNDATION_DATABASE_NETWORK:/u);
  assert.match(files.compose, /application:\n {4}internal: true/u);
  assert.match(files.compose, /127\.0\.0\.1:\$\{PLATFORM_(?:API|MCP|WEB)_LOOPBACK_PORT:/u);
  assert.match(files.compose, /dist\/infrastructure\/worker-healthcheck\.js/u);
  assert.doesNotMatch(files.compose, /- -e\n/u);
  for (const service of ["api", "mcp", "web"]) {
    const commandPath = service === "web"
      ? "apps/web/healthcheck/http-healthcheck.mjs"
      : "healthcheck/http-healthcheck.mjs";
    assert.ok(files.compose.includes(`        - ${commandPath}\n        - ${service}\n`));
  }

  assert.match(files.releaseWorkflow, /INSIDE_RELEASE_VERSION=\$\{\{ needs\.plan\.outputs\.version \}\}/u);
  assert.match(files.releaseWorkflow, /INSIDE_SOURCE_SHA=\$\{\{ needs\.plan\.outputs\.source_sha \}\}/u);

  for (const path of [
    "/integrations/telegram/v1/membership-evidence",
    "/integrations/telegram/v1/sign-in/linked-identity",
    "/integrations/kinescope/v1/webhook",
    "/integrations/kinescope/v1/authorize",
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    assert.match(files.caddy, new RegExp(`path ${escapeRegExp(path)}$`, "mu"));
  }
  assert.match(
    files.caddy,
    /@telegram_sign_in \{\s+method POST\s+path \/integrations\/telegram\/v1\/sign-in\/linked-identity\s+\}/u,
    "Logto linked-identity callback must allow only POST",
  );
  // Банк, Tribute и Telegram вызывают ровно эти адреса; каждый адрес защищён своим credential в API.
  for (const [name, path] of callbackRoutes) {
    const route = new RegExp(`@${name} \\{\\n\\t\\t\\tmethod POST\\n\\t\\t\\tpath ${escapeRegExp(path)}\\n\\t\\t\\}\\n\\t\\treverse_proxy @${name} \\{\\$PLATFORM_API_UPSTREAM:127\\.0\\.0\\.1:13001\\}`, "u");
    if (!route.test(files.caddy)) throw new Error(`${name} must publish only exact POST callbacks`);
  }
  if (/path \/internal\/\*|path \/billing\/\*|subscription-activation\/\*/u.test(files.caddy)) {
    throw new Error("payment and Telegram routes must publish only exact POST callbacks");
  }
  if (!/@unknown_integration path \/integrations\/\*\n\t\trespond @unknown_integration 404/u.test(files.caddy)) {
    throw new Error("unknown integration routes must fail closed");
  }
  assert.match(files.caddy, /@private_health path \/health \/health\/\* \/_health\/\*/u);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
