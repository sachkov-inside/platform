import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { adminEvidence } from "../support/sales-admin-evidence";

/**
 * Снимки ключевых страниц всей спецификации #1717 для production visual gate (#1719): Обзор,
 * люди, карточка человека, вкладки страницы продукта, платежи, материалы и сдачи на интегрированном
 * коде. Поведение этих страниц проверяют их собственные сценарии; здесь только съёмка, поэтому без
 * `CAPTURE_ADMIN_SPEC_EVIDENCE=1` сценарии пропускаются. Каталог выбирает
 * `UPDATE_EVIDENCE=issue-1719`.
 */
const flag = "CAPTURE_ADMIN_SPEC_EVIDENCE";
test.skip(
  process.env[flag] !== "1",
  `Evidence capture runs only with ${flag}=1`,
);

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
/** «Архитектура приложения» двойников продуктов, учеников и Обзора продукта. */
const productId = "c0110000-0000-4000-8000-000000000001";
/** Анна Петрова двойника людей. */
const personId = "d1210000-0000-4000-8000-000000000001";

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token: string,
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
      idToken: "evidence.id.token",
      refreshToken: "evidence-refresh-token",
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

function capture(page: Page, info: TestInfo, state: string) {
  return adminEvidence(page, info, state, { flag, issue: "issue-1719" });
}

function main(page: Page) {
  return page.getByRole("main");
}

test.beforeEach(async ({ request }) => {
  for (const reset of [
    "__people/reset",
    "__sales-payments/reset",
    "__collections/reset",
    "__product-learners/reset",
    "__product-sale/reset",
    "__submissions/reset",
    "__authoring-materials/reset",
  ])
    expect((await request.post(`${backend}/${reset}`)).ok()).toBe(true);
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
});

test("Обзор: владелец, «Всё в порядке» и автор только материалов", async ({
  context,
  page,
  baseURL,
}, info) => {
  await signIn(context, baseURL, "overview-owner");
  await page.goto("/authoring");
  await expect(
    main(page).getByRole("region", { name: "Показатели" }),
  ).toBeVisible();
  await expect(
    main(page).getByRole("list", { name: "Последние события" }),
  ).toBeVisible();
  await capture(page, info, "overview");

  await context.clearCookies();
  await signIn(context, baseURL, "overview-clear");
  await page.goto("/authoring?period=7&metric=sales");
  await expect(main(page).getByText("Всё в порядке")).toBeVisible();
  await capture(page, info, "overview-all-clear");

  await context.clearCookies();
  await signIn(context, baseURL, "overview-materials");
  await page.goto("/authoring");
  await expect(
    main(page).getByRole("region", { name: "Продажи и доступы" }),
  ).toBeVisible();
  await capture(page, info, "overview-materials-only");
});

test("Люди и карточка человека", async ({ context, page, baseURL }, info) => {
  await signIn(context, baseURL, "overview-owner");
  await page.goto("/authoring/people");
  await expect(
    main(page).getByRole("link", { name: "Анна Петрова" }),
  ).toBeVisible();
  await capture(page, info, "people");
  await page.goto(`/authoring/people/${personId}`);
  await expect(
    main(page).getByRole("heading", { level: 1, name: "Анна Петрова" }),
  ).toBeVisible();
  await capture(page, info, "person-card");
});

test("Страница продукта: «Обзор», «Программа», «Продажа», «Ученики»", async ({
  context,
  page,
  baseURL,
}, info) => {
  await signIn(context, baseURL, "overview-owner");
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  await page.goto(`/authoring/products/${productId}`);
  await expect(
    page.getByRole("tabpanel", { name: "Обзор" }).getByText("Обладатели"),
  ).toBeVisible();
  await capture(page, info, "product-overview");
  await tab("Программа").click();
  await expect(
    page.getByRole("list", { name: "Материалы продукта" }),
  ).toBeVisible();
  await capture(page, info, "product-program");
  await page.goto(`/authoring/products/${productId}?tab=sale`);
  await expect(
    page.getByRole("tabpanel", { name: "Продажа" }).locator(".admin-badge"),
  ).toHaveText("Продажи закрыты");
  await capture(page, info, "product-sale");
  await page.goto(`/authoring/products/${productId}?tab=learners`);
  await expect(
    page
      .getByRole("tabpanel", { name: "Ученики" })
      .getByRole("link", { name: "Анна Петрова" }),
  ).toBeVisible();
  await capture(page, info, "product-learners");
});

test("Платежи и платежи без завершённой выдачи", async ({
  context,
  page,
  baseURL,
}, info) => {
  await signIn(context, baseURL, "overview-owner");
  await page.goto("/authoring/sales/payments");
  await expect(
    main(page).getByRole("heading", { level: 1, name: "Платежи" }),
  ).toBeVisible();
  await expect(main(page).locator(".admin-badge").first()).toBeAttached();
  await capture(page, info, "payments");
  await page.goto(
    "/authoring/sales/payments?state=confirmed&fulfillment=incomplete",
  );
  await expect(
    main(page).getByRole("list", { name: "Применённые фильтры" }),
  ).toContainText("Выдача не завершена");
  await capture(page, info, "payments-fulfillment-incomplete");
});

test("Материалы и сдачи", async ({ context, page, baseURL }, info) => {
  await signIn(context, baseURL, "overview-owner");
  await page.goto("/authoring/materials");
  await expect(
    main(page).getByText("24 материала", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "materials");
  await page.goto("/authoring/submissions");
  await expect(
    main(page)
      .getByRole("list", { name: "Применённые фильтры" })
      .getByText("Без комментария", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "submissions");
});
