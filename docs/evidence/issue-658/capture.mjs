import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const { chromium, expect } = requireWeb("@playwright/test");
const AxeBuilder = requireWeb("@axe-core/playwright").default;

/**
 * Снимки поверхностей Platform #658 в Storybook: настоящие production-модули с fixture-данными.
 * Для каждого кадра записывается переполнение по горизонтали, serious/critical нарушения axe и то,
 * есть ли на поверхности отметки (checkbox) — путь A принимает условия только кнопкой.
 */
const surfaces = [
  ["welcome", "pages-welcome--first-sign-in", "Принять условия и продолжить"],
  ["checkout-one-time", "pages-guide-payment--ready", "Без подписки и доплат"],
  ["checkout-subscription", "pages-subscription-checkout--acceptance-by-button", "Оформление подписки"],
  ["subscription-resume", "pages-account-subscription--canceled", "Возобновить автопродление"],
  // История первого посещения сама нажимает «Понятно»; снимается показ после новой редакции.
  ["storage-notice", "patterns-storage-notice--new-edition", "Понятно"],
  ["accepted-documents", "pages-account-access--linked", "Принятые документы"],
  ["profile", "pages-account-profile--active-desktop", "Аватар"],
];

let browser;
(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("Pass an evidence output directory");
  fs.mkdirSync(out, { recursive: true });
  const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:3411";
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [viewport, width, height] of [["desktop", 1440, 1024], ["mobile", 390, 844]]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      isMobile: viewport === "mobile",
      hasTouch: viewport === "mobile",
    });
    const page = await context.newPage();
    for (const [surface, id, label] of surfaces) {
      await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`, {
        waitUntil: "domcontentloaded",
      });
      const anchor = page.getByText(label, { exact: true }).first();
      await expect(anchor).toBeVisible({ timeout: 30_000 });
      await page.addStyleTag({ content: "[data-agentation-root] { display: none !important; }" });
      await page.screenshot({ path: `${out}/${surface}-${viewport}.png`, fullPage: surface !== "storage-notice" });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      results.push({
        surface,
        viewport,
        id,
        overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        checkboxes: await page.getByRole("checkbox").count(),
        serious: axe.violations
          .filter((violation) => ["serious", "critical"].includes(violation.impact))
          .map((violation) => ({ id: violation.id, impact: violation.impact })),
      });
    }
    await context.close();
  }
  fs.writeFileSync(`${out}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => browser?.close());
