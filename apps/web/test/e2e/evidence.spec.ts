import { expect, test } from "@playwright/test";
import { evidencePath } from "../../../../scripts/evidence-path.mjs";

const outputByProject: Readonly<Record<string, string>> = {
  "desktop-chromium": "desktop.png",
  "mobile-chromium": "mobile.png",
};

test("capture the issue 49 real authenticated-shell evidence", async ({ page }, testInfo) => {
  const outputName = outputByProject[testInfo.project.name];

  if (outputName === undefined) {
    throw new Error(`No evidence output configured for ${testInfo.project.name}`);
  }

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Аккаунт", exact: true })).toBeEnabled();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: evidencePath("issue-49", outputName),
  });
});
