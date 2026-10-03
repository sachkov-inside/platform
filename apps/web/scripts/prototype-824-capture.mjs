// PROTOTYPE #824: captures the variant stories from a built Storybook. Throwaway.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "@playwright/test";

const root = new URL("../storybook-static/", import.meta.url).pathname;
const out = process.argv[2];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const shots = [];
for (const v of ["a", "b", "c"]) {
  for (const theme of ["light", "dark"]) {
    shots.push([`${v}-all-states-1440-${theme}`, `${v}-all-states`, theme, 1440, 900, true]);
  }
  // Публичная оболочка задаёт только светлую палитру: страницы снимаются в светлой теме.
  shots.push([`${v}-after-payment-1440-light`, `${v}-after-payment`, "light", 1440, 1100, false]);
  shots.push([`${v}-after-payment-390-light`, `${v}-after-payment`, "light", 390, 844, "block"]);
  shots.push([`${v}-purchases-1440-light`, `${v}-purchases`, "light", 1440, 1500, false]);
  shots.push([`${v}-purchases-390-light`, `${v}-purchases`, "light", 390, 844, "block"]);
  shots.push([`${v}-all-states-390-light`, `${v}-all-states`, "light", 390, 844, true]);
}
let failed = 0;
for (const [name, story, theme, width, height, fullPage] of shots) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://localhost:${port}/iframe.html?id=prototype-community-entry-824--${story}&viewMode=story&globals=theme:${theme}`);
  await page.locator("[data-workshop-story] section, [data-workshop-story] h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*{animation-play-state:paused!important}" });
  await page.waitForTimeout(400);
  // Agentation рисует кнопку вне истории: прячем всё закреплённое за пределами story.
  await page.evaluate(() => { for (const e of document.querySelectorAll("body *")) if (getComputedStyle(e).position === "fixed" && !e.closest("[data-workshop-story]")) e.style.display = "none"; });
  if (fullPage === "block") await page.evaluate(() => { const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.includes("Сообществ")); h.closest("section").scrollIntoView({ block: "center" }); });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow !== 0) { console.error(`${name}: horizontal overflow ${overflow}px`); failed++; }
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: fullPage === true });
  await page.close();
}
await browser.close();
server.close();
console.log(`captured ${shots.length}, overflow failures ${failed}`);
process.exit(failed === 0 ? 0 : 1);
