import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.FRONTEND_URL ?? "http://frontend:8080");
  await page
    .getByRole("status")
    .filter({ hasText: "База подключена" })
    .waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
