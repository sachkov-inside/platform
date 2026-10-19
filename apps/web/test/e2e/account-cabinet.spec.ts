import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const activeSubscription = {
  subscriptionRef: "00000000-0000-4000-8000-000000000501",
  revision: 7,
  state: "active",
  snapshot: {
    offer: {
      id: "00000000-0000-4000-8000-000000000101",
      revision: 3,
      name: "Материалы",
      benefits: ["materials"],
      archived: false,
    },
    paymentOption: {
      id: "00000000-0000-4000-8000-000000000201",
      revision: 2,
      offerId: "00000000-0000-4000-8000-000000000101",
      mode: "subscription",
      months: 1,
      priceKopecks: 100_000,
      archived: false,
    },
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
};

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
    subscription = null,
    grounds = [],
    telegram = "linked",
    contact = () => null,
  }: {
    subscription?: unknown;
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
        value: { subscription, notices: [], grounds, payments: [] },
      },
    }),
  );
  await page.route("**/api/account/billing/enrollments", (route) =>
    route.fulfill({ json: { ok: true, value: { items: [] } } }),
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
  ["subscription", "#subscription"],
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
      .filter({ hasText: "Состояние аккаунта сейчас недоступно." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  await page.getByText("Документы", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Принятые документы" }),
  ).toBeVisible();
});

test("сбой представления Telegram не блокирует управление подпиской", async ({
  page,
}) => {
  await stubAccount(page, {
    subscription: activeSubscription,
    grounds: [paidGround],
  });
  await page.route("**/api/account", (route) => route.fulfill({ status: 503 }));
  await page.goto("/account");
  await expect(
    page.getByText("Состояние аккаунта сейчас недоступно."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toBeEnabled();
  await page.getByText("Покупки и оплаты", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Привязать другую карту" }),
  ).toBeEnabled();
});

test("завершённая подписка остаётся в истории без блока управления", async ({
  page,
}) => {
  await stubAccount(page, {
    subscription: { ...activeSubscription, state: "ended" },
  });
  await page.goto("/account");
  await expect(
    page.getByText("Покупки и оплаты", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Подписка", exact: true }),
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

function renewalState() {
  const state = { canceled: false };
  const canceled = {
    ...activeSubscription,
    revision: activeSubscription.revision + 1,
    state: "canceled",
  };
  const billing = () => ({
    ok: true,
    value: {
      subscription: state.canceled ? canceled : activeSubscription,
      notices: [],
      grounds: [paidGround],
      payments: [],
    },
  });
  return async (page: Page) => {
    await stubAccount(page, {
      grounds: [paidGround],
      subscription: activeSubscription,
    });
    await page.route("**/api/account/billing", (route) =>
      route.fulfill({ json: billing() }),
    );
    await page.route("**/api/account/billing/subscription/cancel", (route) => {
      state.canceled = true;
      void route.fulfill({ json: { ok: true, value: canceled } });
    });
  };
}

test("отмена продления меняет раздел «Подписка», открытый второй поверхностью", async ({
  page,
  context,
}) => {
  const stubRenewal = renewalState();
  await stubRenewal(page);

  // Раздел открыт заранее и остаётся открытым: отмена произойдёт не в нём.
  await page.goto("/account/subscription");
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toBeEnabled();

  const other = await context.newPage();
  await stubRenewal(other);
  await other.goto("/account/subscription");
  await other.getByRole("button", { name: "Отменить продление" }).click();
  await expect(
    other.getByRole("button", { name: "Возобновить автопродление" }),
  ).toBeVisible();

  // Первый раздел не должен предлагать отменить уже отменённое продление.
  await expect(
    page.getByRole("button", { name: "Возобновить автопродление" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toHaveCount(0);
});

test("начатая привязка карты видна в разделе «Покупки», открытом второй поверхностью", async ({
  page,
  context,
}) => {
  // Команда не возвращает нового вида подписки: обе поверхности узнают о привязке только
  // перечитыванием, а соседняя — только по объявлению.
  const state = { started: false };
  const flowRef = "00000000-0000-4000-8000-000000000701";
  const stubMethod = async (target: Page) => {
    await stubAccount(target, {
      grounds: [paidGround],
      subscription: activeSubscription,
    });
    await target.route("**/api/account/billing", (route) =>
      route.fulfill({
        json: {
          ok: true,
          value: {
            subscription: {
              ...activeSubscription,
              pendingMethodChange: state.started
                ? { flowRef, formUrl: null }
                : null,
            },
            notices: [],
            grounds: [paidGround],
            payments: [],
          },
        },
      }),
    );
    await target.route(
      "**/api/account/billing/payment-method/change",
      (route) => {
        state.started = true;
        void route.fulfill({
          json: {
            ok: true,
            value: {
              flowRef,
              formUrl: null,
              methodRef: null,
              state: "started",
            },
          },
        });
      },
    );
  };
  const started = /Начата привязка нового способа оплаты/u;

  await stubMethod(page);
  await page.goto("/account");
  await page.getByText("Покупки и оплаты", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Привязать другую карту" }),
  ).toBeEnabled();
  await expect(page.getByText(started)).toHaveCount(0);

  const other = await context.newPage();
  await stubMethod(other);
  await other.goto("/account");
  await other.getByText("Покупки и оплаты", { exact: true }).click();
  await other.getByRole("button", { name: "Привязать другую карту" }).click();
  await expect(other.getByText(started)).toBeVisible();

  await expect(page.getByText(started)).toBeVisible();
});

for (const [state, label] of [
  ["scheduled", "Начнётся позже"],
  ["expired", "Срок завершён"],
  ["revoked", "Отозвано"],
] as const) {
  test(`назначение ${state} доступно из профиля без платёжной подписки`, async ({
    page,
  }) => {
    await stubAccount(page);
    await page.route("**/api/account/billing/enrollments", (route) =>
      route.fulfill({
        json: {
          ok: true,
          value: {
            items: [
              {
                id: "00000000-0000-4000-8000-000000000624",
                accountId: "00000000-0000-4000-8000-000000000625",
                tier: {
                  id: "00000000-0000-4000-8000-000000000626",
                  revision: 1,
                  name: "История тарифа",
                  benefits: ["community"],
                  coverage: { productIds: [], materialIds: [] },
                },
                origin: "manual",
                startsAt: "2030-01-01T00:00:00.000Z",
                endsAt: "2030-02-01T00:00:00.000Z",
                endPolicy: "fixed",
                revision: 1,
                state,
                renewal: "not_applicable",
                nextChargeAt: null,
              },
            ],
          },
        },
      }),
    );
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "История тарифа", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").getByText(label, { exact: true }),
    ).toBeVisible();
  });
}
