// PROTOTYPE #947: captures the variant stories from a running Storybook. Throwaway.
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.STORYBOOK_URL ?? "http://localhost:6006";
const out = process.argv[2];
const stories = [
  "a-document", "a-document-form", "b-panel", "b-panel-sheet", "b-panel-sheet-form",
  "c-tabs", "c-tabs-submit", "first-time", "acceptance-closed", "locked",
  "programme-one", "programme-two",
];
const browser = await chromium.launch();
let failed = 0;
for (const story of stories) {
  for (const [width, height] of [[390, 844], [1440, 2600]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base}/iframe.html?id=prototype-task-page-947--${story}&viewMode=story`);
    await page.locator("[data-workshop-story] h1").first().waitFor({ timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.evaluate(() => { for (const e of document.querySelectorAll("body *")) if (getComputedStyle(e).position === "fixed" && !e.closest("[data-workshop-story]") && !e.closest("header") && !e.closest("nav")) e.style.display = "none"; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow !== 0) { console.error(`${story}@${width}: horizontal overflow ${overflow}px`); failed++; }
    await page.screenshot({ path: join(out, `${story}-${width}.png`), fullPage: width < 1000 });
    await page.close();
  }
}
await browser.close();
console.log(`overflow failures ${failed}`);
process.exit(failed === 0 ? 0 : 1);
