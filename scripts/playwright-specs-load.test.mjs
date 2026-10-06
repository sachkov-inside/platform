// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

/** Часть JSON-отчёта Playwright, которую читает проверка повтора. */
const listReportSchema = z.object({
  config: z.object({
    projects: z.array(z.object({ name: z.string(), retries: z.number() })),
  }),
});

const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));
const playwrightCli = path.join(
  webRoot,
  "node_modules/@playwright/test/cli.js",
);
const unconfiguredEnvironment = { ...process.env };
for (const name of [
  "WEB_BASE_URL",
  "BACKEND_BASE_URL",
  "LOGTO_ENDPOINT",
  "IDENTITY_PROOF_MAILPIT_PORT",
]) {
  delete unconfiguredEnvironment[name];
}

/**
 * Набор, который нельзя загрузить, не проверяет ничего, а сказать об этом некому: сквозные наборы
 * в обязательный гейт не входят, поэтому сломанный импорт в общем модуле однажды дошёл до main и
 * оставил без сетки шесть спеков — ноль тестов из ноля файлов. Перечисление стоит доли секунды и
 * ловит ровно это, не запуская ни стенда, ни браузера.
 */
const configurations = readdirSync(webRoot)
  .filter(
    (entry) => entry.startsWith("playwright") && entry.endsWith(".config.ts"),
  )
  .sort();

/**
 * Playwright вызывается напрямую, без pnpm: служебные строки
 * pnpm в stdout ломают JSON-отчёт.
 *
 * @param {string} configuration
 * @param {readonly string[]} options
 * @param {NodeJS.ProcessEnv} [environment]
 */
function runPlaywright(
  configuration,
  options,
  environment = unconfiguredEnvironment,
) {
  return spawnSync(
    process.execPath,
    [
      playwrightCli,
      "test",
      "--config",
      path.join(webRoot, configuration),
      ...options,
    ],
    { cwd: webRoot, encoding: "utf8", env: environment },
  );
}

test("every Playwright configuration names at least one spec it can load", () => {
  assert.ok(configurations.length > 0, "no Playwright configuration found");
  for (const configuration of configurations) {
    const result = runPlaywright(configuration, ["--list"]);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(
      result.status,
      0,
      `${configuration} could not list its tests:\n${output}`,
    );
    const total = /Total: (\d+) tests? in (\d+) files?/u.exec(output);
    assert.ok(
      total !== null,
      `${configuration} printed no test total:\n${output}`,
    );
    assert.notEqual(
      total[1],
      "0",
      `${configuration} loaded no tests:\n${output}`,
    );
  }
});

/**
 * Исполняемая часть правила о повторе из «Waiting in tests» в корневом `CODING_STANDARDS.md` (#476).
 * Конфигурация читается так, как её видит Playwright под `CI=1`.
 */
test("no Playwright configuration retries a failed test, in CI either", () => {
  for (const configuration of configurations) {
    const result = runPlaywright(configuration, ["--list", "--reporter=json"], {
      ...unconfiguredEnvironment,
      CI: "1",
    });
    assert.equal(
      result.status,
      0,
      `${configuration} could not list its tests:\n${result.stdout}${result.stderr}`,
    );
    /** @type {unknown} */
    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      assert.fail(
        `${configuration} printed no JSON report:\n${result.stdout}${result.stderr}`,
      );
    }
    const report = listReportSchema.parse(output);
    for (const project of report.config.projects) {
      assert.equal(
        project.retries,
        0,
        `${configuration} retries project ${project.name}`,
      );
    }
  }
});

test("identity scenarios name each missing setting at execution, before using the stand", () => {
  /** @type {readonly [string, string, readonly string[]][]} */
  const scenarios = [
    [
      "identity-proof.spec.ts",
      "prints immutable runtime lineage without credentials",
      [
        "WEB_BASE_URL",
        "BACKEND_BASE_URL",
        "LOGTO_ENDPOINT",
        "IDENTITY_PROOF_MAILPIT_PORT",
      ],
    ],
    [
      "telegram-sign-in.spec.ts",
      "Telegram sign-in, logout and fresh repeat use the real Logto session",
      ["WEB_BASE_URL", "LOGTO_ENDPOINT"],
    ],
  ];
  for (const [spec, title, names] of scenarios) {
    for (const name of names) {
      for (const missing of [undefined, ""]) {
        const result = runPlaywright(
          "playwright.identity.config.ts",
          [spec, "--grep", title, "--reporter=list"],
          {
            ...unconfiguredEnvironment,
            WEB_BASE_URL: "http://127.0.0.1:1",
            BACKEND_BASE_URL: "http://127.0.0.1:1",
            LOGTO_ENDPOINT: "http://127.0.0.1:1",
            IDENTITY_PROOF_MAILPIT_PORT: "1",
            [name]: missing,
          },
        );
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        const context = `${spec}, ${name}=${String(missing)}:\n${output}`;
        assert.equal(result.status, 1, context);
        assert.match(output, /Running 1 test/u, context);
        assert.ok(output.includes(`Error: ${name} is required`), context);
        assert.match(output, /1 failed/u, context);
      }
    }
  }
});
