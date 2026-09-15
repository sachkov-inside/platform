import { chromium } from "../../../../apps/web/node_modules/@playwright/test/index.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "index.html");
const out = process.env.SHOTS_DIR || path.join(os.tmpdir(), "ai-first-animation-shots");
await import("node:fs/promises").then((fs) => fs.mkdir(out, { recursive: true }));
// Границы сцен: 4000, 7600, 11000, 14600; конец 18200; цикл после 19400.
const plan = {
  home: { loop: 1, stamps: [1400, 2500, 3700, 4200, 4600, 5400, 6600, 7300, 7900, 8500, 10400, 11250, 11700, 13000, 14300, 14800, 15400, 17600, 19600, 20000] },
  mobile: { loop: 0, stamps: [3700, 6600, 10400, 14300, 17600] },
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });
for (const [frame, { loop, stamps }] of Object.entries(plan)) {
  await page.goto(`${pageUrl}?frame=${frame}&loop=${loop}`);
  const host = page.locator(".frame:not([hidden]) .stage-host");
  const t0 = Date.now();
  for (const t of stamps) {
    const wait = t - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await host.screenshot({ path: path.join(out, `${frame}-${String(t).padStart(5, "0")}.png`) });
    if (frame === "mobile" && t === 6600) await page.locator(".frame:not([hidden]) .phone").screenshot({ path: path.join(out, "context-mobile.png") });
  }
}
await browser.close();
console.log("done →", out);
