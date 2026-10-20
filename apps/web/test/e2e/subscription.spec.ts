import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

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
  await page.route("**/api/account", (route) =>
    route.fulfill({
      status,
      json: {
        profile: { kind: "missing" },
        telegramMembership: {
          link: { kind: "linked" },
          membership: { kind: "stale" },
        },
      },
    }),
  );
  await page.route("**/api/account/billing/enrollments", (route) =>
    route.fulfill({ json: { ok: true, value: { items: [] } } }),
  );
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
  remember = true,
) {
  if (remember)
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

test("возврат показывает покупку и кабинет без глобального сообщества", async ({
  page,
}) => {
  await returnFromBank(page, "ready", {
    kind: "join",
    botUrl: "https://t.me/inside_e2e_bot",
  });
  await page.goto("/payment/return");
  await expect(page.getByText("Оплата подтверждена")).toBeVisible();
  await expect(page.getByText("AI Engineering", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Платёжный кабинет" }),
  ).toHaveAttribute("href", "/account/purchases");
  await expect(
    page.getByRole("region", { name: "Сообщество Inside" }),
  ).toHaveCount(0);
});

test("возврат восстанавливает точную оплату без browser storage", async ({
  page,
}) => {
  await returnFromBank(page, "ready", { kind: "none" }, false);
  const references: (string | null)[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/account/billing/purchase-status")
      references.push(url.searchParams.get("purchaseRef"));
  });
  await page.goto(`/payment/return?purchaseRef=${returnedPurchaseRef}`);
  await expect(page.getByText("Оплата подтверждена")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Оплата подтверждена")).toBeVisible();
  expect(references.length).toBeGreaterThanOrEqual(2);
  expect(
    references.every((reference) => reference === returnedPurchaseRef),
  ).toBe(true);
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
  await page.addInitScript(
    ({ channel, uuidPattern }) => {
      const announcementId = new RegExp(uuidPattern);
      new BroadcastChannel(channel).addEventListener(
        "message",
        (event: MessageEvent) => {
          // A write now carries its UUID; older tabs still send the written literal.
          // Test markers are deliberately outside that protocol.
          const isWrite =
            event.data === "written" ||
            (typeof event.data === "string" && announcementId.test(event.data));
          if (isWrite) {
            const heard = Number(sessionStorage.getItem("test.announcements"));
            sessionStorage.setItem("test.announcements", String(heard + 1));
          } else {
            sessionStorage.setItem("test.marker", String(event.data));
          }
        },
      );
    },
    { channel: billingChannel, uuidPattern: z.regexes.uuid().source },
  );
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

  // Delivery alone is not a purchase: the observer must reject a non-write message.
  await postMarker(page, "before-purchase");
  await expect.poll(announcements.marker).toBe("before-purchase");
  expect(await announcements.count()).toBe(0);
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
  ).toHaveCount(0);
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Личный кабинет",
  );
  await expect(
    page
      .locator("[data-application-content]")
      .getByRole("button", { name: "Войти через Telegram" })
      .first(),
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
  // Financial details remain collapsed until the owner opens purchases.
  await expect(page.getByText("Оплаченный доступ")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Способ оплаты" }),
  ).not.toBeVisible();
});
