import { chromium } from "../../../../apps/web/node_modules/@playwright/test/index.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "index.html");
const out = process.env.SHOTS_DIR || path.join(os.tmpdir(), "ai-first-animation-shots");
await import("node:fs/promises").then((fs) => fs.mkdir(out, { recursive: true }));
// Границы сцен: 4000, 7600, 11000, 14600; замыкание цикла 19400.
const boundaries = (process.argv[2] ? process.argv[2].split(",").map(Number) : [4000, 7600, 11000, 14600, 19400]);
const offsets = [200, 500, 800, 1100];
const stamps = boundaries.flatMap((b) => offsets.map((o) => b + o)).sort((a, b) => a - b);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await page.goto(`${pageUrl}?frame=home&loop=1`);
const host = page.locator(".frame:not([hidden]) .stage-host");
const t0 = Date.now();
for (const t of stamps) {
  const wait = t - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await host.screenshot({ path: path.join(out, `tr-${String(t).padStart(5, "0")}.png`) });
}
await browser.close();
console.log("done →", out);
