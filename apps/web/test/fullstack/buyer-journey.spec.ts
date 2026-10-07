import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { fullStackBrowserRequest } from "../support/full-stack-session";

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

async function signInWithTelegram(page: Page, telegramUserId: string) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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
  const { controlUrl, slug } = stand();
  const telegramUserId =
    info.project.name === "mobile-chromium" ? "775000002" : "775000001";
  const email = `buyer-${telegramUserId}@inside.test`;

  // Страница курса открыта гостю.
  await page.goto(`/products/${slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();

  // Вход через Telegram.
  await signInWithTelegram(page, telegramUserId);

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

  // Покупка на тестовом терминале: чек уходит на подтверждённый email.
  await page.goto(`/products/${slug}/buy`);
  await page.getByRole("link", { name: "Подтвердить его в кабинете" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  await page.getByLabel("Код из письма").waitFor();
  const codeResponse = await page.request.get(
    `${controlUrl}/control/contact-code?email=${encodeURIComponent(email)}`,
  );
  expect(codeResponse.status()).toBe(200);
  const { code } = z
    .object({ code: z.string() })
    .parse(await codeResponse.json());
  await page.getByLabel("Код из письма").fill(code);
  await page
    .getByRole("button", { name: "Подтвердить email", exact: true })
    .click();
  await expect(
    page.getByText("Email подтверждён.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/products/${slug}/buy`);
  await page.getByRole("button", { name: /^Оплатить/u }).click();
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
  expect(browserErrors).toEqual([]);
});
