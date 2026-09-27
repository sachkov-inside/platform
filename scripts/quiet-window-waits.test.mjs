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

/** Единственное разрешённое окно тишины: исключение из «Waiting in tests» (#758). */
const allowedQuietWindow = {
  file: "apps/web/test/navigation/instant-navigation.spec.ts",
  helper: /(?:async )?function viewportPrefetchDrained\b[^{]*\{[\s\S]*?\n\}/u,
};

/**
 * Ожидания окна тишины сети вне разрешённого помощника: файл и число таких ожиданий.
 *
 * @param {ReadonlyMap<string, string>} sources путь относительно корня → текст файла
 * @returns {string[]}
 */
function quietWindowViolations(sources) {
  /** @type {string[]} */
  const violations = [];
  for (const [file, text] of sources) {
    const checked =
      file === allowedQuietWindow.file
        ? text.replace(allowedQuietWindow.helper, "")
        : text;
    const found = checked.match(quietWindow)?.length ?? 0;
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

test("a quiet network window is refused outside the one allowed helper", () => {
  const helper = [
    "/** Упоминание networkidle в комментарии не ожидание. */",
    "async function viewportPrefetchDrained(",
    "  page: Page,",
    "): Promise<void> {",
    '  await page.waitForLoadState("networkidle");',
    "}",
  ].join("\n");
  assert.deepEqual(
    quietWindowViolations(new Map([[allowedQuietWindow.file, helper]])),
    [],
  );
  const elsewhere = 'await page.waitForLoadState("networkidle");';
  assert.deepEqual(
    quietWindowViolations(
      new Map([
        [allowedQuietWindow.file, `${helper}\n\n${elsewhere}\n`],
        ["scripts/browser-smoke.mjs", elsewhere],
      ]),
    ),
    [`${allowedQuietWindow.file}: 1`, "scripts/browser-smoke.mjs: 1"],
  );
});

test("repository tests and browser scripts wait for networkidle only in the allowed helper", () => {
  const sources = scannedSources();
  const allowed = sources.get(allowedQuietWindow.file) ?? "";
  assert.match(
    allowed.match(allowedQuietWindow.helper)?.[0] ?? "",
    quietWindow,
    "the allowed quiet window moved; update the exception in CODING_STANDARDS.md",
  );
  assert.deepEqual(quietWindowViolations(sources), []);
});
