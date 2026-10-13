// @ts-check
/// <reference lib="dom" />
/** #1414: bounded evidence from the production module, Storybook and real Content routes. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { z } from "zod";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const live = process.env["COURSE_LIVE_ORIGIN"] ?? "http://localhost:3107";
const storybook =
  process.env["COURSE_STORYBOOK_ORIGIN"] ?? "http://localhost:6207";
const directory = resolve("../../docs/evidence/issue-1414/production");
const guide =
  "/materials/inside-content-aie-ch1-project-setup?from=%2Fproducts%2Fai-engineering%2Fprogramme";
const task = "/products/ai-engineering/tasks/aie-ch1-harness";
const pipeline = "material:inside-content-aie-ch1-pipeline";
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD:apps/web/src"], {
  encoding: "utf8",
}).trim();
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const storiesOnly = process.env["COURSE_EVIDENCE_STORIES_ONLY"] === "1";
/** @type {Record<string, unknown>[]} */
const results = storiesOnly
  ? z
      .object({
        results: z.array(z.object({ name: z.string() }).passthrough()),
      })
      .parse(
        JSON.parse(await readFile(resolve(directory, "metrics.json"), "utf8")),
      )
      .results.filter((entry) => !entry.name.startsWith("story-"))
  : [];

/** @param {string} url */
async function visit(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator("[data-course-reading]:visible,[data-product-task]:visible")
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const notice = page.getByRole("region", { name: "Хранение в браузере" });
  if (await notice.isVisible()) {
    await notice.getByRole("button", { name: "Понятно", exact: true }).click();
    await expect(notice).not.toBeVisible();
  }
}

async function metrics() {
  return page.evaluate(() => {
    const visible = (/** @type {Element} */ element) =>
      element.getClientRects().length > 0;
    const course = [...document.querySelectorAll("[data-course-reading]")].find(
      visible,
    );
    const heading = course?.querySelector("[data-reader-header] h1");
    const rail = course?.querySelector("aside");
    const selector = rail?.querySelector("[role=combobox]");
    const chevron = selector?.querySelector("svg");
    const controls = [
      ...(course?.querySelectorAll(
        "[data-course-actions] button,[data-course-actions] a[data-slot=button],[data-course-actions] > a",
      ) ?? []),
    ].map((control) => {
      const rect = control.getBoundingClientRect();
      const after = getComputedStyle(control, "::after");
      return {
        label: control.textContent,
        disabled: control.hasAttribute("disabled"),
        width: rect.width,
        height: rect.height,
        font: getComputedStyle(control).fontSize,
        targetWidth: after.width,
        targetHeight: after.height,
        targetTransform: after.transform,
      };
    });
    const gaps = [
      ...document.querySelectorAll(
        "[data-product-task] h2,[data-product-task] h3",
      ),
    ]
      .filter((heading) => heading.nextElementSibling?.tagName === "P")
      .map((heading) => ({
        title: heading.textContent,
        gap:
          (heading.nextElementSibling?.getBoundingClientRect().top ?? 0) -
          heading.getBoundingClientRect().bottom,
      }));
    return {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      title: heading?.textContent,
      position: course?.querySelector("[data-reader-header] p")?.textContent,
      railWidth:
        rail !== undefined && rail !== null && visible(rail)
          ? rail.getBoundingClientRect().width
          : null,
      chevronContained:
        chevron === undefined ||
        chevron === null ||
        selector === undefined ||
        selector === null
          ? null
          : chevron.getBoundingClientRect().right <=
            selector.getBoundingClientRect().right,
      controls,
      gaps,
    };
  });
}

