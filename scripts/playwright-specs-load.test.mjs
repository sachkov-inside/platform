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

test("every Playwright configuration names at least one spec it can load", () => {
  assert.ok(configurations.length > 0, "no Playwright configuration found");
  for (const configuration of configurations) {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        path.join(webRoot, configuration),
        "--list",
      ],
      { cwd: webRoot, encoding: "utf8" },
    );
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
 * Автоповтор прячет нестабильный тест: прошедший со второй попытки прогон зелёный, и причина остаётся
 * в коде. Решение владельца 27.09.2026 (#476) — повтора нет ни в одном наборе, в CI тоже, поэтому
 * конфигурация читается так, как её видит Playwright под `CI=1`.
 */
test("no Playwright configuration retries a failed test, in CI either", () => {
  for (const configuration of configurations) {
    // Без pnpm: его служебные строки в stdout ломают JSON отчёта.
    const result = spawnSync(
      process.execPath,
      [
        playwrightCli,
        "test",
        "--config",
        path.join(webRoot, configuration),
        "--list",
        "--reporter=json",
      ],
      { cwd: webRoot, encoding: "utf8", env: { ...process.env, CI: "1" } },
    );
    const report =
      /** @type {{ config: { projects: { name: string, retries: number }[] } }} */ (
        JSON.parse(result.stdout)
      );
    for (const project of report.config.projects) {
      assert.equal(
        project.retries,
        0,
        `${configuration} retries project ${project.name}`,
      );
    }
  }
});
