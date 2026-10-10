// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
/** Тесты приложений и браузерные сценарии в `scripts/`, где Playwright ждёт страницу. */
const scannedRoots = ["apps/web/test", "apps/backend/test", "scripts"];
const scannedFile = /\.(?:[cm]?[jt]s|tsx)$/u;
const quietWindow = /["'`]networkidle["'`]/gu;
const thisCheck = "scripts/quiet-window-waits.test.mjs";

/**
 * Ожидания окна тишины сети: файл и число таких ожиданий.
 *
 * @param {ReadonlyMap<string, string>} sources путь относительно корня → текст файла
 * @returns {string[]}
 */
function quietWindowViolations(sources) {
  /** @type {string[]} */
  const violations = [];
  for (const [file, text] of sources) {
    const found = text.match(quietWindow)?.length ?? 0;
    if (found > 0) violations.push(`${file}: ${String(found)}`);
  }
  return violations;
}

/** @returns {Map<string, string>} */
function scannedSources() {
  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const directory of scannedRoots)
    for (const entry of readdirSync(path.join(root, directory), {
      encoding: "utf8",
      recursive: true,
    })) {
      const file = path.posix.join(directory, entry.split(path.sep).join("/"));
      if (!scannedFile.test(file) || file === thisCheck) continue;
      if (file.includes("/node_modules/")) continue;
      sources.set(file, readFileSync(path.join(root, file), "utf8"));
    }
  return sources;
}

test("a quiet network window is refused even in the former allowed helper", () => {
  const helper = [
    "/** Упоминание networkidle в комментарии не ожидание. */",
    "async function viewportPrefetchDrained(",
    "  page: Page,",
    "): Promise<void> {",
    '  await page.waitForLoadState("networkidle");',
    "}",
  ].join("\n");
  assert.deepEqual(
    quietWindowViolations(
      new Map([
        ["apps/web/test/navigation/instant-navigation.spec.ts", helper],
      ]),
    ),
    ["apps/web/test/navigation/instant-navigation.spec.ts: 1"],
  );
  const elsewhere = 'await page.waitForLoadState("networkidle");';
  assert.deepEqual(
    quietWindowViolations(
      new Map([
        [
          "apps/web/test/navigation/instant-navigation.spec.ts",
          `${helper}\n\n${elsewhere}\n`,
        ],
        ["scripts/browser-smoke.mjs", elsewhere],
      ]),
    ),
    [
      "apps/web/test/navigation/instant-navigation.spec.ts: 2",
      "scripts/browser-smoke.mjs: 1",
    ],
  );
});

test("repository tests and browser scripts never wait for networkidle", () => {
  assert.deepEqual(quietWindowViolations(scannedSources()), []);
});
