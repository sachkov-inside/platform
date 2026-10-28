import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";

import { salesAdminEvidence } from "../support/sales-admin-evidence";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
/** The authored payments of `sales-payments-backend.mjs`. */
const salesPaymentsFixture = {
  unknownRef: "78000000-0000-4000-8000-000000000101",
  orderEmail: "buyer.order@example.test",
} as const;
const agents = {
  id: "78000000-0000-4000-8000-0000000000f1",
  title: "Разработка с агентами",
} as const;

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token = "sales-owner",
) {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: The live Web process and Logto validate this session against their real clock; it carries no calendar-dependent domain assertion.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token,
        },
      }),
      idToken: "sales.id.token",
      refreshToken: "sales-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  await context.addCookies([
    {
      httpOnly: true,
      name: "logto_inside-web-navigation",
      sameSite: "Lax",
      url: baseURL,
      value: session,
    },
  ]);
}

function phone(info: TestInfo): boolean {
  return info.project.name === "mobile-chromium";
}

/** Видимые строки списка: строка таблицы с 40rem колонки, элемент списка уже. */
function paymentRows(page: Page) {
  return page
    .getByRole("main")
    .locator("tbody tr:visible, li.admin-list-item:visible");
}

/** What `payments.list` received, in arrival order. */
async function listCommands(request: APIRequestContext) {
  const response = await request.get(`${backend}/__sales-payments/commands`);
  expect(response.ok()).toBe(true);
  const { commands } = z
    .object({ commands: z.array(z.record(z.string(), z.unknown())) })
    .parse(await response.json());
  return commands.filter((command) => command["operation"] === "payments.list");
}

async function expectAccessibleWithoutOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);
}

