import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const paidGround = {
  source: "paid",
  capabilities: ["materials"],
  startsAt: "2026-09-01T00:00:00.000Z",
  validUntil: "2026-10-01T00:00:00.000Z",
  active: true,
};

async function stubAccount(
  page: Page,
  {
    products = [],
    payments = [],
    grounds = [],
    telegram = "linked",
    contact = () => null,
  }: {
    products?: readonly unknown[];
    payments?: readonly unknown[];
    grounds?: readonly unknown[];
    telegram?: "linked" | "unlinked";
    /** Контакт читается на каждый запрос: подтверждение меняет ответ, а не только первый снимок. */
    contact?: () => unknown;
  } = {},
) {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { canManageMaterials: false, state: "authenticated" },
    }),
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        profile: { kind: "missing" },
        telegramMembership: {
          link: { kind: telegram },
          membership: { kind: "active" },
        },
      },
    }),
  );
  await page.route("**/api/account/billing", (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: { products, notices: [], access: { grounds }, payments },
      },
    }),
  );
  await page.route("**/api/account/billing/contact", (route) =>
    route.fulfill({ json: { ok: true, contact: contact(), documents: [] } }),
  );
  await page.route("**/api/account/notifications/preferences", (route) =>
    route.fulfill({
      json: {
        ok: true,
        preferences: { revision: 2, email: false, telegram: false },
      },
    }),
  );
}

test("единый кабинет оставляет Telegram и документы без профиля и меню", async ({
  page,
}) => {
  await stubAccount(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Telegram подключён")).toBeVisible();
  await expect(page.locator("[data-account-section-nav]")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Имя", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Подписка", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Покупки и оплаты", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  await page.getByText("Документы", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Принятые документы" }),
  ).toBeVisible();
});

for (const [path, hash] of [
  ["access", ""],
  ["notifications", ""],
  ["purchases", "#purchases"],
  ["email", "#purchases"],
] as const) {
  test(`старый адрес ${path} открывает единый кабинет`, async ({ page }) => {
    await stubAccount(page);
    await page.goto(`/account/${path}`);
    await expect(page).toHaveURL(new RegExp(`/account${hash}$`, "u"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Личный кабинет",
    );
  });
}

test("неподключённый Telegram предлагает подключение в кабинете", async ({
  page,
}) => {
  await stubAccount(page, { telegram: "unlinked" });
  await page.goto("/account");
  await expect(
    page
      .getByRole("region", { name: "Telegram", exact: true })
      .getByRole("button", { name: "Подключить", exact: true }),
  ).toBeVisible();
});

test("сбой Telegram не прячет документы и выход", async ({ page }) => {
  await stubAccount(page);
  await page.route("**/api/account", (route) => route.fulfill({ status: 503 }));
  await page.goto("/account");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Не удалось загрузить аккаунт." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  await page.getByText("Документы", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Принятые документы" }),
  ).toBeVisible();
});

test("историческая подписка не возвращает управление подпиской в кабинет", async ({
  page,
}) => {
  await stubAccount(page, {
    grounds: [paidGround],
    payments: [
      {
        purchaseRef: "00000000-0000-4000-8000-000000000501",
        kind: "renewal",
        state: "confirmed",
        amountKopecks: 100000,
        offerName: "Исторические материалы",
        months: 1,
        fiscalization: "confirmed",
        confirmedAt: "2026-09-01T00:00:00Z",
        periodEndsAt: "2026-10-01T00:00:00Z",
        createdAt: "2026-09-01T00:00:00Z",
        refundedKopecks: 0,
        refundedAt: null,
      },
    ],
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Подписка", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Привязать другую карту" }),
  ).toHaveCount(0);
});

test("кабинет не имеет серьёзных нарушений доступности и переполнения", async ({
  page,
}) => {
  await stubAccount(page);
  await page.goto("/account");
  await expect(page.getByText("Telegram подключён")).toBeVisible();
  await page.getByText("Документы", { exact: true }).click();
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page
      .locator("html")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
});

for (const [state, label] of [
  ["available", "Доступ открыт"],
  ["revoked", "Доступ отозван"],
] as const) {
  test(`кабинет сохраняет lifetime Product ${state} без подписки`, async ({
    page,
  }) => {
    const productId = "00000000-0000-4000-8000-000000000701";
    await stubAccount(page, {
      products: [
        {
          id: productId,
          name: "Инженерная практика",
          slug: "engineering-practice",
          materials: { state },
          community: { state },
        },
      ],
    });
    await page.goto("/account");
    const card = page.locator(`[data-account-product="${productId}"]`);
    await expect(
      card.getByRole("heading", { name: "Инженерная практика" }),
    ).toBeVisible();
    await expect(card.getByText(label, { exact: true })).toBeVisible();
    if (state === "revoked")
      await expect(
        card.getByRole("link", { name: "Открыть продукт" }),
      ).toHaveCount(0);
    else
      await expect(
        card.getByRole("link", { name: "Открыть продукт" }),
      ).toHaveAttribute("href", "/products/engineering-practice/programme");
    await expect(
      page.getByRole("heading", { name: "Подписка", exact: true }),
    ).toHaveCount(0);
  });
}

test("возврат во вкладку не прячет продолжение обучения, пока вход перепроверяется", async ({
  page,
}) => {
  await stubAccount(page);
  // Первая проверка входа отвечает сразу, повторная ждёт, пока тест её не отпустит: всё время
  // перепроверки на экране должно оставаться то, что уже известно.
  let statusChecks = 0;
  let releaseRecheck: (() => void) | undefined;
  await page.route("**/auth/status", async (route) => {
    statusChecks += 1;
    if (statusChecks > 1) {
      await new Promise<void>((release) => {
        releaseRecheck = release;
      });
    }
    await route.fulfill({
      json: {
        accountId: "00000000-0000-4000-8000-000000000701",
        canManageMaterials: false,
        state: "authenticated",
      },
    });
  });
  await page.route("**/api/personal-home", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        continuation: {
          product: {
            collection: {
              count: 4,
              cover: null,
              id: "00000000-0000-4000-8000-000000000702",
              name: "Инженерия ИИ",
              previewItems: [],
              slug: "ai-engineering",
              summary: null,
            },
            read: 1,
            total: 4,
          },
        },
      },
    }),
  );

  await page.goto("/account");
  const continuation = page.getByRole("heading", {
    name: "Продолжить обучение",
  });
  await expect(continuation).toBeVisible();
  await page.evaluate(() => {
    const record = window as Window & { learningContinuationLost?: boolean };
    record.learningContinuationLost = false;
    new MutationObserver(() => {
      if (document.getElementById("account-learning") === null) {
        record.learningContinuationLost = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(() => releaseRecheck !== undefined).toBe(true);
  const recheckAnswered = page.waitForResponse("**/auth/status");
  releaseRecheck?.();
  await recheckAnswered;

  await expect(continuation).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { learningContinuationLost?: boolean })
          .learningContinuationLost,
    ),
    "блок не пропадал, пока вход перепроверялся",
  ).toBe(false);
});
