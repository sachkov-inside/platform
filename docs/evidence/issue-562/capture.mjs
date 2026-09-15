// Доказательства #562 на живом маршруте. Запуск из корня репозитория, когда `next dev` смотрит на
// двойник backend (`backend-double.mjs`):
//   node docs/evidence/issue-562/capture.mjs <каталог> [geometry|timing] [подпись]
// geometry: загрузка против готовой ленты для обоих составов на 1440 и 390, снимки и axe.
// timing: медианы первого байта, первой отрисовки, появления каркаса главной и карточки продукта.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const { chromium } = requireWeb("@playwright/test");
const AxeBuilder = requireWeb("@axe-core/playwright").default;

const [out, mode = "geometry", label = "current"] = process.argv.slice(2);
if (!out) throw new Error("Pass an evidence output directory");
fs.mkdirSync(out, { recursive: true });
const web = process.env.WEB_URL ?? "http://127.0.0.1:3380";
const double = process.env.DOUBLE_URL ?? "http://127.0.0.1:3389";
const viewports = [
  { name: "desktop-1440", width: 1440, height: 1024, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
];
const catalog = {
  kind: "ready",
  facets: { formats: [], series: [], topics: [] },
  items: Array.from({ length: 6 }, (_, index) => ({
    access: "free", availability: "available", format: "Гайд", formatSlug: "guide",
    seriesMemberships: [], slug: `live-${String(index)}`, summary: "Материал ленты для проверки первого экрана главной.",
    tags: [], title: `Материал ${String(index + 1)}`, topic: "Platform", topicSlug: "platform",
  })),
  nextCursor: null,
  totalCount: 6,
};

async function openContext(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile, reducedMotion: "reduce" });
  await context.route("**/auth/status", (route) => route.fulfill({ json: { state: "guest", canManageMaterials: false, accountId: null } }));
  await context.route("**/api/account", (route) => route.fulfill({ status: 401, json: { kind: "unauthorized" } }));
  return context;
}

function measureFirstScreen() {
  const frame = document.querySelector(".home-page");
  const materials = frame?.querySelector(":scope > .home-feed");
  const toolbar = materials?.querySelector(":scope > .home-feed-toolbar");
  const firstRow = materials?.querySelector(".home-feed-post");
  if (!materials || !toolbar || !firstRow) return null;
  const box = (element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, height: rect.height }; };
  const featured = frame.querySelector(":scope > .home-guide");
  return { featured: featured ? box(featured) : null, materialsTop: materials.getBoundingClientRect().top, toolbar: box(toolbar), firstRowTop: firstRow.getBoundingClientRect().top };
}

async function axe(page) {
  return (await new AxeBuilder({ page }).include(".home-page").analyze()).violations.map(({ id, impact }) => ({ id, impact }));
}

async function geometry(browser) {
  const results = {};
  let failed = false;
  for (const composition of ["none", "ai-first"]) {
    await fetch(`${double}/__pin/${composition}`, { method: "POST" });
    for (const viewport of viewports) {
      const context = await openContext(browser, viewport);
      const page = await context.newPage();
      let release = () => undefined;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route("**/api/library/materials**", async (route) => { await held; await route.fulfill({ json: catalog }); });
      const html = await (await context.request.get(`${web}/`)).text();
      const firstResponse = {
        feed: html.includes('class="home-feed"'),
        product: html.includes('id="featured-title"'),
        wholeHomeSkeleton: html.includes("Главная загружается") || html.includes("home-guide-skeleton"),
      };
      await page.goto(`${web}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".home-page > .home-feed .home-feed-post");
      await page.evaluate(() => document.fonts.ready);
      const loading = await page.evaluate(measureFirstScreen);
      const loadingStatus = await page.locator(".home-page > .home-feed [role=status]").textContent();
      const loadingAxe = await axe(page);
      await page.screenshot({ path: path.join(out, `live-loading-${composition}-${viewport.name}.png`) });
      release();
      await page.getByRole("list", { name: "Материалы, страница 1" }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const ready = await page.evaluate(measureFirstScreen);
      const readyAxe = await axe(page);
      await page.screenshot({ path: path.join(out, `live-ready-${composition}-${viewport.name}.png`) });
      const same = JSON.stringify(loading) === JSON.stringify(ready);
      if (!same || loadingAxe.length > 0 || readyAxe.length > 0) failed = true;
      results[`${composition}/${viewport.name}`] = { firstResponse, loadingStatus, loading, ready, same, axe: { loading: loadingAxe, ready: readyAxe } };
      await context.close();
    }
  }
  fs.writeFileSync(path.join(out, "live-measure.json"), `${JSON.stringify(results, null, 2)}\n`);
  return failed;
}

async function timing(browser) {
  await fetch(`${double}/__pin/ai-first`, { method: "POST" });
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return Math.round(sorted[Math.floor(sorted.length / 2)]); };
  const results = {};
  for (const viewport of viewports) {
    const samples = [];
    for (let run = 0; run < 6; run++) {
      const context = await openContext(browser, viewport);
      await context.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
      const page = await context.newPage();
      await page.addInitScript(() => {
        const marks = {};
        window.__homeMarks = marks;
        const check = () => {
          const now = performance.now();
          if (marks.homeFrame === undefined && document.querySelector(".home-page")) marks.homeFrame = now;
          if (marks.product === undefined && document.querySelector("#featured-title")) marks.product = now;
        };
        new MutationObserver(check).observe(document, { childList: true, subtree: true });
      });
      await page.goto(`${web}/`, { waitUntil: "load" });
      await page.waitForSelector("#featured-title");
      await page.getByRole("list", { name: "Материалы, страница 1" }).waitFor();
      const sample = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        return { firstByte: navigation.responseStart, firstContentfulPaint: paint?.startTime ?? null, homeFrame: window.__homeMarks.homeFrame, product: window.__homeMarks.product };
      });
      await context.close();
      if (run > 0) samples.push(sample);
    }
    results[viewport.name] = Object.fromEntries(Object.keys(samples[0]).map((key) => [key, median(samples.map((sample) => sample[key]))]));
  }
  const file = path.join(out, "live-timing.json");
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, `${JSON.stringify({ ...previous, [label]: { backendDelayMs: Number(process.env.DOUBLE_DELAY_MS ?? "0"), ...results } }, null, 2)}\n`);
  return false;
}

const browser = await chromium.launch();
try {
  const failed = mode === "timing" ? await timing(browser) : await geometry(browser);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
