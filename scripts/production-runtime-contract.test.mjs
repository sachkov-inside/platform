// @ts-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { z } from "zod";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const productionTemplates = readdirSync(
  resolve(repositoryRoot, "config/compose/production"),
)
  .map((name) => read(`config/compose/production/${name}`))
  .join("\n");

// The activation protocol has exactly these operations; a prefix would expose any future sub-route.
const activationPaths = [
  ...["binding", "own-access", "attempts", "evidence"].map(
    (operation) =>
      `/integrations/telegram/v1/subscription-activation/${operation}`,
  ),
  "/integrations/telegram/v1/invitations/redeem",
].join(" ");
// The bank, Tribute and Telegram call exactly these API routes; each Caddy matcher allows one method.
/** @type {[string, string, string][]} */
const callbackRoutes = [
  ["tbank_notification", "POST", "/billing/tbank/notification"],
  ["billing_cohorts", "GET", "/billing/cohorts"],
  ["tribute_webhook", "POST", "/integrations/tribute/v1/webhook"],
  ["telegram_activation", "POST", activationPaths],
  ["community_dispatch", "POST", "/internal/billing-dispatch/authorize"],
  [
    "notification_dispatch",
    "POST",
    "/internal/notifications/dispatch/authorize",
  ],
  [
    "communications_authorize",
    "POST",
    "/integrations/telegram/v1/communications/authorize",
  ],
  [
    "communications_validate",
    "POST",
    "/integrations/telegram/v1/communications/validate-content",
  ],
];

// Both MCP adapters and their discovery documents have exact routes to the MCP process.
/** @type {[string, string][]} */
const mcpRoutes = [
  ["mcp", "/mcp"],
  ["mcp_metadata", "/.well-known/oauth-protected-resource/mcp"],
  ["learning_mcp", "/mcp/learning"],
  [
    "learning_mcp_metadata",
    "/.well-known/oauth-protected-resource/mcp/learning",
  ],
];

// Every API operation under these prefixes is called from outside the host, so Caddy must publish it.
const externalPrefix = /^\/(?:integrations|internal)\//u;
const httpMethods = new Set(["get", "put", "post", "delete", "head", "patch"]);
// External callers also use these API operations outside the integration prefixes.
const externalPublicRoutes = new Map([
  ["POST /billing/tbank/notification", "the bank's payment notification"],
  ["GET /billing/cohorts", "the Telegram bot reads the cohort start date"],
]);
// Integration operations that stay unpublished on purpose; the production smoke expects 404 for them.
const unpublishedIntegrationRoutes = new Map([
  [
    "POST /integrations/telegram/v1/sign-in/complete",
    "only the web BFF calls it over the loopback upstream",
  ],
]);

