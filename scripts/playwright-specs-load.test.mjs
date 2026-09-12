import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));

/**
 * Набор, который нельзя загрузить, не проверяет ничего, а сказать об этом некому: сквозные наборы
 * в обязательный гейт не входят, поэтому сломанный импорт в общем модуле однажды дошёл до main и
 * оставил без сетки шесть спеков — ноль тестов из ноля файлов. Перечисление стоит доли секунды и
 * ловит ровно это, не запуская ни стенда, ни браузера.
 */
const configurations = readdirSync(webRoot)
  .filter((entry) => entry.startsWith("playwright") && entry.endsWith(".config.ts"))
  .sort();

test("every Playwright configuration names at least one spec it can load", () => {
  assert.ok(configurations.length > 0, "no Playwright configuration found");
  for (const configuration of configurations) {
    const result = spawnSync(
      "pnpm",
      ["exec", "playwright", "test", "--config", path.join(webRoot, configuration), "--list"],
      { cwd: webRoot, encoding: "utf8" },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    // Набор, который сам объявил недостающее окружение, загрузился: он разобран, импортирован и
    // отказался осознанно. Это его собственный контракт, а не поломка загрузки, которую мы ловим.
    if (/Error: [A-Z_]+ is required/u.test(output)) continue;
    assert.equal(result.status, 0, `${configuration} could not list its tests:\n${output}`);
    const total = /Total: (\d+) tests? in (\d+) files?/u.exec(output);
    assert.ok(total !== null, `${configuration} printed no test total:\n${output}`);
    assert.notEqual(total[1], "0", `${configuration} loaded no tests:\n${output}`);
  }
});