/** @param {string} name @param {{whole?: boolean, a11y?: boolean}} [options] */
async function capture(name, { whole = true, a11y = true } = {}) {
  const measured = await metrics();
  expect(measured.scroll).toBe(measured.width);
  const violations = a11y
    ? (await new AxeBuilder({ page }).analyze()).violations.map(
        ({ id, impact, nodes }) => ({
          id,
          impact,
          targets: nodes.map((node) => node.target),
        }),
      )
    : [];
  expect(
    violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  if (whole)
    await screenshotWholePage(page, {
      path: resolve(directory, `${name}.png`),
    });
  else await page.screenshot({ path: resolve(directory, `${name}.png`) });
  results.push({
    name,
    url: page.url(),
    viewport: page.viewportSize(),
    ...measured,
    violations,
  });
}

/** Exact title line breaks, measured with Range after fonts are ready. */
async function pipelineLines() {
  const link = page.locator(
    `[data-course-reading]:visible aside [data-course-step="${pipeline}"]`,
  );
  return link.evaluate((element) => {
    const title = element.lastElementChild;
    if (title === null) throw new Error("Pipeline title missing");
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    /** @type {{top: number, text: string}[]} */
    const lines = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let offset = 0; offset < (node.textContent?.length ?? 0); offset++) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getClientRects()[0];
        if (rect === undefined) continue;
        const top = Math.round(rect.top * 100) / 100;
        const previous = lines.at(-1);
        if (previous?.top === top)
          previous.text += node.textContent?.[offset] ?? "";
        else lines.push({ top, text: node.textContent?.[offset] ?? "" });
      }
    }
    return lines.map((line) => line.text);
  });
}

try {
  if (!storiesOnly) {
    await visit(`${live}${task}`);
    const before = await pipelineLines();
    await page
      .locator(
        `[data-course-reading]:visible aside [data-course-step="${pipeline}"]`,
      )
      .click();
    await expect(
      page.locator(
        `[data-course-reading]:visible aside [data-course-step="${pipeline}"]`,
      ),
    ).toHaveAttribute("aria-current", "step");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const selected = await pipelineLines();
    await page
      .locator(
        '[data-course-reading]:visible aside [data-course-step="task:aie-ch1-harness"]',
      )
      .click();
    await expect(
      page.locator(
        '[data-course-reading]:visible aside [data-course-step="task:aie-ch1-harness"]',
      ),
    ).toHaveAttribute("aria-current", "step");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const returned = await pipelineLines();
    expect(selected).toEqual(before);
    expect(returned).toEqual(before);
    results.push({
      name: "pipeline-line-wrap-task-pipeline-task",
      before,
      selected,
      returned,
    });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await visit(`${live}${guide}`);
      await capture(`live-guide-${width}`);
      await visit(`${live}${task}`);
      await capture(`live-task-${width}`);
    }
    await page.setViewportSize({ width: 320, height: 1000 });
    await visit(`${live}${guide}`);
    await capture("live-guide-320", { whole: false });
    await visit(`${live}${task}`);
    await capture("live-task-320", { whole: false });
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit(`${live}${guide}`);
    const selector = page.getByRole("combobox", { name: "Глава курса" });
    await selector.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option").first()).toBeVisible();
    await capture("live-chapter-keyboard", { whole: false, a11y: false });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(selector).toHaveAttribute("aria-expanded", "false");

    await page.setViewportSize({ width: 390, height: 1000 });
    await visit(`${live}${guide}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await capture("live-guide-390-text-200", { whole: false });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  }
  for (const [name, story, width] of [
    ["story-pending-320", "pages-material-reader--course-pending", 320],
    ["story-access-320", "pages-material-reader--course-locked", 320],
    ["story-task-submitted-1440", "pages-product-task--submitted", 1440],
    ["story-task-only-1440", "pages-product-task--course-task-only", 1440],
    [
      "story-task-fallback-390",
      "pages-product-task--course-navigation-unavailable",
      390,
    ],
  ]) {
    await page.setViewportSize({ width: Number(width), height: 1000 });
    await visit(
      `${storybook}/iframe.html?id=${story}&viewMode=story&globals=a11y.manual:!true`,
    );
    await capture(String(name));
  }
  await writeFile(
    resolve(directory, "metrics.json"),
    `${JSON.stringify({ sourceSha, sourceTree, results }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