async function chooseState(page: Page, option: string) {
  await page
    .getByRole("main")
    .getByRole("combobox", { name: "Состояние оплаты", exact: true })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__sales-payments/reset`)).ok()).toBe(
    true,
  );
});

test("former sales addresses lead to the new section with their query (#1718)", async ({
  request,
}) => {
  for (const [source, destination] of [
    ["/authoring/billing", "/authoring/sales/payments"],
    [
      "/authoring/billing?state=unknown",
      "/authoring/sales/payments?state=unknown",
    ],
    [
      "/authoring/sales-funnel?from=2026-10-01",
      "/authoring/sales/funnel?from=2026-10-01",
    ],
  ] as const) {
    const response = await request.get(source, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(destination);
  }
});

test("payments are the current sales item and their filters live in the address (#1718)", async ({
  baseURL,
  context,
  page,
  request,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/billing");
  await expect(page).toHaveURL(/\/authoring\/sales\/payments$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Платежи" }),
  ).toBeVisible();
  if (phone(info))
    await expect(
      page
        .getByRole("navigation", { name: "Основные разделы" })
        .getByRole("link", { name: "Продажи" }),
    ).toHaveAttribute("aria-current", "page");
  else
    await expect(
      page
        .getByRole("navigation", { name: "Разделы админки" })
        .getByRole("link", { name: "Платежи" }),
    ).toHaveAttribute("aria-current", "page");
  await expect(paymentRows(page)).toHaveCount(50);
  await expectAccessibleWithoutOverflow(page);
  await salesAdminEvidence(page, info, "payments");

  await chooseState(page, "Неизвестно, нужна сверка");
  await expect(page).toHaveURL(/\?state=unknown$/u);
  await expect(paymentRows(page)).toHaveCount(1);

  const product = page.getByRole("combobox", { name: "Продукт", exact: true });
  await product.fill("агент");
  await page.getByRole("option", { name: agents.title, exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`\\?state=unknown&product=${agents.id}$`, "u"),
  );
  await expect(product).toHaveValue(agents.title);
  await expect(
    page
      .getByRole("list", { name: "Применённые фильтры" })
      .getByRole("listitem"),
  ).toHaveText([/Неизвестно, нужна сверка/u, new RegExp(agents.title, "u")]);

  await page.getByLabel("С какого дня", { exact: true }).fill("2026-10-24");
  await expect(page).toHaveURL(/&from=2026-10-24$/u);
  const lastList = (await listCommands(request)).at(-1);
  expect(lastList).toMatchObject({
    states: ["unknown"],
    productId: agents.id,
    from: "2026-10-23T21:00:00.000Z",
  });
  await expect(paymentRows(page)).toHaveCount(1);
  await salesAdminEvidence(page, info, "payments-filtered");

  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`\\?state=unknown&product=${agents.id}$`, "u"),
  );
  await page.goBack();
  await expect(page).toHaveURL(/\?state=unknown$/u);
  await expect(product).toHaveValue("");
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page).toHaveURL(/\/authoring\/sales\/payments$/u);
  await expect(paymentRows(page)).toHaveCount(50);

  await page.getByRole("button", { name: "Более ранние" }).click();
  await expect(page).toHaveURL(/\?cursor=[0-9a-f-]{36}$/u);
  await expect(paymentRows(page)).toHaveCount(10);
  await page.getByRole("button", { name: "К началу списка" }).click();
  await expect(page).toHaveURL(/\/authoring\/sales\/payments$/u);
});

test("«Все оплаты» of a person card opens the list narrowed to that buyer (#1717)", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  // The first authored payment belongs to this account and no other payment does.
  const buyer = "33333333-0000-4000-8000-000000000001";
  await page.goto(`/authoring/sales/payments?person=${buyer}`);
  await expect(paymentRows(page)).toHaveCount(1);
  expect((await listCommands(request)).at(-1)).toMatchObject({
    accountId: buyer,
  });
  const chips = page.getByRole("list", { name: "Применённые фильтры" });
  await expect(chips.getByRole("listitem")).toHaveText([/^Покупатель: /u]);
  await expect(chips).not.toContainText(buyer);
  await expectAccessibleWithoutOverflow(page);

  await chips
    .getByRole("button", { name: /^Убрать фильтр «Покупатель: /u })
    .click();
  await expect(page).toHaveURL(/\/authoring\/sales\/payments$/u);
  await expect(paymentRows(page)).toHaveCount(50);
});

test("the payment page shows the order email on request and reconciles after confirmation (#1718)", async ({
  baseURL,
  context,
  page,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/payments?state=unknown");
  const row = paymentRows(page).first();
  await expect(row).toContainText("Неизвестно, нужна сверка");
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(
    `/authoring/sales/payments/${salesPaymentsFixture.unknownRef}`,
  );
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: agents.title }),
  ).toBeVisible();
  await expect(
    main.getByText("Банк не сообщил итог этой оплаты"),
  ).toBeVisible();
  await expect(main.getByText(salesPaymentsFixture.orderEmail)).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);

  await main.getByRole("button", { name: "Показать email" }).click();
  await expect(main.getByText(salesPaymentsFixture.orderEmail)).toBeVisible();
  await salesAdminEvidence(page, info, "payment");
  await main.getByRole("button", { name: "Скрыть email" }).click();
  await expect(main.getByText(salesPaymentsFixture.orderEmail)).toHaveCount(0);

  await main.getByRole("button", { name: "Сверить с банком" }).click();
  const dialog = page.getByRole("dialog", { name: "Сверить платёж с банком?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toBeHidden();
  await main.getByRole("button", { name: "Сверить с банком" }).click();
  await dialog.getByRole("button", { name: "Сверить с банком" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    main.getByRole("status").filter({ hasText: "Сверка" }),
  ).toHaveText("Сверка выполнена. Состояние оплаты: Оплачен.");
  await expect(main.getByText("Доступ открыт")).toBeVisible();
  await expect(main.getByText("Банк не сообщил итог этой оплаты")).toHaveCount(
    0,
  );

  await main.getByRole("link", { name: "Все платежи" }).click();
  await expect(page).toHaveURL(/\/authoring\/sales\/payments$/u);
});

test("an account without the billing right gets a refusal, not an empty list (#1718)", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL, "sales-forbidden");
  await page.goto("/authoring/sales/payments");
  await expect(
    page.getByRole("heading", { name: "Нет доступа к платежам" }),
  ).toBeVisible();
  await expect(page.getByText("Платежей пока нет")).toHaveCount(0);
});

test("on a phone payments are list items with large targets and no sideways scroll (#1718)", async ({
  baseURL,
  context,
  page,
}, info) => {
  test.skip(!phone(info), "Телефонная раскладка проверяется на 390 px");
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/payments");
  const main = page.getByRole("main");
  await expect(main.locator("li.admin-list-item:visible")).toHaveCount(50);
  await expect(main.getByRole("table")).toBeHidden();
  const first = main.locator("li.admin-list-item:visible").first();
  await expect(first.locator(".admin-badge")).toHaveCount(1);
  await expect(first.locator(".admin-list-item-metric")).toHaveText(/₽$/u);
  await expectAccessibleWithoutOverflow(page);
  for (const target of [
    main.getByRole("combobox", { name: "Продукт", exact: true }),
    main.getByRole("combobox", { name: "Состояние оплаты", exact: true }),
    main.getByLabel("С какого дня", { exact: true }),
    // Строку открывает щелчок по любому её месту, поэтому цель нажатия — вся строка.
    first,
    first.getByRole("button", { name: /^Действия с платежом/u }),
    main.getByRole("button", { name: "Более ранние" }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
