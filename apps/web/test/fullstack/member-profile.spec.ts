import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

test("creates or edits the Account Profile and preserves the member projection", async ({
  context,
  page,
}, testInfo) => {
  await addFullStackSession(context);

  const profileStateResponse = await page.request.get("/api/account/profile");
  expect(profileStateResponse.status()).toBe(200);
  const profileState = (await profileStateResponse.json()) as { readonly kind?: string };
  const account = await page.goto("/account");
  expect(account?.status()).toBe(200);
  if (profileState.kind === "missing") {
    await page.getByLabel("Имя").fill("Кирилл Сачков");
  } else {
    expect(profileState.kind).toBe("profile");
  }
  await expect(page.getByRole("heading", { name: "Ваш профиль" })).toBeVisible();

  const bio =
    testInfo.project.name === "mobile-chromium"
      ? "Развиваю инженерные команды и проверяю agent-first delivery на практике."
      : "Развиваю инженерные команды и изучаю agent-first delivery.";
  await page.getByLabel("О себе · необязательно").fill(bio);
  await page.getByRole("button", { name: /Создать|Сохранить/u }).click();
  await expect(page.getByText("Профиль сохранён.")).toBeVisible();
  await expect(page.getByRole("article").getByText(bio)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Профиль участника" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Удалить профиль/u })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Скачать JSON/u })).toHaveCount(0);
  await expect(page.getByText("Граница", { exact: true })).toHaveCount(0);

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
  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-189");
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

  const removedExportRoute = await page.request.get("/account/export-profile");
  expect(removedExportRoute.status()).toBe(404);

  if (publicPath === null) throw new Error("Profile projection path is missing");
  const memberPage = await page.goto(publicPath);
  expect(memberPage?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Профиль недоступен" })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/u,
  );

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
