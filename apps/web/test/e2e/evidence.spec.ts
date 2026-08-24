import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const outputByProject: Readonly<Record<string, string>> = {
  "desktop-chromium": "desktop.png",
  "mobile-chromium": "mobile.png",
};

test("capture the issue 46 production shell evidence", async ({ page }, testInfo) => {
  const outputName = outputByProject[testInfo.project.name];

  if (outputName === undefined) {
    throw new Error(`No evidence output configured for ${testInfo.project.name}`);
  }

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(process.cwd(), "../../docs/evidence/issue-46", outputName),
  });
});
