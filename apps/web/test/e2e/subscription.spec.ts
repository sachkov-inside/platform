import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const offer = {
  id: "00000000-0000-4000-8000-000000000101",
  revision: 3,
  name: "Материалы",
  benefits: ["materials"],
  archived: false,
};
const paymentOption = {
  id: "00000000-0000-4000-8000-000000000201",
  revision: 2,
  offerId: offer.id,
  mode: "subscription",
  months: 1,
  priceKopecks: 100_000,
  archived: false,
};
async function stubBilling(page: Page, billing: unknown, status = 200) {
  await page.route("**/api/account/billing", (route) =>
    route.fulfill({ json: billing, status }),
  );
  await page.route("**/api/account/billing/contact", (route) =>
    route.fulfill({
      json: { ok: true, contact: null, documents: [] },
    }),
  );
}

test("витрина отвечает и объясняет недоступность каталога", async ({ page }) => {
  const response = await page.goto("/subscription");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Подписка Sachkov Inside",
  );
  await expect(page.getByRole("status")).toContainText("Тарифы сейчас недоступны");
});

test("витрина сохраняет исходную страницу руководства", async ({ page }) => {
  await page.goto("/subscription?from=%2Fguides%2Fplatform-inside");

  await expect(
    page.getByRole("link", { name: "Вернуться к материалу" }),
  ).toHaveAttribute("href", "/guides/platform-inside");
});

test("витрина не имеет серьёзных нарушений доступности", async ({ page }) => {
  await page.goto("/subscription");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("возврат из банка не выдаётся за подтверждение оплаты", async ({
  page,
}) => {
  const response = await page.goto("/subscription/return");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Возвращаемся из банка",
  );
  await expect(
    page.getByText("Переход обратно не подтверждает оплату"),
  ).toBeVisible();
  await expect(
    page.getByText("Не нашли начатую оплату в этом браузере."),
  ).toBeVisible();
});

test("кабинет просит войти без действующей сессии", async ({ page }) => {
  await stubBilling(page, { ok: false, code: "unauthorized" }, 401);
  const response = await page.goto("/account/subscription");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Платёжный кабинет",
  );
  await expect(
    page.locator("#content").getByRole("button", { name: "Войти" }).first(),
  ).toBeVisible();
});

test("кабинет показывает оплаченный срок и следующее списание", async ({
  page,
}) => {
  await stubBilling(page, {
    ok: true,
    value: {
      subscription: {
        subscriptionRef: "00000000-0000-4000-8000-000000000501",
        revision: 7,
        state: "active",
        snapshot: {
          offer,
          paymentOption,
          currency: "RUB",
          timezone: "Europe/Moscow",
          renewalPriceKopecks: 100_000,
        },
        periodStartsAt: "2026-09-01T00:00:00.000Z",
        paidUntil: "2026-10-01T00:00:00.000Z",
        periodAmountKopecks: 100_000,
        periodIndex: 1,
        paymentMethod: {
          methodRef: "00000000-0000-4000-8000-000000000601",
          revoked: false,
        },
        pendingChange: null,
        pendingMethodChange: null,
        inFlightPayment: null,
      },
      notices: [],
      grounds: [
        {
          source: "paid",
          capabilities: ["materials"],
          startsAt: "2026-09-01T00:00:00.000Z",
          validUntil: "2026-10-01T00:00:00.000Z",
          active: true,
        },
      ],
      payments: [],
    },
  });
  await page.goto("/account/subscription");

  await expect(page.getByText("Действует")).toBeVisible();
  await expect(page.getByText("Оплаченная подписка")).toBeVisible();
  await expect(page.getByText("1 октября 2026 г.").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toBeEnabled();
});
