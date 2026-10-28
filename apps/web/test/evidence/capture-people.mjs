// @ts-check
/// <reference lib="dom" />
/** Production-owned Storybook evidence for the people list, person card and access dialogs (#1721). Run after pnpm build:storybook. */
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
const directory = await prepareEvidenceDirectory("issue-1721");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const card = "pages-authoring-карточка-человека";
const people = "pages-authoring-люди";
const dialogs = "components-админка-действия-с-доступом";
/**
 * Story, the text that proves its `play` reached the shown state, the region Axe scans and whether
 * an open dialog is captured as one screen instead of the whole page.
 * @type {ReadonlyArray<{id: string, file: string, text: string, scope: string, screen: boolean}>}
 */
const stories = [
  {
    id: `${people}--mobile`,
    file: "people--list",
    text: "134 человека",
    scope: "main",
    screen: false,
  },
  {
    id: `${people}--long-list`,
    file: "people--long-list",
    text: "Дальше",
    scope: "main",
    screen: false,
  },
  {
    id: `${people}--name-search-unavailable`,
    file: "people--name-search-unavailable",
    text: "Поиск по имени и @username временно недоступен",
    scope: "main",
    screen: false,
  },
  {
    id: `${people}--empty`,
    file: "people--empty",
    text: "Людей пока нет",
    scope: "main",
    screen: false,
  },
  {
    id: `${card}--all-blocks`,
    file: "card--all-blocks",
    text: "Поток весна 2027",
    scope: "main",
    screen: false,
  },
  {
    id: `${card}--unavailable-blocks`,
    file: "card--unavailable-blocks",
    text: "Сдачи видит аккаунт с правом управлять материалами.",
    scope: "main",
    screen: false,
  },
  {
    id: `${card}--revoke-product-mobile`,
    file: "card--revoke-dialog",
    text: "Группа в Telegram останется: её даёт другой продукт человека.",
    scope: "main",
    screen: true,
  },
  {
    id: `${card}--revision-conflict-mobile`,
    file: "card--revision-conflict",
    text: "Обновить данные",
    scope: "main",
    screen: true,
  },
  {
    id: `${dialogs}--grant-active`,
    file: "dialog--grant",
    text: "Выдача ничего не изменит",
    scope: "#storybook-root",
    screen: true,
  },
  {
    id: `${dialogs}--restore`,
    file: "dialog--restore",
    text: "Причина",
    scope: "#storybook-root",
    screen: true,
  },
  {
    id: "patterns-каркас-админки--search-people-mobile",
    file: "search--people",
    text: "Анна Константинопольская-Задунайская",
    scope: "body",
    screen: true,
  },
];
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
      for (const story of stories) {
        await page.goto(
          // This script owns the awaited Axe scan; avoid racing the addon's automatic scan.
          `http://127.0.0.1:${String(address.port)}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=a11y.manual:!true`,
        );
        await expect(
          page
            .getByText(story.text, { exact: false })
            .filter({ visible: true })
            .first(),
        ).toBeVisible({ timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth !==
            document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
        const a11y = await new AxeBuilder({ page })
          .include(story.scope)
          .analyze();
        expect(a11y.violations).toEqual([]);
        const path = resolve(
          directory,
          `storybook-${story.file}-${String(width)}.png`,
        );
        if (story.screen) await page.screenshot({ path });
        else await screenshotWholePage(page, { path });
        results.push({
          story: story.id,
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
