import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { notificationErrorMessage } from "@/features/notification-preferences";

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

function cabinetNavigation(page: Page, mode: "desktop" | "mobile") {
  return page.locator(`[data-account-section-nav="${mode}"]`);
}

function navigationMode(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") return "desktop";
  if (projectName === "mobile-chromium") return "mobile";
  throw new Error(`No navigation mode configured for ${projectName}`);
}

test("прежний адрес формы email открывает раздел «Покупки»", async ({
  page,
}) => {
  await stubAccount(page);

  const response = await page.goto("/account/email");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/account\/purchases$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");
  await expect(
    page.getByRole("heading", { name: "Email для чеков и сообщений" }),
  ).toHaveCount(0);
});

test("покупки не требуют подтверждать email", async ({ page }) => {
  let contactReads = 0;
  await stubAccount(page, {
    contact: () => {
      contactReads += 1;
      return null;
    },
  });
  await page.goto("/account/purchases");
  await expect(
    page.getByRole("heading", { level: 1, name: "Покупки" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Получить код", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Действующих оснований доступа нет."),
  ).toBeVisible();
  expect(contactReads).toBe(0);
});

test("каждый раздел решает одну задачу", async ({ page }) => {
  await stubAccount(page, {
    grounds: [paidGround],
    subscription: activeSubscription,
  });

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
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveCount(
    0,
  );

  await page.goto("/account/purchases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");
  await expect(page.getByText("Оплаченный доступ")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Способ оплаты" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отменить продление" }),
  ).toHaveCount(0);

  await page.goto("/account/notifications");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Уведомления",
  );
  await expect(
    page.getByRole("checkbox", { name: /Email/u }),
  ).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();
});

for (const entry of [
  { kind: "link_telegram" },
  { kind: "join", botUrl: "https://t.me/inside_test_bot" },
  { kind: "member", groupUrl: "https://t.me/c/1234567890/1" },
]) {
  test(`покупки не показывают глобальную группу (${entry.kind})`, async ({
    page,
  }) => {
    await stubAccount(page, { grounds: [paidGround] });
    let communityReads = 0;
    await page.route("**/api/account/community-entry**", (route) => {
      communityReads += 1;
      return route.fulfill({ json: { ok: true, value: entry } });
    });
    await page.goto("/account/purchases");
    await expect(
      page.getByRole("heading", { level: 1, name: "Покупки" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Сообщество Inside" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Открыть группу" }),
    ).toHaveCount(0);
    await expect(page.getByText("Оплаченный доступ")).toBeVisible();
    expect(communityReads).toBe(0);
  });
}

