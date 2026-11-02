import { chromium } from "@playwright/test";
const port = process.argv[2];
const ids = [
  "now",
  "subtitle-meta",
  "format-tile",
  "access-groups",
  "inline-marks",
];
const browser = await chromium.launch();
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
  });
  for (const id of ids) {
    await page.goto(
      `http://localhost:${port}/iframe.html?id=prototypes-lesson-row--${id}&viewMode=story`,
    );
    await page.waitForSelector("#storybook-root ol li", { timeout: 60000 });
    await page.waitForTimeout(500);
    const ov = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    console.log(w, id, "overflow", ov);
    await page.screenshot({
      path: `/tmp/lesson-row-shots/${id}-${w}.png`,
      fullPage: true,
    });
  }
  await page.close();
}
await browser.close();
