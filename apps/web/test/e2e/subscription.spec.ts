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

test("возврат из банка не выдаётся за подтверждение оплаты", async ({
  page,
}) => {
  const response = await page.goto("/payment/return");

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
  benefits: ["product:00000000-0000-4000-8000-000000000801", "community"],
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
  await page.goto("/payment/return");

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

test("покупатель без Telegram одной кнопкой открывает бота с кодом привязки", async ({
  page,
}) => {
  await returnFromBank(page, "ready", { kind: "link_telegram" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "open", {
      configurable: true,
      value: () => ({
        close: () => undefined,
        location: {
          replace: (url: string) => {
            sessionStorage.setItem("test.telegram-opened", url);
          },
        },
        opener: null,
      }),
    });
  });
  await page.route("**/api/account/telegram-link/begin", (route) =>
    route.fulfill({
      json: {
        kind: "received",
        state: {
          deepLink: "https://t.me/inside_e2e_bot?start=opaque",
          expiresAt: "2030-01-01T00:05:00.000Z",
          linkRef: "62000000-0000-4000-8000-000000000001",
          status: "pending",
        },
      },
    }),
  );
  await page.goto("/payment/return");

  const community = page.getByRole("region", { name: "Сообщество Inside" });
  await community.getByRole("button", { name: "Подключить Telegram" }).click();
  // Кнопка ведёт прямо в бота с кодом, а не в раздел кабинета.
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("test.telegram-opened")),
    )
    .toBe("https://t.me/inside_e2e_bot?start=opaque");
  await expect(community.getByRole("status").first()).toContainText(
    "сам пришлёт личную ссылку в группу",
  );
  await expect(
    community.getByRole("link", { name: "Открыть Telegram" }),
  ).toHaveAttribute("href", "https://t.me/inside_e2e_bot?start=opaque");
});

test("участник сообщества после оплаты не зовётся вступать повторно", async ({
  page,
}) => {
  await returnFromBank(page, "ready", { kind: "member" });
  await page.goto("/payment/return");

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
  await page.goto("/payment/return");

  await expect(page.getByText("Ждёт подтверждения оплаты")).toBeVisible();
  await expect(page.getByText("Сообщество Inside")).toHaveCount(0);
});

/**
 * Перечитывания страницы через `router.refresh()`: запрос RSC без пометки предзагрузки. Их нельзя
 * спутать с предзагрузкой ссылок, которая на этой странице тоже ходит за RSC.
 */
function countPageRefreshes(page: Page, pathname: string) {
  const refreshes = { count: 0 };
  page.on("request", (request) => {
    const headers = request.headers();
    if (
      headers["rsc"] === "1" &&
      headers["next-router-prefetch"] === undefined &&
      new URL(request.url()).pathname === pathname
    ) {
      refreshes.count += 1;
    }
  });
  return refreshes;
}

const billingChannel = "inside.account.billing.changed";

/**
 * Слушатель объявлений о состоянии покупателя — тот же канал, что слушает оболочка. Кроме
 * объявлений он запоминает метки теста: метка, пришедшая после проверяемого шага, доказывает,
 * что объявление этого шага уже дошло бы раньше неё.
 */
async function countBillingAnnouncements(page: Page) {
  await page.addInitScript((channel) => {
    new BroadcastChannel(channel).addEventListener(
      "message",
      (event: MessageEvent) => {
        if (event.data === "written") {
          const heard = Number(sessionStorage.getItem("test.announcements"));
          sessionStorage.setItem("test.announcements", String(heard + 1));
        } else {
          sessionStorage.setItem("test.marker", String(event.data));
        }
      },
    );
  }, billingChannel);
  return {
    count: () =>
      page.evaluate(() => Number(sessionStorage.getItem("test.announcements"))),
    marker: () => page.evaluate(() => sessionStorage.getItem("test.marker")),
  };
}

/** Метка теста в канал объявлений из другой вкладки. */
async function postMarker(page: Page, marker: string) {
  await page.evaluate(
    ([channel, value]) => {
      const sender = new BroadcastChannel(channel);
      sender.postMessage(value);
      sender.close();
    },
    [billingChannel, marker] as const,
  );
}

test("подтверждённая покупка перечитывает страницу, открытую в другой вкладке", async ({
  page,
  context,
}) => {
  // Вкладка A открыта заранее и остаётся открытой: покупку подтверждает не она.
  const refreshes = countPageRefreshes(page, "/payment/checkout");
  const announcements = await countBillingAnnouncements(page);
  await page.goto("/payment/checkout");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(refreshes.count).toBe(0);

  const purchase = await context.newPage();
  await returnFromBank(purchase, "ready", { kind: "member" });
  await purchase.goto("/payment/return");
  await expect(purchase.getByText("Оплата подтверждена")).toBeVisible();

  await expect.poll(() => refreshes.count).toBeGreaterThanOrEqual(1);
  await expect.poll(announcements.count).toBe(1);

  // Повторное чтение подтверждённого состояния и перезагрузка экрана возврата — та же покупка:
  // объявлять её снова нечего.
  await purchase.getByRole("button", { name: "Обновить состояние" }).click();
  await expect(
    purchase.getByRole("button", { name: "Обновить состояние" }),
  ).toBeEnabled();
  await purchase.reload();
  await expect(purchase.getByText("Оплата подтверждена")).toBeVisible();
  await expect(
    purchase.getByRole("region", { name: "Сообщество Inside" }),
  ).toBeVisible();
  // Метка уходит после перезагрузки: когда она дошла, повторное объявление дошло бы раньше.
  await postMarker(purchase, "after-reload");
  await expect.poll(announcements.marker).toBe("after-reload");
  expect(await announcements.count()).toBe(1);
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