const runtime = {
  releaseRunbook: read("docs/runbooks/production-release.md"),
  openApi: read("apps/backend/openapi/platform-api.json"),
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

  it("publishes each payment and Telegram route as one exact single-method route", () => {
    for (const [name, method, path] of callbackRoutes) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              `path ${path}\n`,
              "path /internal/*\n",
            ),
          }),
        /must publish only its exact method and path/u,
        `${name} must not widen to a prefix`,
      );
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              new RegExp(`(@${name} \\{\\s+)method ${method}`, "u"),
              "$1method GET POST",
            ),
          }),
        /must publish only its exact method and path/u,
        `${name} must stay ${method}-only`,
      );
    }
  });

  it("publishes every API route that external callers use", () => {
    const unpublished = /platform\.caddy does not publish external API route/u;
    for (const route of [
      " /integrations/telegram/v1/invitations/redeem",
      " /integrations/telegram/v1/subscription-activation/binding",
    ]) {
      assert.throws(
        () =>
          assertExternalRoutesPublished({
            ...runtime,
            caddy: runtime.caddy.replace(route, ""),
          }),
        unpublished,
        route,
      );
    }
    assert.throws(
      () =>
        assertExternalRoutesPublished({
          ...runtime,
          caddy: runtime.caddy.replace(
            /\t\t@billing_cohorts \{[^}]+\}\n\t\treverse_proxy @billing_cohorts [^\n]+\n/u,
            "",
          ),
        }),
      unpublished,
      "a public route that the bot calls",
    );
    assert.throws(
      () =>
        assertExternalRoutesPublished({
          ...runtime,
          openApi: withPaths(runtime.openApi, (paths) => {
            paths["/integrations/example/v1/callback"] = { post: {} };
          }),
        }),
      unpublished,
      "a new integration controller",
    );
  });

  it("rejects an API route that Caddy declares after the fail-closed integration 404", () => {
    const redeem = " /integrations/telegram/v1/invitations/redeem";
    assert.throws(
      () =>
        assertExternalRoutesPublished({
          ...runtime,
          caddy: runtime.caddy
            .replace(redeem, "")
            .replace(
              "\t\trespond @unknown_integration 404\n",
              `\t\trespond @unknown_integration 404\n\n\t\t@late_redeem {\n\t\t\tmethod POST\n\t\t\tpath${redeem}\n\t\t}\n\t\treverse_proxy @late_redeem {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n`,
            ),
        }),
      /late_redeem must come before the fail-closed integration 404/u,
    );
  });

  it("rejects an external route exception that no longer matches the API or Caddy", () => {
    assert.throws(
      () =>
        assertExternalRoutesPublished({
          ...runtime,
          caddy: runtime.caddy.replace(
            "path /integrations/telegram/v1/sign-in/linked-identity\n",
            "path /integrations/telegram/v1/sign-in/linked-identity /integrations/telegram/v1/sign-in/complete\n",
          ),
        }),
      /listed as unpublished, but platform\.caddy publishes it/u,
      "a published exception",
    );
    assert.throws(
      () =>
        assertExternalRoutesPublished({
          ...runtime,
          openApi: withPaths(runtime.openApi, (paths) => {
            delete paths["/integrations/telegram/v1/sign-in/complete"];
          }),
        }),
      /the API no longer declares/u,
      "a stale exception",
    );
  });

  it("publishes the authoring transfer only for backend /authoring/* behind its prefix", () => {
    /** @type {[string, string][]} */
    const variants = [
      [
        "without removing the prefix",
        "\t\t@authoring_api path /authoring-api/authoring/*\n\t\treverse_proxy @authoring_api {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n",
      ],
      [
        "wider than /authoring/*",
        "\t\t@authoring_api path /authoring-api/*\n\t\turi @authoring_api strip_prefix /authoring-api\n\t\treverse_proxy @authoring_api {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}\n",
      ],
    ];
    for (const [shape, replacement] of variants) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              /\t\t@authoring_api path [^\n]+\n(?:\t\turi [^\n]+\n)?\t\treverse_proxy @authoring_api [^\n]+\n/u,
              replacement,
            ),
          }),
        /only backend \/authoring\/\*/u,
        shape,
      );
    }
  });

  it("routes the exact authoring and learner MCP endpoints and discovery to the MCP process", () => {
    for (const [name, path] of mcpRoutes) {
      const route = mcpRoute(name, path);
      for (const replacement of [
        "",
        route.replace(`path ${path}`, "path /mcp/*"),
        route.replace(
          "{$PLATFORM_MCP_UPSTREAM:127.0.0.1:13002}",
          "{$PLATFORM_API_UPSTREAM:127.0.0.1:13001}",
        ),
      ]) {
        assert.throws(
          () =>
            assertRuntimeContract({
              ...runtime,
              caddy: runtime.caddy.replace(route, replacement),
            }),
          new RegExp(
            `\\b${name}: MCP routes must publish exact endpoints to the MCP upstream`,
            "u",
          ),
          name,
        );
      }
    }
  });

  it("rejects additional MCP routes even when the runbook lists them", () => {
    for (const path of [
      "/mcp/*",
      "/mcp/unreviewed",
      "/.well-known/oauth-protected-resource/mcp/*",
    ]) {
      assert.throws(
        () =>
          assertRuntimeContract({
            ...runtime,
            caddy: runtime.caddy.replace(
              "\t\t@learning_mcp path",
              `\t\t${mcpRoute("additional_mcp", path)}\n\n\t\t@learning_mcp path`,
            ),
            releaseRunbook: runtime.releaseRunbook.replace(
              "| любой | `/mcp/learning` |",
              `| любой | \`${path}\` | additional MCP route |\n| любой | \`/mcp/learning\` |`,
            ),
          }),
        /MCP upstream must expose only the reviewed exact routes/u,
        path,
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
    /** @type {[string, RegExp][]} */
    const removals = [
      ["\n  cap_drop: [ALL]\n", /backend processes must drop capabilities/u],
      ["\n  read_only: true\n", /backend processes must drop capabilities/u],
      [
        "\n    cap_drop: [ALL]\n    mem_limit: 512m\n",
        /web must drop capabilities/u,
      ],
    ];
    for (const [removed, reason] of removals) {
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
    for (const key of /** @type {const} */ (["caddy", "hostCaddy"])) {
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
    for (const key of /** @type {const} */ (["caddy", "maintenanceCaddy"])) {
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

/** @param {typeof runtime} files */
function assertRuntimeContract(files) {
  if (/^\s+build:/mu.test(files.compose)) {
    throw new Error("production runtime must not build application source");
  }
  // Двойник банка и перехватчик писем принадлежат стенду: production не запускает их и не
  // объявляет их адреса даже в шаблонах.
  const standOnly =
    /bank-double|mailpit|TBANK_PROVIDER_MODE\s*[:=]\s*["']?test|TBANK_TEST_|BILLING_CONTACT_SMTP_LOCAL_CAPTURE/u;
  for (const [name, contents] of /** @type {const} */ ([
    ["runtime Compose", files.compose],
    ["environment templates", files.productionTemplates],
  ])) {
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
  for (const [name, caddy] of /** @type {const} */ ([
    ["platform.caddy", files.caddy],
    ["maintenance.caddy", files.maintenanceCaddy],
  ])) {
    if (
      !/^\theader Strict-Transport-Security "max-age=31536000; includeSubDomains"$/mu.test(
        caddy,
      )
    ) {
      throw new Error(`${name} must send HSTS`);
    }
  }
  // Web считает запросы по X-Forwarded-For только потому, что Caddy не доверяет входящему заголовку.
  for (const [name, caddy] of /** @type {const} */ ([
    ["platform.caddy", files.caddy],
    ["host Caddyfile", files.hostCaddy],
  ])) {
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
  ]) {
    assert.match(files.caddy, new RegExp(`path ${escapeRegExp(path)}$`, "mu"));
  }
  for (const [name, path] of mcpRoutes) {
    if (!files.caddy.includes(mcpRoute(name, path))) {
      throw new Error(
        `${name}: MCP routes must publish exact endpoints to the MCP upstream`,
      );
    }
  }
  assert.deepEqual(
    [
      ...files.caddy.matchAll(
        /reverse_proxy @([a-z_]+) \{\$PLATFORM_MCP_UPSTREAM:/gu,
      ),
    ]
      .map(([, name]) => name)
      .sort(),
    mcpRoutes.map(([name]) => name).sort(),
    "MCP upstream must expose only the reviewed exact routes",
  );
  assert.match(
    files.caddy,
    /@telegram_sign_in \{\s+method POST\s+path \/integrations\/telegram\/v1\/sign-in\/linked-identity\s+\}/u,
    "Logto linked-identity callback must allow only POST",
  );
  // Банк, Tribute и Telegram вызывают ровно эти адреса; каждый адрес защищён своим credential в API.
  for (const [name, method, path] of callbackRoutes) {
    const route = new RegExp(
      `@${name} \\{\\n\\t\\t\\tmethod ${method}\\n\\t\\t\\tpath ${escapeRegExp(path)}\\n\\t\\t\\}\\n\\t\\treverse_proxy @${name} \\{\\$PLATFORM_API_UPSTREAM:127\\.0\\.0\\.1:13001\\}`,
      "u",
    );
    if (!route.test(files.caddy))
      throw new Error(`${name} must publish only its exact method and path`);
  }
  if (
    /path \/internal\/\*|path \/billing\/\*|subscription-activation\/\*/u.test(
      files.caddy,
    )
  ) {
    throw new Error(
      "payment and Telegram routes: each must publish only its exact method and path",
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
  // The authoring transfer reaches only backend /authoring/*: its prefix is removed before the API.
  if (
    !/@authoring_api path \/authoring-api\/authoring\/\*\n\t\turi @authoring_api strip_prefix \/authoring-api\n\t\treverse_proxy @authoring_api \{\$PLATFORM_API_UPSTREAM:127\.0\.0\.1:13001\}/u.test(
      files.caddy,
    )
  ) {
    throw new Error(
      "the authoring API must publish only backend /authoring/* behind its removed prefix",
    );
  }
  // Published routes and the operator table are checked last, so a broken Caddy rule above reports
  // its own reason first.
  assertExternalRoutesPublished(files);
  assert.deepEqual(
    runbookRoutes(files.releaseRunbook),
    caddyProxiedRoutes(files.caddy),
    "docs/runbooks/production-release.md must list exactly the Caddy API and MCP routes",
  );
}

/**
 * Every operation that the API declares under the integration prefixes, and every listed public
 * operation, reaches the API through Caddy. An exception names its reason and must stay accurate.
 */
/** @param {Pick<typeof runtime, "caddy" | "openApi">} files */
function assertExternalRoutesPublished(files) {
  const declared = Object.entries(openApiPaths(files.openApi)).flatMap(
    ([path, operations]) =>
      Object.keys(operations)
        .filter((method) => httpMethods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
  );
  const published = new Set(caddyProxiedRoutes(files.caddy));
  // Caddy runs the route block in order: after the fail-closed 404 no /integrations/* matcher reaches
  // the API, so every API and MCP matcher stays above it.
  const failClosed = files.caddy.indexOf("respond @unknown_integration 404");
  if (failClosed === -1) {
    throw new Error("unknown integration routes must fail closed");
  }
  const late = [...files.caddy.matchAll(/reverse_proxy @([a-z_]+) /gu)].filter(
    ({ index }) => index > failClosed,
  );
  if (late.length > 0) {
    throw new Error(
      `${late.map(([, name]) => name).join(", ")} must come before the fail-closed integration 404 in platform.caddy`,
    );
  }
  /** @param {string} route */
  const isPublished = (route) =>
    published.has(route) || published.has(`ANY ${route.split(" ")[1]}`);
  for (const route of [
    ...externalPublicRoutes.keys(),
    ...unpublishedIntegrationRoutes.keys(),
  ]) {
    if (!declared.includes(route)) {
      throw new Error(
        `${route} is listed as an external route exception, but the API no longer declares it`,
      );
    }
  }
  for (const [route, reason] of unpublishedIntegrationRoutes) {
    if (isPublished(route)) {
      throw new Error(
        `${route} is listed as unpublished, but platform.caddy publishes it (${reason})`,
      );
    }
  }
  const external = declared.filter(
    (route) =>
      externalPublicRoutes.has(route) ||
      (externalPrefix.test(route.split(" ")[1] ?? "") &&
        !unpublishedIntegrationRoutes.has(route)),
  );
  const missing = external.filter((route) => !isPublished(route));
  if (missing.length > 0) {
    throw new Error(
      `platform.caddy does not publish external API route ${missing.join(", ")}; publish it or list it as unpublished with a reason`,
    );
  }
}

const openApiDocumentSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
/** @typedef {z.infer<typeof openApiDocumentSchema>["paths"]} OpenApiPaths */

/** Operations of the committed OpenAPI document, which `pnpm api:check` keeps equal to the controllers. */
/** @param {string} openApi @returns {OpenApiPaths} */
function openApiPaths(openApi) {
  return openApiDocumentSchema.parse(JSON.parse(openApi)).paths;
}

/** OpenAPI document after `change`, as a changed set of controllers would declare it. */
/** @param {string} openApi @param {(paths: OpenApiPaths) => void} change */
function withPaths(openApi, change) {
  const paths = openApiPaths(openApi);
  change(paths);
  return JSON.stringify({ paths });
}

/**
 * Every method and path that Caddy proxies to the API or MCP; `ANY` when the matcher has no method.
 * A matcher in any other shape fails instead of silently disappearing from both sides of the check.
 */
/** @param {string} caddy */
function caddyProxiedRoutes(caddy) {
  const proxied = new Set(
    [
      ...caddy.matchAll(
        /reverse_proxy @([a-z_]+) \{\$PLATFORM_(?:API|MCP)_UPSTREAM:/gu,
      ),
    ].map(([, name = ""]) => name),
  );
  /** @type {string[]} */
  const routes = [];
  /** @type {Set<string>} */
  const understood = new Set();
  for (const [, name = "", method = "", paths = ""] of caddy.matchAll(
    /@([a-z_]+) \{\n\t+method ([A-Z]+)\n\t+path ([^\n]+)\n\t+\}/gu,
  )) {
    if (!proxied.has(name)) continue;
    understood.add(name);
    routes.push(...paths.split(" ").map((path) => `${method} ${path}`));
  }
  for (const [, name = "", paths = ""] of caddy.matchAll(
    /@([a-z_]+) path ([^\n]+)/gu,
  )) {
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
/** @param {string} runbook */
function runbookRoutes(runbook) {
  const section =
    runbook.split("\n## Public API routes\n")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| (GET|POST|любой) \| `([^`]+)` \|/gmu)]
    .map(([, method, path]) => `${method === "любой" ? "ANY" : method} ${path}`)
    .sort();
}

/** Exact Caddy route from a named path matcher to the MCP process. */
/** @param {string} name @param {string} path */
function mcpRoute(name, path) {
  return `@${name} path ${path}\n\t\treverse_proxy @${name} {$PLATFORM_MCP_UPSTREAM:127.0.0.1:13002}`;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