test("покупки называют продукт и ведут в его программу", async ({ page }) => {
  await stubAccount(page, {
    grounds: [
      {
        ...paidGround,
        capabilities: ["product:00000000-0000-4000-8000-000000000801"],
        validUntil: null,
        content: [
          {
            kind: "product",
            id: "00000000-0000-4000-8000-000000000801",
            title: "Создание Platform Inside",
            slug: "platform-inside",
            available: true,
          },
        ],
      },
    ],
  });
  await page.goto("/account/purchases");
  await expect(
    page.getByRole("heading", { name: "Создание Platform Inside" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть продукт", exact: true }),
  ).toHaveAttribute("href", "/products/platform-inside/programme");
  await expect(
    page.getByRole("heading", { name: "Способ оплаты" }),
  ).toHaveCount(0);
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
  await expect(
    navigation.getByRole("link", { name: /Покупки/u }),
  ).toBeVisible();
  await expect(navigation.getByRole("link", { name: /Подписка/u })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Действующих оснований доступа нет."),
  ).toBeVisible();
});

test("раздел «Подписка» появляется, когда подписка уже есть", async ({
  page,
}, testInfo) => {
  const mode = navigationMode(testInfo.project.name);
  await stubAccount(page, {
    grounds: [paidGround],
    subscription: activeSubscription,
  });

  await page.goto("/account/purchases");

  const navigation = cabinetNavigation(page, mode);
  if (mode === "mobile")
    await page.getByRole("button", { name: /Личный кабинет/u }).click();
  const subscription = navigation.getByRole("link", { name: /Подписка/u });
  await expect(subscription).toBeVisible();

  await subscription.click();

  await expect(page).toHaveURL(/\/account\/subscription$/u);
  // Сразу после смены адреса прежний раздел может ещё стоять на экране: ждём заголовок нового.
  await expect(
    page.getByRole("heading", { level: 1, name: "Подписка" }),
  ).toBeVisible();
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
  await expect(
    navigation.getByRole("link", { name: /Покупки/u }),
  ).toBeVisible();
  await expect(navigation.getByRole("link", { name: /Подписка/u })).toHaveCount(
    0,
  );
});

const telegramReminderTest = test.extend({ video: "retain-on-failure" });

telegramReminderTest(
  "оболочка напоминает о неподключённом Telegram",
  async ({ page }, testInfo) => {
    const mode = navigationMode(testInfo.project.name);
    await stubAccount(page, { telegram: "unlinked" });

    await page.goto(mode === "desktop" ? "/account/purchases" : "/");

    const header = page.locator(
      mode === "desktop" ? "[data-public-header]" : "[data-mobile-header]",
    );
    await expect(
      header.getByRole("button", { name: "Подключить Telegram" }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Аккаунт", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
);

test("подключённый Telegram не оставляет напоминания", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");
  await stubAccount(page);

  await page.goto("/account/purchases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупки");

  await expect(
    page.getByRole("button", { name: "Подключить Telegram" }),
  ).toHaveCount(0);
});

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
          series: {
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
  await stubAccount(page, {
    grounds: [paidGround],
    subscription: activeSubscription,
  });
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

// Email verification no longer belongs to Purchases. Module tests cover its BFF commands;
// Storybook covers form presentation. The retired panel announcement scenarios were removed.
// Product onboarding and order-email validation run against real Next/Nest/PostgreSQL
// in test/fullstack/buyer-journey.spec.ts and the Product onboarding Storybook states.

/**
 * Состояние покупателя на весь сценарий: отмена продления меняет ответ для всех поверхностей.
 * Маршруты регистрируются после `stubAccount` и поэтому отвечают раньше его снимка.
 */
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

/** Настройки каналов на весь сценарий: сохранение меняет ответ для всех поверхностей. */
function channelsState() {
  const state = { revision: 2, email: false };
  const read = () => ({
    ok: true,
    preferences: {
      revision: state.revision,
      email: state.email,
      telegram: false,
    },
  });
  return async (page: Page) => {
    await stubAccount(page);
    await page.route("**/api/account/notifications/preferences", (route) =>
      route.fulfill({ json: read() }),
    );
    await page.route(
      "**/api/account/notifications/preferences/change",
      (route) => {
        state.revision += 1;
        state.email = true;
        void route.fulfill({ json: read() });
      },
    );
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

test("сохранённый выбор каналов виден во второй открытой поверхности", async ({
  page,
  context,
}) => {
  const stubChannels = channelsState();
  await stubChannels(page);

  await page.goto("/account/notifications");
  const email = page.getByRole("checkbox", { name: /Email/u });
  await expect(email).not.toBeChecked();

  const other = await context.newPage();
  await stubChannels(other);
  await other.goto("/account/notifications");
  await other.getByRole("checkbox", { name: /Email/u }).check();
  await other.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    other.getByText("Выбор сохранён.", { exact: true }),
  ).toBeVisible();

  await expect(email).toBeChecked();
});

test("отказ по расхождению редакции настроек показывает текст из источника отказов", async ({
  page,
}) => {
  await stubAccount(page);
  // Настройки прочитаны здесь, а изменены на другом устройстве: объявление туда не доходит.
  await page.route("**/api/account/notifications/preferences/change", (route) =>
    route.fulfill({ json: { ok: false, code: "revision_conflict" } }),
  );

  await page.goto("/account/notifications");
  await page.getByRole("checkbox", { name: /Email/u }).check();
  await page.getByRole("button", { name: "Сохранить" }).click();

  // Ожидание берётся у того же источника, что и экран: копия строки здесь пережила бы смену текста.
  await expect(
    page.getByText(notificationErrorMessage("revision_conflict"), {
      exact: true,
    }),
  ).toBeVisible();
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
  await page.goto("/account/purchases");
  await expect(
    page.getByRole("button", { name: "Привязать другую карту" }),
  ).toBeEnabled();
  await expect(page.getByText(started)).toHaveCount(0);

  const other = await context.newPage();
  await stubMethod(other);
  await other.goto("/account/purchases");
  await other.getByRole("button", { name: "Привязать другую карту" }).click();
  await expect(other.getByText(started)).toBeVisible();

  await expect(page.getByText(started)).toBeVisible();
});

test("без объявлений записавшая поверхность обновляется сама", async ({
  context,
}) => {
  // Отключены оба способа объявления: поверхность должна обновить данные из ответа команды.
  await context.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    window.dispatchEvent = () => true;
  });

  const subscription = await context.newPage();
  await renewalState()(subscription);
  await subscription.goto("/account/subscription");
  await subscription
    .getByRole("button", { name: "Отменить продление" })
    .click();
  await expect(
    subscription.getByRole("button", { name: "Возобновить автопродление" }),
  ).toBeVisible();

  const notifications = await context.newPage();
  await channelsState()(notifications);
  await notifications.goto("/account/notifications");
  await notifications.getByRole("checkbox", { name: /Email/u }).check();
  await notifications.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    notifications.getByText("Выбор сохранён.", { exact: true }),
  ).toBeVisible();
  await expect(
    notifications.getByRole("checkbox", { name: /Email/u }),
  ).toBeChecked();
});

for (const [state, label] of [
  ["scheduled", "Начнётся позже"],
  ["expired", "Срок завершён"],
  ["revoked", "Отозвано"],
] as const) {
  test(`назначение ${state} доступно из профиля без платёжной подписки`, async ({
    page,
  }, info) => {
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
    const mode = navigationMode(info.project.name);
    if (mode === "mobile")
      await page.getByRole("button", { name: /Личный кабинет/u }).click();
    await cabinetNavigation(page, mode)
      .getByRole("link", { name: /Подписка/u })
      .click();
    await expect(
      page.getByRole("heading", { name: "История тарифа", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").getByText(label, { exact: true }),
    ).toBeVisible();
  });
}
