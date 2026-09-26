import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const productionTemplates = readdirSync(
  resolve(repositoryRoot, "config/compose/production"),
)
  .map((name) => read(`config/compose/production/${name}`))
  .join("\n");

// The activation protocol has exactly these operations; a prefix would expose any future sub-route.
const activationPaths = ["binding", "own-access", "attempts", "evidence"]
  .map(
    (operation) =>
      `/integrations/telegram/v1/subscription-activation/${operation}`,
  )
  .join(" ");
// The bank, Tribute and Telegram call exactly these API callbacks; each Caddy matcher is POST-only.
const callbackRoutes = [
  ["tbank_notification", "/billing/tbank/notification"],
  ["tribute_webhook", "/integrations/tribute/v1/webhook"],
  ["telegram_activation", activationPaths],
  ["community_dispatch", "/internal/billing-dispatch/authorize"],
  ["notification_dispatch", "/internal/notifications/dispatch/authorize"],
  [
    "communications_authorize",
    "/integrations/telegram/v1/communications/authorize",
  ],
  [
    "communications_validate",
    "/integrations/telegram/v1/communications/validate-content",
  ],
];

const runtime = {
  releaseRunbook: read("docs/runbooks/production-release.md"),
  caddy: read("infra/production/runtime/platform.caddy"),
  maintenanceCaddy: read("infra/production/deploy/maintenance.caddy"),
  hostCaddy: read("infra/production/host/Caddyfile"),
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
      () =>
        assertRuntimeContract({
          ...runtime,
          compose: runtime.compose.replace(
            '    command: ["node", "dist/entrypoints/api.js"]',
            '    build: .\n    command: ["node", "dist/entrypoints/api.js"]',
          ),
        }),
      /must not build application source/u,
    );
  });

  it("rejects the local bank double and mail interceptor in the production runtime", () => {
    for (const service of ["bank-double", "mailpit"]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            compose: runtime.compose.replace(
              "\n  web:\n",
              `\n  ${service}:\n    image: example\n\n  web:\n`,
            ),
          }),
        /must not accept the local bank double or mail interceptor/u,
      );
    }
    for (const declaration of [
      "TBANK_PROVIDER_MODE=test",
      "TBANK_TEST_API_BASE_URL=http://bank.invalid/v2",
      "BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true",
    ]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            productionTemplates: `${runtime.productionTemplates}\n${declaration}\n`,
          }),
        /must not accept the local bank double or mail interceptor/u,
      );
    }
  });

  it("rejects a broad integration proxy that exposes unknown callbacks", () => {
    assert.throws(
      () =>
        assertRuntimeContract({
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
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              `path ${path}\n`,
              "path /internal/*\n",
            ),
          }),
        /must publish only exact POST callbacks/u,
        `${name} must not widen to a prefix`,
      );
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              new RegExp(`(@${name} \\{\\s+)method POST`, "u"),
              "$1method GET POST",
            ),
          }),
        /must publish only exact POST callbacks/u,
        `${name} must stay POST-only`,
      );
    }
  });

  it("lists every published API and MCP route in the release runbook exactly as Caddy publishes it", () => {
    const table =
      "docs/runbooks/production-release.md must list exactly the Caddy API and MCP routes";
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          releaseRunbook: runtime.releaseRunbook.replace(
            /^\| POST \| `\/internal\/notifications\/dispatch\/authorize` \|[^\n]*\n/mu,
            "",
          ),
        }),
      new RegExp(table, "u"),
      "a published route missing from the table",
    );
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          releaseRunbook: runtime.releaseRunbook.replace(
            "| любой | `/integrations/kinescope/v1/webhook` |",
            "| POST | `/integrations/kinescope/v1/webhook` |",
          ),
        }),
      new RegExp(table, "u"),
      "a method that differs from Caddy",
    );
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          caddy: runtime.caddy.replace(
            "\t\t@mcp path /mcp\n",
            "\t\t@unlisted path /integrations/example/v1/callback\n\t\treverse_proxy @unlisted {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n\n\t\t@mcp path /mcp\n",
          ),
        }),
      new RegExp(table, "u"),
      "a Caddy route that the table does not describe",
    );
    for (const [shape, route] of [
      [
        "a block matcher without a method",
        "\t\t@unlisted {\n\t\t\tpath /integrations/example/v1/callback\n\t\t}\n\t\treverse_proxy @unlisted {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n",
      ],
      [
        "a block matcher with two methods",
        "\t\t@unlisted {\n\t\t\tmethod GET POST\n\t\t\tpath /integrations/example/v1/callback\n\t\t}\n\t\treverse_proxy @unlisted {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n",
      ],
      [
        "a path proxied without a named matcher",
        "\t\treverse_proxy /integrations/example/v1/callback {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n",
      ],
    ]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              "\t\t@mcp path /mcp\n",
              `${route}\n\t\t@mcp path /mcp\n`,
            ),
          }),
        /not in a form the runbook route check understands/u,
        shape,
      );
    }
  });

  it("keeps the broker private, digest-pinned and TLS-only", () => {
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          compose: runtime.compose.replace(
            "  rabbitmq:\n",
            '  rabbitmq:\n    ports: ["5671:5671"]\n',
          ),
        }),
      /broker must not publish a port/u,
    );
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          compose: runtime.compose.replace(
            /image: rabbitmq:[^\n]+/u,
            "image: rabbitmq:4.2.4-alpine",
          ),
        }),
      /broker image must be pinned by digest/u,
    );
    assert.throws(
      () =>
        assertRuntimeContract({
          ...runtime,
          compose: runtime.compose.replace(
            "listeners.tcp = none",
            "listeners.tcp.default = 5672",
          ),
        }),
      /broker must accept only AMQPS/u,
    );
  });

  it("rejects an application process that keeps kernel capabilities or a writable root", () => {
    for (const [removed, reason] of [
      ["\n  cap_drop: [ALL]\n", /backend processes must drop capabilities/u],
      ["\n  read_only: true\n", /backend processes must drop capabilities/u],
      [
        "\n    cap_drop: [ALL]\n    mem_limit: 512m\n",
        /web must drop capabilities/u,
      ],
    ]) {
      assert.ok(runtime.compose.includes(removed), removed);
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            compose: runtime.compose.replace(removed, "\n"),
          }),
        reason,
      );
    }
  });

  it("rejects an edge that trusts a client-supplied X-Forwarded-For", () => {
    for (const key of ["caddy", "hostCaddy"]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            [key]: `${runtime[key]}\n{\n\tservers {\n\t\ttrusted_proxies static private_ranges\n\t}\n}\n`,
          }),
        /must not trust a client-supplied X-Forwarded-For/u,
      );
    }
  });

  it("keeps HSTS on the application and the maintenance page", () => {
    for (const key of ["caddy", "maintenanceCaddy"]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            [key]: runtime[key].replace(
              /\theader Strict-Transport-Security[^\n]+\n/u,
              "",
            ),
          }),
        /must send HSTS/u,
      );
    }
  });

  it("rejects a Logto sign-in callback that allows other HTTP methods", () => {
    assert.throws(
      () =>
        assertRuntimeContract({
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
  const standOnly =
    /bank-double|mailpit|TBANK_PROVIDER_MODE\s*[:=]\s*["']?test|TBANK_TEST_|BILLING_CONTACT_SMTP_LOCAL_CAPTURE/u;
  for (const [name, contents] of [
    ["runtime Compose", files.compose],
    ["environment templates", files.productionTemplates],
  ]) {
    if (standOnly.test(contents)) {
      throw new Error(
        `production ${name} must not accept the local bank double or mail interceptor`,
      );
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
  const serviceBlock =
    files.compose.split("\nservices:\n")[1]?.split("\nnetworks:\n")[0] ?? "";
  assert.deepEqual(
    [...serviceBlock.matchAll(/^ {2}[a-z][a-z0-9-]*:$/gmu)].map(([line]) =>
      line.trim(),
    ),
    services.map((service) => `${service}:`),
  );
  assert.match(
    files.compose,
    /image: \$\{PLATFORM_BACKEND_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_BACKEND_IMAGE_DIGEST:/u,
  );
  assert.match(
    files.compose,
    /image: \$\{PLATFORM_WEB_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_WEB_IMAGE_DIGEST:/u,
  );
  assert.doesNotMatch(
    files.composeEnvironment,
    /PLATFORM_(?:BACKEND|WEB)_IMAGE_(?:REPOSITORY|DIGEST)/u,
  );
  assert.equal(
    files.compose.match(/\$\{PLATFORM_RELEASE_ENV_FILE:[^}]+\}/gu)?.length,
    9,
  );
  // Свой брокер окружения: только внутренняя сеть, точный digest образа и слушатель одного AMQPS.
  const broker =
    files.compose
      .split("\n  rabbitmq:\n")[1]
      ?.split(/\n {2}[a-z][a-z0-9-]*:\n/u)[0] ?? "";
  if (/^\s+ports:/mu.test(broker))
    throw new Error("production broker must not publish a port");
  if (!/image: rabbitmq:[0-9.]+-alpine@sha256:[0-9a-f]{64}$/mu.test(broker)) {
    throw new Error("production broker image must be pinned by digest");
  }
  if (
    !/listeners\.tcp = none\n\s+listeners\.ssl\.default = 5671/u.test(
      files.compose,
    )
  ) {
    throw new Error("production broker must accept only AMQPS");
  }
  // Процессы приложения без привилегий ядра и с пределами памяти и процессов; backend — ещё и без
  // записи в корень, кроме `/tmp`.
  const backendRuntime =
    files.compose
      .split("\nx-backend-runtime: &backend-runtime\n")[1]
      ?.split("\n\n")[0] ?? "";
  for (const setting of [
    "cap_drop: [ALL]",
    "mem_limit: ",
    "pids_limit: ",
    "read_only: true",
    "tmpfs: [/tmp]",
    "security_opt: [no-new-privileges:true]",
  ]) {
    if (!backendRuntime.includes(`\n  ${setting}`)) {
      throw new Error(
        `backend processes must drop capabilities and bound resources: ${setting}`,
      );
    }
  }
  assert.equal(
    files.compose.match(/^ {4}<<: \*backend-runtime$/gmu)?.length,
    8,
  );
  const web =
    files.compose.split("\n  web:\n")[1]?.split("\n\nnetworks:\n")[0] ?? "";
  // Брокер переживает выпуски: `deploy-release` пересоздал бы его при любой правке этого блока.
  for (const setting of [
    "cap_drop: [ALL]",
    "mem_limit: ",
    "pids_limit: ",
    "security_opt: [no-new-privileges:true]",
  ]) {
    if (!web.includes(`\n    ${setting}`)) {
      throw new Error(
        `web must drop capabilities and bound resources: ${setting}`,
      );
    }
  }
  for (const [name, caddy] of [
    ["platform.caddy", files.caddy],
    ["maintenance.caddy", files.maintenanceCaddy],
  ]) {
    if (
      !/^\theader Strict-Transport-Security "max-age=31536000; includeSubDomains"$/mu.test(
        caddy,
      )
    ) {
      throw new Error(`${name} must send HSTS`);
    }
  }
  // Web считает запросы по X-Forwarded-For только потому, что Caddy не доверяет входящему заголовку.
  for (const [name, caddy] of [
    ["platform.caddy", files.caddy],
    ["host Caddyfile", files.hostCaddy],
  ]) {
    if (/^\s*(?:trusted_proxies|client_ip_headers)\b/mu.test(caddy)) {
      throw new Error(
        `${name} must not trust a client-supplied X-Forwarded-For`,
      );
    }
  }
  for (const worker of ["billing-worker", "notifications-worker"]) {
    assert.ok(
      files.compose.includes(
        `      - \${PLATFORM_CONFIG_DIR:?PLATFORM_CONFIG_DIR is required}/${worker}.env\n`,
      ),
    );
  }
  assert.doesNotMatch(
    files.compose,
    /PLATFORM_CONFIG_DIR:[^}]+\}\/runtime\.env/u,
  );
  assert.doesNotMatch(files.compose, /^ {2}(?:postgres|caddy):$/mu);
  assert.match(
    files.compose,
    /database:\n {4}external: true\n {4}name: \$\{FOUNDATION_DATABASE_NETWORK:/u,
  );
  assert.match(files.compose, /application:\n {4}internal: true/u);
  assert.match(
    files.compose,
    /127\.0\.0\.1:\$\{PLATFORM_(?:API|MCP|WEB)_LOOPBACK_PORT:/u,
  );
  assert.match(files.compose, /dist\/infrastructure\/worker-healthcheck\.js/u);
  assert.doesNotMatch(files.compose, /- -e\n/u);
  for (const service of ["api", "mcp", "web"]) {
    const commandPath =
      service === "web"
        ? "apps/web/healthcheck/http-healthcheck.mjs"
        : "healthcheck/http-healthcheck.mjs";
    assert.ok(
      files.compose.includes(
        `        - ${commandPath}\n        - ${service}\n`,
      ),
    );
  }

  assert.match(
    files.releaseWorkflow,
    /INSIDE_RELEASE_VERSION=\$\{\{ needs\.plan\.outputs\.version \}\}/u,
  );
  assert.match(
    files.releaseWorkflow,
    /INSIDE_SOURCE_SHA=\$\{\{ needs\.plan\.outputs\.source_sha \}\}/u,
  );

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
    const route = new RegExp(
      `@${name} \\{\\n\\t\\t\\tmethod POST\\n\\t\\t\\tpath ${escapeRegExp(path)}\\n\\t\\t\\}\\n\\t\\treverse_proxy @${name} \\{\\$PLATFORM_API_UPSTREAM:127\\.0\\.0\\.1:13001\\}`,
      "u",
    );
    if (!route.test(files.caddy))
      throw new Error(`${name} must publish only exact POST callbacks`);
  }
  if (
    /path \/internal\/\*|path \/billing\/\*|subscription-activation\/\*/u.test(
      files.caddy,
    )
  ) {
    throw new Error(
      "payment and Telegram routes must publish only exact POST callbacks",
    );
  }
  if (
    !/@unknown_integration path \/integrations\/\*\n\t\trespond @unknown_integration 404/u.test(
      files.caddy,
    )
  ) {
    throw new Error("unknown integration routes must fail closed");
  }
  assert.match(
    files.caddy,
    /@private_health path \/health \/health\/\* \/_health\/\*/u,
  );
  // The operator table is checked last, so a broken Caddy rule above reports its own reason first.
  assert.deepEqual(
    runbookRoutes(files.releaseRunbook),
    caddyProxiedRoutes(files.caddy),
    "docs/runbooks/production-release.md must list exactly the Caddy API and MCP routes",
  );
}

/**
 * Every method and path that Caddy proxies to the API or MCP; `ANY` when the matcher has no method.
 * A matcher in any other shape fails instead of silently disappearing from both sides of the check.
 */
function caddyProxiedRoutes(caddy) {
  const proxied = new Set(
    [
      ...caddy.matchAll(
        /reverse_proxy @([a-z_]+) \{\$PLATFORM_(?:API|MCP)_UPSTREAM:/gu,
      ),
    ].map(([, name]) => name),
  );
  const routes = [];
  const understood = new Set();
  for (const [, name, method, paths] of caddy.matchAll(
    /@([a-z_]+) \{\n\t+method ([A-Z]+)\n\t+path ([^\n]+)\n\t+\}/gu,
  )) {
    if (!proxied.has(name)) continue;
    understood.add(name);
    routes.push(...paths.split(" ").map((path) => `${method} ${path}`));
  }
  for (const [, name, paths] of caddy.matchAll(/@([a-z_]+) path ([^\n]+)/gu)) {
    if (!proxied.has(name)) continue;
    understood.add(name);
    routes.push(...paths.split(" ").map((path) => `ANY ${path}`));
  }
  // Every reverse_proxy except the single web fallback must go through a named matcher parsed above.
  const directives = caddy.match(/^\s*reverse_proxy /gmu)?.length ?? 0;
  const unparsed = [...proxied].filter((name) => !understood.has(name));
  if (unparsed.length > 0 || directives !== proxied.size + 1) {
    throw new Error(
      `Caddy API routes are not in a form the runbook route check understands: ${unparsed.join(", ") || "reverse_proxy without a named matcher"}`,
    );
  }
  return routes.sort();
}

/** Rows of the release runbook's public API route table as `METHOD path`; «любой» means any method. */
function runbookRoutes(runbook) {
  const section =
    runbook.split("\n## Public API routes\n")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| (POST|любой) \| `([^`]+)` \|/gmu)]
    .map(([, method, path]) => `${method === "любой" ? "ANY" : method} ${path}`)
    .sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
