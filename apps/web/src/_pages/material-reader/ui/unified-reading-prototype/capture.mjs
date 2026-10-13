// @ts-check
// Bounded visual evidence, not an application test suite. All resources belong to this process.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { screenshotWholePage } from "../../../../../test/support/whole-page-screenshot.mjs";

const output = resolve(process.argv[2] ?? "docs/evidence/issue-1414/initial");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const records = [];
try {
  const page = await browser.newPage();
  for (const variant of ["A", "B", "C"]) {
    for (const width of [1440, 390]) {
      for (const [label, step] of [
        ["guide", "inside-content-aie-ch1-project-setup"],
        ["task", "aie-ch1-harness"],
      ]) {
        await page.setViewportSize({
          width,
          height: width === 1440 ? 900 : 844,
        });
        await page.goto(
          `http://127.0.0.1:6207/iframe.html?id=prototypes-unified-guide-task-reading--playground&viewMode=story&variant=${variant}&step=${step}`,
        );
        await expect(page.locator("article[data-step]")).toHaveAttribute(
          "data-step",
          step,
        );
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const article = document.querySelector("article[data-step]");
          const prose = article?.querySelector('[class*="body"] > p');
          const heading = article?.querySelector("h1");
          return {
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            articleWidth: article?.getBoundingClientRect().width,
            titleSize:
              heading === null || heading === undefined
                ? ""
                : getComputedStyle(heading).fontSize,
            proseSize:
              prose === null || prose === undefined
                ? ""
                : getComputedStyle(prose).fontSize,
            lineHeight:
              prose === null || prose === undefined
                ? ""
                : getComputedStyle(prose).lineHeight,
          };
        });
        records.push({ variant, label, ...metrics });
        await screenshotWholePage(page, {
          path: resolve(output, `${variant}-${label}-${width}-whole.png`),
        });
        // Viewport regions remain readable without opening a very tall image.
        await page.screenshot({
          path: resolve(output, `${variant}-${label}-${width}-top.png`),
        });
        if (label === "task") {
          await page.locator("article h3").first().scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${variant}-task-${width}-body.png`),
          });
          await page.locator("#pilot-submit").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${variant}-task-${width}-submission.png`),
          });
        }
      }
    }
  }
  await writeFile(
    resolve(output, "metrics.json"),
    JSON.stringify(records, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
