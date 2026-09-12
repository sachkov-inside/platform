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
    route.fulfill({ json: { canManageMaterials: false, state: "authenticated" } }),
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
      json: { ok: true, value: { subscription, notices: [], grounds, payments: [] } },
    }),
  );
  await page.route("**/api/account/billing/contact", (route) =>
    route.fulfill({ json: { ok: true, contact: contact(), documents: [] } }),
  );
  await page.route("**/api/account/notifications/preferences", (route) =>
    route.fulfill({
      json: { ok: true, preferences: { revision: 2, email: false, telegram: false } },
    }),
  );
}

function cabinetNavigation(page: Page, mode: "desktop" | "mobile") {
  return page.locator(`[data-account-section-nav="${mode}"]`);
}

function navigationMode(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") return "desktop";
  if (projectName === "mobile-chromium") return "mobile";
  throw new Error(`No navigation mode configured for ${projectName}`);
}

test("прежний адрес формы email открывает раздел «Покупки»", async ({ page }) => {
  await stubAccount(page);

  const response = await page.goto("/account/email");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/account\/purchases$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");
  await expect(
    page.getByRole("heading", { name: "Email для чеков и сообщений" }),
  ).toBeVisible();
});

test("каждый раздел решает одну задачу", async ({ page }) => {
  await stubAccount(page, { grounds: [paidGround], subscription: activeSubscription });

  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Профиль");
  await expect(page.getByText("Telegram подключён")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toHaveCount(0);

  await page.goto("/account/access");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Аккаунт");
  await expect(page.getByText("Telegram подключён")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  // Продающий блок ушёл из кабинета вместе с внешней ссылкой на Tribute.
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveCount(0);

  await page.goto("/account/purchases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");
  await expect(page.getByText("Оплаченный доступ")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toHaveCount(0);

  await page.goto("/account/notifications");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Уведомления");
  await expect(page.getByRole("checkbox", { name: /Email/u })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();
});

test("кабинет полезен без подписки и не предлагает её раздел", async ({
  page,
}, testInfo) => {
  const mode = navigationMode(testInfo.project.name);
  await stubAccount(page);

  await page.goto("/account/purchases");

  const navigation = cabinetNavigation(page, mode);
  if (mode === "mobile")
    await page.getByRole("button", { name: /Личный кабинет/u }).click();
  await expect(navigation.getByRole("link", { name: /Покупки/u })).toBeVisible();
  await expect(navigation.getByRole("link", { name: /Подписка/u })).toHaveCount(0);
  await expect(
    page.getByText("Действующих оснований доступа нет."),
  ).toBeVisible();
});

test("раздел «Подписка» появляется, когда подписка уже есть", async ({
  page,
}, testInfo) => {
  const mode = navigationMode(testInfo.project.name);
  await stubAccount(page, { grounds: [paidGround], subscription: activeSubscription });

  await page.goto("/account/purchases");

  const navigation = cabinetNavigation(page, mode);
  if (mode === "mobile")
    await page.getByRole("button", { name: /Личный кабинет/u }).click();
  const subscription = navigation.getByRole("link", { name: /Подписка/u });
  await expect(subscription).toBeVisible();

  await subscription.click();

  // Первый заход в раздел компилируется dev-сервером, поэтому барьер здесь шире обычного.
  await expect(page).toHaveURL(/\/account\/subscription$/u, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Подписка");
});

test("завершённая подписка не возвращает раздел «Подписка»", async ({
  page,
}, testInfo) => {
  const mode = navigationMode(testInfo.project.name);
  await stubAccount(page, {
    grounds: [],
    subscription: { ...activeSubscription, state: "ended" },
  });

  await page.goto("/account/purchases");

  const navigation = cabinetNavigation(page, mode);
  if (mode === "mobile")
    await page.getByRole("button", { name: /Личный кабинет/u }).click();
  await expect(navigation.getByRole("link", { name: /Покупки/u })).toBeVisible();
  await expect(navigation.getByRole("link", { name: /Подписка/u })).toHaveCount(0);
});

test("оболочка напоминает о неподключённом Telegram", async ({ page }, testInfo) => {
  const mode = navigationMode(testInfo.project.name);
  await stubAccount(page, { telegram: "unlinked" });

  await page.goto(mode === "desktop" ? "/account/purchases" : "/");

  if (mode === "desktop") {
    const reminder = page.getByRole("button", {
      name: "Telegram не подключён. Подключить",
    });
    await expect(reminder).toBeVisible();

    // Окно открывается поверх текущей страницы: маршрут не меняется.
    await page.getByRole("button", { name: "Закрыть подключение Telegram" }).click();
    await reminder.click();

    await expect(
      page.getByRole("heading", { name: "Подключите Telegram" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/account\/purchases$/u);
  } else {
    await expect(
      page
        .getByRole("navigation", { name: "Мобильная навигация" })
        .getByRole("link", { name: "Профиль" })
        .locator("span[aria-hidden='true']"),
    ).toHaveCount(1);
  }
});

test("подключённый Telegram не оставляет напоминания", async ({ page }, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");
  await stubAccount(page);

  await page.goto("/account/purchases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");

  await expect(
    page.getByRole("button", { name: "Telegram не подключён. Подключить" }),
  ).toHaveCount(0);
});

test("список разделов на телефоне открывается и закрывается сам", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "mobile");
  await stubAccount(page);
  await page.goto("/account");

  const disclosure = page.getByRole("button", { name: /Личный кабинет/u });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");

  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await cabinetNavigation(page, "mobile")
    .getByRole("link", { name: /Уведомления/u })
    .click();

  await expect(page).toHaveURL(/\/account\/notifications$/u);
  await expect(
    page.getByRole("button", { name: /Личный кабинет/u }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("кабинет не имеет серьёзных нарушений доступности", async ({ page }) => {
  await stubAccount(page, { grounds: [paidGround], subscription: activeSubscription });
  await page.goto("/account/purchases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");

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

const verifiedContact = {
  email: "buyer@example.test",
  revision: 1,
  verifiedAt: "2026-09-12T10:00:00.000Z",
};

/** Состояние контакта на весь сценарий: подтверждение меняет ответ для всех поверхностей. */
function contactState() {
  const state = { verified: false };
  return {
    read: () => (state.verified ? verifiedContact : null),
    confirm: () => {
      state.verified = true;
    },
  };
}

/** Поверхность, где подтверждают адрес: письмо и код заменены закрытыми ответами BFF. */
async function confirmContactOn(page: Page, state: ReturnType<typeof contactState>) {
  await page.route("**/api/account/billing/contact/start", (route) =>
    route.fulfill({
      json: {
        ok: true,
        challengeRef: "00000000-0000-4000-8000-000000000901",
        expiresAt: "2026-09-12T11:00:00.000Z",
        delivery: "sent",
      },
    }),
  );
  await page.route("**/api/account/billing/contact/confirm", (route) => {
    state.confirm();
    void route.fulfill({ json: { ok: true, revision: verifiedContact.revision } });
  });
  await page.goto("/account/purchases");
  await page.getByLabel("Email", { exact: true }).fill(verifiedContact.email);
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  await page.getByLabel("Код из письма").fill("123456");
  await page
    .getByRole("button", { name: "Подтвердить email", exact: true })
    .click();
  await expect(page.getByText("Email подтверждён.", { exact: true })).toBeVisible();
}

test("подтверждение обновляет кабинет, открытый второй поверхностью", async ({
  page,
  context,
}) => {
  const state = contactState();
  await stubAccount(page, { contact: state.read });

  // Кабинет открыт заранее и остаётся открытым: подтверждение произойдёт не в нём.
  await page.goto("/account/purchases");
  await expect(page.getByText("Email пока не подтверждён.")).toBeVisible();

  const other = await context.newPage();
  await stubAccount(other, { contact: state.read });
  await confirmContactOn(other, state);

  // Первый экран после письма не должен спорить с только что подтверждённым адресом.
  await expect(page.getByText(verifiedContact.email, { exact: true })).toBeVisible();
  await expect(page.getByText("Email пока не подтверждён.")).toHaveCount(0);
});

test("подтверждение перечитывает контакт на витрине и в разделе подписки", async ({
  context,
}) => {
  const state = contactState();
  const reads = { buy: 0, subscription: 0 };
  const listening = async (route: "buy" | "subscription", path: string) => {
    const page = await context.newPage();
    await stubAccount(page, {
      contact: () => {
        reads[route] += 1;
        return state.read();
      },
    });
    await page.goto(path);
    // Первое чтение состоялось: дальше считаем только перечитывание.
    await expect.poll(() => reads[route]).toBe(1);
    return page;
  };

  // Витрина руководства читает контакт для оформления, раздел подписки — редакции документов.
  await listening("buy", "/guides/platform-inside/buy");
  await listening("subscription", "/account/subscription");

  const cabinet = await context.newPage();
  await stubAccount(cabinet, { contact: state.read });
  await confirmContactOn(cabinet, state);

  await expect.poll(() => reads.buy).toBe(2);
  await expect.poll(() => reads.subscription).toBe(2);
});

test("без объявлений подтвердившая поверхность обновляется сама", async ({ page }) => {
  const state = contactState();
  await stubAccount(page, { contact: state.read });
  // Браузер без BroadcastChannel: соседние поверхности такое подтверждение не услышат, но та,
  // где его совершили, обязана показать адрес и здесь.
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  });

  await confirmContactOn(page, state);

  await expect(page.getByText(verifiedContact.email, { exact: true })).toBeVisible();
  await expect(page.getByText("Email пока не подтверждён.")).toHaveCount(0);
});
