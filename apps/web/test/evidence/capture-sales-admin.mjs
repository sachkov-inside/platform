// @ts-check
/// <reference lib="dom" />
/**
 * Production visual gate #1718 in Storybook: the product page tabs and the «Продажи» section at 390
 * and 1440 px. Run after `pnpm build:storybook`; `UPDATE_EVIDENCE=issue-1718` writes into
 * `docs/evidence/issue-1718`. Each story is captured after its `play` has finished, with no
 * horizontal overflow and a clean Axe scan of `#storybook-root` and of the dialogs it opened in
 * portals. A failing state does not stop the run: every state is checked, and the run fails at the
 * end listing them all.
 */
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { z } from "zod";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../storybook-static",
);

/**
 * One row of the evidence table: a story family, the export shown at 1440 px and the export shown
 * at 390 px. Paired `…Desktop`/`…Mobile` stories declare their own viewport; a story without one
 * appears in both columns. `null` leaves a column empty when the story exists for one width only.
 *
 * @type {Array<[slug: string, title: string, rows: Array<[wide: string | null, phone: string | null]>]>}
 */
const families = [
  [
    "pages-authoring-product-editor",
    "Pages/Authoring/Редактор продукта",
    [
      ["SaleTabDesktop", "SaleTabMobile"],
      ["LearnersTabDesktop", "LearnersTabMobile"],
      ["CommunityTabDesktop", "CommunityTabMobile"],
    ],
  ],
  [
    "features-product-sale",
    "Features/Product/Продажа продукта",
    [
      ["UnpricedDesktop", "UnpricedMobile"],
      ["ClosedDesktop", "ClosedMobile"],
      ["RunningDesktop", "RunningMobile"],
      ["PriceArchivedDesktop", "PriceArchivedMobile"],
      ["UnavailableDesktop", "UnavailableMobile"],
      ["ForbiddenDesktop", "ForbiddenMobile"],
    ],
  ],
  [
    "features-product-community",
    "Features/Product/Сообщество и активация",
    [
      ["RulesDesktop", "RulesMobile"],
      ["EmptyDesktop", "EmptyMobile"],
      ["UnavailableDesktop", "UnavailableMobile"],
    ],
  ],
  [
    "pages-authoring-product-learners",
    "Pages/Authoring/Продукт/Ученики",
    [
      ["OneLearnerDesktop", "OneLearnerMobile"],
      ["LongListDesktop", "LongListMobile"],
      ["EmptyDesktop", "EmptyMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["ErrorDesktop", "ErrorMobile"],
    ],
  ],
  [
    "pages-authoring-product-grant",
    "Pages/Authoring/Продукт/Выдать продукт",
    [
      ["SelectionDesktop", "SelectionMobile"],
      ["PartialFailureDesktop", "PartialFailureMobile"],
    ],
  ],
  [
    "pages-authoring-products",
    "Pages/Authoring/Продукты",
    [
      ["ProductsDesktop", "ProductsMobile"],
      ["LongList", "LongListMobile"],
      ["Empty", "EmptyMobile"],
      ["SaleWithoutOwnerPrices", "SaleWithoutOwnerPricesMobile"],
    ],
  ],
  [
    "pages-authoring-payments",
    "Pages/Authoring/Платежи",
    [
      ["OneSale", "OneSaleMobile"],
      ["LongList", "LongListMobile"],
      ["Empty", "EmptyMobile"],
      ["FilteredNoResults", "FilteredNoResultsMobile"],
      ["Unavailable", "UnavailableMobile"],
      ["Forbidden", "Forbidden"],
    ],
  ],
  [
    "pages-authoring-payment",
    "Pages/Authoring/Платёж",
    [
      ["WithRefunds", "WithRefundsMobile"],
      ["UnknownState", "UnknownStateMobile"],
      ["NotFound", "NotFound"],
      [null, "Unavailable"],
    ],
  ],
  [
    "pages-authoring-payment-order-email",
    "Pages/Authoring/Платёж/Email заказа",
    [
      ["Hidden", "HiddenMobile"],
      ["Shown", "ShownMobile"],
      ["Forbidden", "Forbidden"],
    ],
  ],
  [
    "pages-authoring-sales-payment-links",
    "Pages/Authoring/Sales/Payment links",
    [
      ["EmptyDesktop", "EmptyMobile"],
      ["OneLinkDesktop", "OneLinkMobile"],
      ["LongListDesktop", "LongListMobile"],
      ["LinkDetailsDesktop", "LinkDetailsMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-sales-payment-link-create",
    "Components/Админка/Продажи/Создание ссылки на оплату",
    [
      ["ProductPriceDesktop", "ProductPriceMobile"],
      ["DiscountDesktop", "DiscountMobile"],
      ["CreatedDesktop", "CreatedMobile"],
      ["ProductsUnavailable", "ProductsUnavailable"],
    ],
  ],
  [
    "pages-authoring-sales-discounts",
    "Pages/Authoring/Sales/Discounts",
    [
      ["EmptyDesktop", "EmptyMobile"],
      ["ListDesktop", "ListMobile"],
      ["ArchiveDesktop", "ArchiveMobile"],
      ["QuestionnaireDesktop", "QuestionnaireMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-sales-promotion-form",
    "Components/Админка/Продажи/Форма скидки",
    [
      ["CreateDesktop", "CreateMobile"],
      ["EditDesktop", "EditMobile"],
      ["RevisionConflict", "RevisionConflict"],
    ],
  ],
  [
    "pages-authoring-sales-funnel",
    "Pages/Authoring/Sales funnel report",
    [
      ["Ready", "ReadyMobile"],
      ["EmptyPeriod", "EmptyPeriod"],
      ["Forbidden", "Forbidden"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-confirm-dialog",
    "Components/Админка/AdminConfirmDialog",
    [
      ["DangerDesktop", "DangerMobile"],
      ["WithError", "WithError"],
    ],
  ],
  [
    "components-admin-search-select",
    "Components/Админка/Выбор из длинного списка",
    [["BoundedDesktop", "BoundedMobile"]],
  ],
];

/** @param {string} name */
const kebab = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1-$2")
    .toLowerCase();

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
    `.${decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)}`,
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

const index = z
  .object({
    entries: z.record(
      z.string(),
      z.object({
        id: z.string(),
        title: z.string(),
        type: z.string(),
        exportName: z.string().optional(),
      }),
    ),
  })
  .parse(JSON.parse(await readFile(resolve(root, "index.json"), "utf8")));

/** Phase of the story render in the preview iframe: `finished` comes after `play` and `afterEach`. */
function storyPhase() {
  /** @type {unknown} */
  const preview = Reflect.get(window, "__STORYBOOK_PREVIEW__");
  /** @type {unknown} */
  const render =
    typeof preview === "object" && preview !== null
      ? Reflect.get(preview, "currentRender")
      : undefined;
  /** @type {unknown} */
  const phase =
    typeof render === "object" && render !== null
      ? Reflect.get(render, "phase")
      : undefined;
  return typeof phase === "string" ? phase : undefined;
}
/** @param {string} title @param {string} exportName */
function storyId(title, exportName) {
  const entry = Object.values(index.entries).find(
    (item) =>
      item.type === "story" &&
      item.title === title &&
      item.exportName === exportName,
  );
  if (entry === undefined)
    throw new Error(`No story ${title} › ${exportName} in storybook-static`);
  return entry.id;
}

const directory = await prepareEvidenceDirectory("issue-1718");
/** @type {Array<{id: string, width: number, file: string, scrollWidth: number, clientWidth: number, noOverflow: boolean, axeViolations: string[], playError?: string}>} */
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
      for (const [slug, title, rows] of families) {
        for (const [wide, phone] of rows) {
          const exportName = width === 390 ? phone : wide;
          if (exportName === null) continue;
          const id = storyId(title, exportName);
          const file = `storybook-${slug}--${kebab(exportName)}-${String(width)}.png`;
          await page.goto(
            // This script owns the awaited Axe scan; avoid racing the addon's automatic scan.
            `http://127.0.0.1:${String(address.port)}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=a11y.manual:!true`,
          );
          await expect
            .poll(() => page.evaluate(storyPhase), { timeout: 60_000 })
            .toMatch(/^(?:finished|errored)$/u);
          const playError =
            (await page.evaluate(storyPhase)) === "errored"
              ? ((await page.locator("#error-message").textContent()) ??
                "story errored")
              : undefined;
          await page.evaluate(() => document.fonts.ready);
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          // Storybook's a11y addon skips `region` for the same reason: a story is a fragment of a
          // page, and the live route scans whole pages with every rule.
          let axe = new AxeBuilder({ page })
            .include("#storybook-root")
            .disableRules(["region"]);
          if (
            (await page
              .locator("[role=dialog]:visible, [role=alertdialog]:visible")
              .count()) > 0
          )
            axe = axe.include("[role=dialog], [role=alertdialog]");
          const scan = await axe.analyze();
          // A phone page scrolls the document, and `fullPage` would leave the fixed bottom panel
          // over the content where the first screen ends: stretch the window for the capture.
          const height = await page.evaluate(
            () => document.documentElement.scrollHeight,
          );
          const viewport = { width, height: width === 390 ? 844 : 1024 };
          const stretch = height > viewport.height;
          if (stretch) await page.setViewportSize({ width, height });
          try {
            await screenshotWholePage(page, {
              path: resolve(directory, file),
            });
          } finally {
            if (stretch) await page.setViewportSize(viewport);
          }
          results.push({
            id,
            width,
            file,
            scrollWidth,
            clientWidth,
            noOverflow: scrollWidth === clientWidth,
            axeViolations: scan.violations.map(
              (violation) =>
                `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
            ),
            ...(playError === undefined ? {} : { playError }),
          });
        }
      }
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(directory, "storybook-checks.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  const failed = results.filter(
    (result) =>
      !result.noOverflow ||
      result.axeViolations.length > 0 ||
      result.playError !== undefined,
  );
  if (failed.length > 0) {
    console.error(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  } else
    console.log(
      `Captured ${String(results.length)} Storybook states: no overflow or Axe violations.`,
    );
} finally {
  await browser.close();
  await new Promise((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed(undefined))),
  );
}
