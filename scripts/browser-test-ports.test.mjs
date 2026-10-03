// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

import { reservedPortRange } from "./smoke-stand.mjs";

/**
 * Браузерные проверки `pnpm check` не держат фиксированных портов (#896): параллельная проверка
 * соседнего worktree занимала 3100, и прогон падал до первого теста.
 */
const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));
const portVariables = [
  "PLAYWRIGHT_PORT",
  "NAVIGATION_WEB_PORT",
  "FAKE_BACKEND_PORT",
];

const loadedSchema = z.object({
  baseURL: z.string(),
  servers: z.array(z.string()),
  environment: z.record(z.string(), z.string().optional()),
});

/**
 * Конфигурация так, как её загружает Playwright: модуль целиком, в своём процессе.
 *
 * @param {string} configuration
 * @param {Record<string, string>} [ports]
 */
function loadConfiguration(configuration, ports = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, ...ports };
  for (const name of portVariables) {
    if (!(name in ports)) delete environment[name];
  }
  const script = `
    const { default: configuration } = await import(process.argv[1]);
    const servers = [configuration.webServer].flat().map((server) => server.url);
    const environment = Object.fromEntries(
      ${JSON.stringify(portVariables)}.map((name) => [name, process.env[name]]),
    );
    console.log(JSON.stringify({ baseURL: configuration.use.baseURL, servers, environment }));
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--input-type=module",
      "-e",
      script,
      path.join(webRoot, configuration),
    ],
    { cwd: webRoot, encoding: "utf8", env: environment },
  );
  assert.equal(
    result.status,
    0,
    `${configuration} did not load:\n${result.stderr}`,
  );
  /** @type {unknown} */
  const output = JSON.parse(result.stdout);
  return loadedSchema.parse(output);
}

/** @param {string} address */
function portOf(address) {
  return Number(new URL(address).port);
}

/** @param {number} port */
function isReserved(port) {
  return port >= reservedPortRange.first && port <= reservedPortRange.last;
}

const configurations = [
  { file: "playwright.config.ts", variables: ["PLAYWRIGHT_PORT"] },
  {
    file: "playwright.navigation.config.ts",
    variables: ["NAVIGATION_WEB_PORT", "FAKE_BACKEND_PORT"],
  },
];

test("a check configuration without a port variable takes free reserved ports", () => {
  for (const { file, variables } of configurations) {
    const loaded = loadConfiguration(file);
    for (const address of [loaded.baseURL, ...loaded.servers]) {
      assert.ok(
        isReserved(portOf(address)),
        `${file} uses ${address} outside the reserved range`,
      );
    }
    // Worker загружает конфигурацию заново: он наследует выбранный порт из окружения.
    for (const name of variables) {
      const published = loaded.environment[name];
      assert.ok(
        published !== undefined && isReserved(Number(published)),
        `${file} does not publish ${name} for its workers`,
      );
    }
    assert.ok(
      loaded.servers.some(
        (address) => portOf(address) === portOf(loaded.baseURL),
      ),
      `${file} serves another port than its base URL`,
    );
  }
});

test("an explicit port variable keeps its port", () => {
  const e2e = loadConfiguration("playwright.config.ts", {
    PLAYWRIGHT_PORT: "31431",
  });
  assert.equal(e2e.baseURL, "http://127.0.0.1:31431");

  const navigation = loadConfiguration("playwright.navigation.config.ts", {
    NAVIGATION_WEB_PORT: "31432",
    FAKE_BACKEND_PORT: "31433",
  });
  assert.equal(navigation.baseURL, "http://127.0.0.1:31432");
  assert.ok(
    navigation.servers.includes("http://127.0.0.1:31433/__requests"),
    `navigation backend ignores FAKE_BACKEND_PORT: ${navigation.servers.join(", ")}`,
  );
});

/** @param {string} directory */
function sourceFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:m?[jt]s)$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("no browser test falls back to a fixed port", () => {
  const files = [
    ...readdirSync(webRoot)
      .filter(
        (entry) =>
          entry.startsWith("playwright") && entry.endsWith(".config.ts"),
      )
      .map((entry) => path.join(webRoot, entry)),
    ...sourceFiles(path.join(webRoot, "test")),
  ];
  const fixedFallback = /PORT"\]\s*\?\?\s*["'`]?\d/u;
  const offenders = files.filter((file) =>
    fixedFallback.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    offenders.map((file) => path.relative(webRoot, file)),
    [],
    "a port variable falls back to a fixed port",
  );
});
