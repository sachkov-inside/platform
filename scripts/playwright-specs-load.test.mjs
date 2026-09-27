// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));
const playwrightCli = path.join(
  webRoot,
  "node_modules/@playwright/test/cli.js",
);

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
 * Список тестов конфигурации без запуска. Playwright вызывается напрямую, без pnpm: служебные строки
 * pnpm в stdout ломают JSON-отчёт.
 *
 * @param {string} configuration
 * @param {readonly string[]} options
 * @param {NodeJS.ProcessEnv} [environment]
 */
function listTests(configuration, options, environment = process.env) {
  return spawnSync(
    process.execPath,
    [
      playwrightCli,
      "test",
      "--config",
      path.join(webRoot, configuration),
      "--list",
      ...options,
    ],
    { cwd: webRoot, encoding: "utf8", env: environment },
  );
}

test("every Playwright configuration names at least one spec it can load", () => {
  assert.ok(configurations.length > 0, "no Playwright configuration found");
  for (const configuration of configurations) {
    const result = listTests(configuration, []);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    // Набор, который сам объявил недостающее окружение, загрузился: он разобран, импортирован и
    // отказался осознанно. Это его собственный контракт, а не поломка загрузки, которую мы ловим.
    if (/Error: [A-Z_]+ is required/u.test(output)) continue;
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
    const result = listTests(configuration, ["--reporter=json"], {
      ...process.env,
      CI: "1",
    });
    // Набор, отказавшийся от недостающего окружения, всё равно печатает отчёт с конфигурацией.
    /** @type {{ config: { projects: { name: string, retries: number }[] } }} */
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      assert.fail(
        `${configuration} printed no JSON report:\n${result.stdout}${result.stderr}`,
      );
    }
    for (const project of report.config.projects) {
      assert.equal(
        project.retries,
        0,
        `${configuration} retries project ${project.name}`,
      );
    }
  }
});
