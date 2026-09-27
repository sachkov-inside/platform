// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testRoots = ["apps/web/test", "apps/backend/test"];

/** Единственное разрешённое окно тишины: исключение из «Waiting in tests» (#758). */
const allowedQuietWindow = {
  file: "apps/web/test/navigation/instant-navigation.spec.ts",
  helper: "viewportPrefetchDrained",
};

/**
 * Ожидания, которые заканчиваются окном тишины сети, а не фактом, кроме разрешённого помощника.
 *
 * @param {ReadonlyMap<string, string>} sources путь относительно корня → текст файла
 * @returns {string[]}
 */
function quietWindowViolations(sources) {
  /** @type {string[]} */
  const violations = [];
  for (const [file, text] of sources) {
    const lines = text.split("\n");
    /** @type {string | undefined} */
    let enclosing;
    lines.forEach((line, index) => {
      const declared = /^(?:export )?(?:async )?function (\w+)/u.exec(line);
      if (declared !== null) enclosing = declared[1];
      else if (/^\S/u.test(line)) enclosing = undefined;
      if (!line.includes("networkidle")) return;
      if (
        file === allowedQuietWindow.file &&
        enclosing === allowedQuietWindow.helper
      )
        return;
      violations.push(`${file}:${String(index + 1)}`);
    });
  }
  return violations;
}

/** @param {string} directory */
function testSources(directory) {
  /** @type {Map<string, string>} */
  const sources = new Map();
  const visit = (/** @type {string} */ relative) => {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:ts|tsx|mts|mjs)$/u.test(entry.name))
        sources.set(child, readFileSync(path.join(root, child), "utf8"));
    }
  };
  visit(directory);
  return sources;
}

test("a quiet network window is refused outside the one allowed helper", () => {
  const helper = `async function ${allowedQuietWindow.helper}(page) {\n  await page.waitForLoadState("networkidle");\n}\n`;
  assert.deepEqual(
    quietWindowViolations(new Map([[allowedQuietWindow.file, helper]])),
    [],
  );
  assert.deepEqual(
    quietWindowViolations(
      new Map([
        [
          allowedQuietWindow.file,
          `${helper}\ntest("x", async ({ page }) => {\n  await page.waitForLoadState("networkidle");\n});\n`,
        ],
        ["apps/web/test/e2e/other.spec.ts", helper],
      ]),
    ),
    [`${allowedQuietWindow.file}:6`, "apps/web/test/e2e/other.spec.ts:2"],
  );
});

test("repository tests wait for networkidle only in the allowed helper", () => {
  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const directory of testRoots)
    for (const [file, text] of testSources(directory)) sources.set(file, text);
  assert.ok(
    sources.get(allowedQuietWindow.file)?.includes("networkidle"),
    "the allowed quiet window moved; update the exception in CODING_STANDARDS.md",
  );
  assert.deepEqual(quietWindowViolations(sources), []);
});
