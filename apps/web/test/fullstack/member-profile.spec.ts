import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

test("onboards the Account owner and preserves the complete Profile lifecycle", async ({
  context,
  page,
}, testInfo) => {
  await addFullStackSession(context);

  await page.goto("/account");
  const existingDelete = page.getByRole("button", { name: "Удалить профиль" });
  if (await existingDelete.isVisible()) {
    await existingDelete.focus();
    await page.keyboard.press("Enter");
    const existingDeletion = page.getByRole("dialog", { name: "Удалить профиль?" });
    await existingDeletion
      .getByRole("button", { name: "Удалить безвозвратно" })
      .click();
    await expect(existingDeletion).toBeHidden();
  }

  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  const onboarding = page.getByRole("dialog", { name: "Как к вам обращаться?" });
  await expect(onboarding).toBeVisible();
  await expect(page.locator("[data-profile-gated=true]")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(onboarding.getByLabel("Имя")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(onboarding).toBeVisible();

  await onboarding.getByLabel("Имя").fill("Кирилл Сачков");
  await onboarding.getByRole("button", { name: "Продолжить" }).click();
  await expect(onboarding).toBeHidden();
  await expect(page.locator("[data-profile-gated=true]")).toHaveCount(0);
  await page.getByRole("link", { name: /Открыть аккаунт/u }).click();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(page.getByRole("heading", { name: "Ваш профиль" })).toBeVisible();

  const bio = "Развиваю инженерные команды и изучаю agent-first delivery.";
  await page.getByLabel("О себе · необязательно").fill(bio);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Профиль сохранён.")).toBeVisible();
  await expect(page.getByRole("article").getByText(bio)).toBeVisible();

  const publicPathCode = page.locator("code").filter({ hasText: "/members/" });
  const publicPath = await publicPathCode.textContent();
  expect(publicPath).toMatch(/^\/members\/[0-9a-f-]+$/u);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const reviewDirectory = resolve(process.cwd(), "../../.impeccable/review");
  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-51");
  await mkdir(reviewDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  const screenshotName =
    testInfo.project.name === "mobile-chromium" ? "mobile.png" : "desktop.png";
  await publicPathCode.evaluate((element) => {
    element.textContent = "/members/<opaque-public-id>";
  });
  await page.screenshot({ path: resolve(reviewDirectory, screenshotName) });
  await page.screenshot({ path: resolve(evidenceDirectory, screenshotName) });
  if (testInfo.project.name === "desktop-chromium") {
    await page.getByRole("main").screenshot({
      path: resolve(reviewDirectory, "hero-repro.png"),
    });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать JSON" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe("member-profile.json");
  if (downloadPath === null) throw new Error("Profile export has no local path");
  expect(JSON.parse(await readFile(downloadPath, "utf8"))).toEqual({
    profile: { bio, displayName: "Кирилл Сачков" },
    schemaVersion: "member-profile-export.v1",
  });

  if (publicPath === null) throw new Error("Profile projection path is missing");
  const memberPage = await page.goto(publicPath);
  expect(memberPage?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Профиль недоступен" })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/u,
  );

  await page.goto("/account");
  await page.getByRole("button", { name: "Удалить профиль" }).focus();
  await page.keyboard.press("Enter");
  const deletion = page.getByRole("dialog", { name: "Удалить профиль?" });
  await expect(deletion).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deletion).toBeVisible();
  await deletion.getByRole("button", { name: "Удалить безвозвратно" }).click();
  await expect(deletion).toBeHidden();
  await expect(page.getByRole("button", { name: "Создать" })).toBeVisible();
});

async function addFullStackSession(context: BrowserContext) {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env.FULLSTACK_LOGTO_SESSION;
  if (cookieName === undefined || session === undefined) {
    throw new Error("Full-stack Logto session fixture is missing");
  }
  await context.addCookies([
    {
      httpOnly: true,
      name: cookieName,
      sameSite: "Lax",
      url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000",
      value: session,
    },
  ]);
}
