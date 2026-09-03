import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

test("shows private Account Telegram and Membership presentation without disclosure", async ({
  context,
  page,
}, testInfo) => {
  await addFullStackSession(context, "FULLSTACK_LOGTO_SESSION");

  const accountStateResponse = await page.request.get("/api/account");
  expect(accountStateResponse.status()).toBe(200);
  const accountState = (await accountStateResponse.json()) as {
    readonly telegramMembership?: unknown;
  };
  expect(accountState.telegramMembership).toEqual({
    link: { kind: "unlinked" },
    membership: {
      acquisitionUrl:
        process.env.FULLSTACK_MEMBERSHIP_ACQUISITION_URL ?? "https://t.me/tribute",
      kind: "inactive",
    },
  });

  const account = await page.goto("/account");
  expect(account?.status()).toBe(200);
  const onboarding = page.getByRole("dialog", { name: "Подключите Telegram" });
  await expect(onboarding).toBeVisible();
  const onboardingPanel = onboarding.getByRole("region", {
    name: "Подключите Telegram",
  });
  await expect(onboardingPanel.getByText("Подключите Telegram")).toBeVisible();
  await expect(
    onboardingPanel.getByRole("button", { name: "Подключить Telegram" }),
  ).toBeVisible();
  await expect(onboardingPanel).not.toContainText(/Доступ|Membership|Получить доступ/u);
  await expect(onboardingPanel).not.toContainText(
    /accountId|checkedAt|evidence|issuer|subject|telegramIdentity|username|validUntil/u,
  );
  await expect(onboardingPanel).not.toContainText(
    /\d{1,2}[.:]\d{2}|\d{4}-\d{2}-\d{2}/u,
  );

  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-122");
  const reviewDirectory = resolve(process.cwd(), "../../.impeccable/review");
  await mkdir(evidenceDirectory, { recursive: true });
  await mkdir(reviewDirectory, { recursive: true });
  const viewportName = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    path: resolve(evidenceDirectory, `onboarding-unlinked-${viewportName}.png`),
  });
  await page.screenshot({
    path: resolve(reviewDirectory, `issue-122-onboarding-unlinked-${viewportName}.png`),
  });

  const onboardingAccessibility = await new AxeBuilder({ page })
    .include("dialog[aria-labelledby='telegram-onboarding-heading']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    onboardingAccessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const onboardingOverflow = await onboarding.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(onboardingOverflow.scrollWidth).toBeLessThanOrEqual(
    onboardingOverflow.clientWidth,
  );

  await onboarding
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await expect(onboarding).toHaveCount(0);
  const accessPanel = page.locator(
    "section[aria-labelledby='inside-access-heading']",
  );
  await accessPanel.screenshot({
    path: resolve(evidenceDirectory, `account-unlinked-${viewportName}.png`),
  });
  await accessPanel.screenshot({
    path: resolve(reviewDirectory, `issue-122-account-unlinked-${viewportName}.png`),
  });

  const accessibility = await new AxeBuilder({ page })
    .include("section[aria-labelledby='inside-access-heading']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await accessPanel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("creates or edits the Account Profile and preserves the member projection", async ({
  context,
  page,
}, testInfo) => {
  await addFullStackSession(context, "FULLSTACK_LOGTO_MEMBER_SESSION");

  const profileStateResponse = await page.request.get("/api/account/profile");
  expect(profileStateResponse.status()).toBe(200);
  const profileState = (await profileStateResponse.json()) as {
    readonly state?: { readonly kind?: string };
  };
  const profileKind = profileState.state?.kind;
  const account = await page.goto("/account");
  expect(account?.status()).toBe(200);
  const onboarding = page.getByRole("dialog", { name: "Подключите Telegram" });
  await expect(onboarding).toBeVisible();
  await onboarding
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await expect(onboarding).toHaveCount(0);
  const nameInput = page.getByRole("textbox", { exact: true, name: "Имя" });
  if (profileKind === "missing") {
    await nameInput.fill("Кирилл Сачков");
    await page.getByRole("button", { name: "Создать" }).click();
    await expect(page.getByText("Профиль сохранён.")).toBeVisible();
  } else {
    expect(profileKind).toBe("profile");
  }
  await expect(page.getByRole("heading", { name: "Ваш профиль" })).toBeVisible();
  const displayName = await nameInput.inputValue();

  await page.getByLabel("Выбрать изображение для аватара").setInputFiles({
    buffer: profileAvatarPng(),
    mimeType: "image/png",
    name: "profile-avatar.png",
  });
  const cropDialog = page.getByRole("dialog", { name: "Кадрировать аватар" });
  await expect(cropDialog).toBeVisible();
  const horizontalCrop = cropDialog.getByLabel("По горизонтали");
  await horizontalCrop.focus();
  await page.keyboard.press("ArrowRight");
  await expect(horizontalCrop).toBeFocused();
  await cropDialog.getByLabel("Масштаб").press("ArrowRight");

  const avatarEvidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-153");
  const reviewDirectory = resolve(process.cwd(), "../../.impeccable/review");
  await mkdir(avatarEvidenceDirectory, { recursive: true });
  await mkdir(reviewDirectory, { recursive: true });
  const viewportName = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await cropDialog.screenshot({
    path: resolve(reviewDirectory, `issue-153-crop-${viewportName}.png`),
  });
  await cropDialog.screenshot({
    path: resolve(avatarEvidenceDirectory, `crop-${viewportName}.png`),
  });
  await cropDialog.getByRole("button", { name: "Сохранить аватар" }).click();
  await expect(cropDialog).toBeHidden();
  const renderedAvatar = page.getByAltText(`Аватар: ${displayName}`).first();
  await expect(renderedAvatar).toBeVisible();
  await expect.poll(() =>
    renderedAvatar.evaluate((element) =>
      element instanceof HTMLImageElement ? element.naturalWidth : 0,
    ),
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: resolve(reviewDirectory, `issue-153-account-${viewportName}.png`),
  });
  await page.screenshot({
    path: resolve(avatarEvidenceDirectory, `account-${viewportName}.png`),
  });

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


  await page.getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Аватар удалён." })).toBeVisible();
  await expect(page.getByAltText(`Аватар: ${displayName}`)).toHaveCount(0);
  await expect(page.getByRole("img", { name: `Аватар: ${displayName}` }).first()).toBeVisible();

  const removedExportRoute = await page.request.get("/account/export-profile");
  expect(removedExportRoute.status()).toBe(404);

  if (publicPath === null) throw new Error("Profile projection path is missing");
  const memberPage = await page.goto(publicPath);
  expect(memberPage?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByAltText(`Аватар: ${displayName}`)).toHaveCount(0);
  await expect(page.getByRole("img", { name: `Аватар: ${displayName}` })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/u,
  );

});

async function addFullStackSession(
  context: BrowserContext,
  sessionName: "FULLSTACK_LOGTO_MEMBER_SESSION" | "FULLSTACK_LOGTO_SESSION",
) {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env[sessionName];
  if (cookieName === undefined || session === undefined) {
    throw new Error(`Full-stack Logto session fixture ${sessionName} is missing`);
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

function profileAvatarPng(): Buffer {
  const width = 480;
  const height = 320;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      scanlines[offset] = 216;
      scanlines[offset + 1] = Math.round(80 + 70 * x / width);
      scanlines[offset + 2] = Math.round(48 + 80 * y / height);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
