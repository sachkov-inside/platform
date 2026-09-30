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

test("витрина отвечает и объясняет недоступность каталога", async ({
  page,
}) => {
  const response = await page.goto("/subscription");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Подписка Sachkov Inside",
  );
  await expect(page.getByRole("status")).toContainText(
    "Тарифы сейчас недоступны",
  );
});

test("витрина сохраняет исходную страницу продукта", async ({ page }) => {
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

const returnedPurchaseRef = "00000000-0000-4000-8000-000000000701";
const courseOffer = {
  ...offer,
  name: "AI Engineering",
  benefits: ["guide:00000000-0000-4000-8000-000000000801", "community"],
};

async function returnFromBank(
  page: Page,
  access: "awaiting_payment" | "ready",
  entry: unknown,
) {
  await page.addInitScript((purchaseRef) => {
    window.sessionStorage.setItem("inside.billing.purchase", purchaseRef);
  }, returnedPurchaseRef);
  await page.route("**/api/account/billing/purchase-status**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: {
          purchaseRef: returnedPurchaseRef,
          state: access === "ready" ? "confirmed" : "pending",
          paymentUrl: null,
          snapshot: {
            offer: courseOffer,
            paymentOption: { ...paymentOption, mode: "one_time" },
            promotion: null,
            currency: "RUB",
            timezone: "Europe/Moscow",
            firstPriceKopecks: 100_000,
            renewalPriceKopecks: 100_000,
          },
          access,
          fiscalization: "confirmed",
          confirmedAt: access === "ready" ? "2026-09-30T10:00:00.000Z" : null,
          periodEndsAt: null,
        },
      },
    }),
  );
  await page.route("**/api/account/community-entry", (route) =>
    route.fulfill({ json: { ok: true, value: entry } }),
  );
}

test("после оплаты курса с сообществом виден переход в бота", async ({
  page,
}) => {
  await returnFromBank(page, "ready", {
    kind: "join",
    botUrl: "https://t.me/inside_e2e_bot",
  });
  await page.goto("/subscription/return");

  await expect(page.getByText("Оплата подтверждена")).toBeVisible();
  const community = page.getByRole("region", { name: "Сообщество Inside" });
  // Бот понимает обычный /start: ссылка не вводит новых параметров.
  await expect(
    community.getByRole("link", { name: "Вступить в сообщество" }),
  ).toHaveAttribute("href", "https://t.me/inside_e2e_bot");

  const results = await new AxeBuilder({ page })
    .include("section[aria-labelledby='community-entry-title']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("участник сообщества после оплаты не зовётся вступать повторно", async ({
  page,
}) => {
  await returnFromBank(page, "ready", { kind: "member" });
  await page.goto("/subscription/return");

  const community = page.getByRole("region", { name: "Сообщество Inside" });
  await expect(community).toContainText("Вы уже в сообществе Inside");
  await expect(community.getByRole("link")).toHaveCount(0);
});

test("до подтверждения оплаты переход в сообщество не показывается", async ({
  page,
}) => {
  await returnFromBank(page, "awaiting_payment", {
    kind: "join",
    botUrl: "https://t.me/inside_e2e_bot",
  });
  await page.goto("/subscription/return");

  await expect(page.getByText("Ждёт подтверждения оплаты")).toBeVisible();
  await expect(page.getByText("Сообщество Inside")).toHaveCount(0);
});

test("раздел подписки просит войти без действующей сессии", async ({
  page,
}) => {
  await stubBilling(page, { ok: false, code: "unauthorized" }, 401);
  const response = await page.goto("/account/subscription");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Подписка");
  await expect(
    page.locator("#content").getByRole("button", { name: "Войти" }).first(),
  ).toBeVisible();
});

test("раздел подписки показывает оплаченный срок и следующее списание", async ({
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
  await expect(page.getByText("1 октября 2026 г.").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toBeEnabled();
  // Основания доступа и способ оплаты — задача раздела «Покупки».
  await expect(page.getByText("Оплаченный доступ")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Способ оплаты" }),
  ).toHaveCount(0);
});
