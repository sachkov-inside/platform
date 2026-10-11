// @ts-check
/// <reference lib="dom" />
/** Production-owned Storybook evidence for #967. Run after pnpm build:storybook. */
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../storybook-static",
);
/** @type {Record<string, string>} */
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  const path = resolve(
    root,
    `.${new URL(request.url ?? "/", "http://localhost").pathname}`,
  );
  if (!path.startsWith(`${root}${sep}`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    if (!(await stat(path)).isFile()) {
      response.writeHead(404).end();
      return;
    }
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(response);
});
const directory = await prepareEvidenceDirectory("issue-967");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
/** @type {Array<{story: string, width: number, overflow: boolean, violations: string[]}>} */
const results = [];
const browser = await chromium.launch();
try {
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListening(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Storybook server has no port");
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1024 },
      reducedMotion: "reduce",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    try {
      const page = await context.newPage();
      for (const [story, text] of [
        ["report-is-text", "Отчёт агента ученика"],
        ["submissions", "Версия требований 1 (сейчас 2)"],
        [
          "feedback-saves",
          "Сохранено. Ученик увидит отзыв на странице задания.",
        ],
        ["feedback-save-fails", "Не удалось сохранить. Попробуй ещё раз."],
        [
          "expired-session",
          "Сессия закончилась. Войди на сайт в другой вкладке и повтори сохранение. Черновик здесь сохранён.",
        ],
        ["empty", "Сдач пока нет"],
        ["empty-filter", "По этому фильтру сдач нет."],
        ["loading", "Загружаем сдачи…"],
        ["forbidden", "Нет доступа к сдачам"],
        ["unauthorized", "Нужен вход"],
        ["unavailable", "Сдачи не загрузились"],
      ]) {
        if (story === undefined || text === undefined)
          throw new Error("Missing story expectation");
        await page.goto(
          `http://127.0.0.1:${String(address.port)}/iframe.html?id=pages-authoring-task-submissions--${story}&viewMode=story`,
        );
        await expect(page.getByText(text, { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth !==
            document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
        const a11y = await new AxeBuilder({ page }).include("main").analyze();
        expect(a11y.violations).toEqual([]);
        await screenshotWholePage(page, {
          path: resolve(directory, `storybook-${story}-${String(width)}.png`),
        });
        results.push({
          story,
          width,
          overflow,
          violations: a11y.violations.map((item) => item.id),
        });
      }
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(directory, "storybook-checks.json"),
    `${JSON.stringify({ sourceSha, results }, null, 2)}\n`,
  );
  console.log(
    `Captured ${String(results.length)} Storybook states: no overflow or Axe violations.`,
  );
} finally {
  await browser.close();
  await new Promise((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed(undefined))),
  );
}
