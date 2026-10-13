import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";

import { fullStackBrowserRequest } from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import {
  evidencePath,
  prepareEvidenceDirectory,
} from "../../../../scripts/evidence-path.mjs";

/**
 * Путь покупателя курса целиком (Workspace #238, Platform #775): страница продукта, вход через
 * Telegram у тестового провайдера, бесплатная глава открыта, закрытая — нет, покупка на двойнике
 * банка, после оплаты материалы открыты и выдано право на общий чат. Стенд — `smoke:buyer-journey`.
 */
/** Адреса стенда читаются в самом тесте: список тестов собирается и без стенда. */
function stand() {
  return z
    .object({
      controlUrl: z.url(),
      slug: z.string().min(1),
    })
    .parse({
      controlUrl: process.env["BUYER_JOURNEY_CONTROL_URL"],
      slug: process.env["BUYER_JOURNEY_PRODUCT_SLUG"],
    });
}
const freeChapter = "/materials/kak-ustroen-inside-platform";
const paidChapter = "/materials/developer-pipeline-bez-poteri-konteksta";
const freeBody =
  "Этот материал создаётся идемпотентным local seed через application interface.";
const paidBody = "Закрытое содержимое для участников.";
const accessRequired = '[data-material-reader-state="access-required"]';

async function signInWithTelegram(
  page: Page,
  telegramUserId: string,
  slug: string,
) {
  // Витрина продукта на телефоне без шапки (решение владельца 09.10.2026): гость входит со
  // страницы покупки, куда ведёт кнопка витрины.
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await expect(page.locator("[data-mobile-header]")).toBeHidden();
    await page.goto(`/products/${slug}/buy`);
    await page
      .getByRole("button", { name: "Войти и оплатить", exact: true })
      .click();
  } else {
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Тестовый провайдер входа" }),
  ).toBeVisible();
  await page.getByLabel("Telegram ID").fill(telegramUserId);
  await page.getByRole("button", { name: "Войти через Telegram" }).click();
  // Первый вход ведёт на экран условий использования; после принятия человек возвращается назад.
  const accept = page
    .locator("dialog:modal")
    .getByRole("button", { name: "Принять условия и продолжить" });
  await accept.click({ timeout: 30_000 });
  await page.waitForURL((url) => url.pathname !== "/welcome");
  // Вход завершён: вместо «Войти» у человека его аккаунт.
  const response = await fullStackBrowserRequest(page, "/auth/status");
  expect(response.ok()).toBe(true);
  const status = z.object({ state: z.string() }).parse(await response.json());
  expect(status.state).toBe("authenticated");
}

test("покупатель курса проходит путь от страницы продукта до материалов и общего чата", async ({
  page,
}, info) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const { slug } = stand();
  const telegramUserId =
    info.project.name === "mobile-chromium" ? "775000002" : "775000001";
  const email = `buyer-${telegramUserId}@inside.test`;

  // Страница курса открыта гостю.
  await page.goto(`/products/${slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();

  // Вход через Telegram.
  await signInWithTelegram(page, telegramUserId, slug);

  // Бесплатная глава открыта, закрытая — только описание с предложением купить продукт.
  await page.goto(freeChapter);
  await expect(page.getByText(freeBody).first()).toBeVisible();
  await expect(page.locator(accessRequired)).toHaveCount(0);
  await page.goto(paidChapter);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Developer Pipeline без потери контекста",
    }),
  ).toBeVisible();
  await expect(page.locator(accessRequired).first()).toBeVisible();
  await expect(page.getByText(paidBody)).toHaveCount(0);

  // Telegram buyer pays with an order email and never starts confirmation.
  const contactMutations: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.endsWith("/billing/contact/start") ||
      path.endsWith("/billing/contact/confirm")
    )
      contactMutations.push(path);
  });
  await page.goto(`/products/${slug}/buy`);
  const pay = page.getByRole("button", { name: /^Оплатить/u });
  await expect(pay).toBeEnabled();
  await pay.click();
  const emailInput = page.getByRole("textbox", { name: "Email для чека" });
  await expect(emailInput).toBeFocused();
  await expect(emailInput).toHaveAttribute("aria-invalid", "true");
  await emailInput.fill("broken");
  await pay.click();
  await expect(
    page.getByRole("form", { name: "Оплата продукта" }).getByRole("alert"),
  ).toContainText("Проверьте email");
  await emailInput.fill(email);
  await expect(emailInput).toHaveAttribute("aria-invalid", "false");
  expect(
    (
      await new AxeBuilder({ page })
        .include("form[aria-labelledby]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await prepareEvidenceDirectory("issue-1401");
  const cookieNotice = page.getByRole("button", {
    name: "Понятно",
    exact: true,
  });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  await emailInput.blur();
  await screenshotWholePage(page, {
    path: evidencePath("issue-1401", `${info.project.name}-checkout.png`),
  });
  await pay.click();
  await page.getByRole("button", { name: "Оплата прошла" }).click();

  // После оплаты материалы курса открыты.
  await expect
    .poll(
      async () => {
        await page.goto(paidChapter);
        return page.getByText(paidBody).count();
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator(accessRequired)).toHaveCount(0);

  // Выдано право на общий чат: покупка видна в кабинете, а её права — с условиями курса.
  await page.goto("/account/purchases");
  await expect(page.getByText("Общий чат").first()).toBeVisible();
  const billingResponse = await fullStackBrowserRequest(
    page,
    "/api/account/billing",
  );
  expect(billingResponse.ok()).toBe(true);
  const billing = z
    .object({
      value: z.object({
        grounds: z.array(
          z.object({
            source: z.string(),
            capabilities: z.array(z.string()),
            validUntil: z.string().nullable(),
            active: z.boolean(),
          }),
        ),
      }),
    })
    .parse(await billingResponse.json());
  const paid = billing.value.grounds.filter(
    (ground) => ground.source === "paid" && ground.active,
  );
  const termOf = (capability: string) =>
    paid.find((ground) => ground.capabilities.includes(capability))?.validUntil;
  // Материалы и общий чат — без срока, сопровождение — с датой окончания.
  expect(termOf("community")).toBeNull();
  expect(
    paid.some(
      (ground) =>
        ground.capabilities.some((value) => value.startsWith("product:")) &&
        ground.validUntil === null,
    ),
  ).toBe(true);
  expect(termOf("support")).toEqual(expect.any(String));
  const contactResponse = await fullStackBrowserRequest(
    page,
    "/api/account/billing/contact",
  );
  expect(
    z.object({ contact: z.null() }).parse(await contactResponse.json()).contact,
  ).toBeNull();
  expect(contactMutations).toEqual([]);
  expect(browserErrors).toEqual([]);
});
