import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;

const architectureId = "c0110000-0000-4000-8000-000000000001";
const databaseId = "c0110000-0000-4000-8000-000000000002";
const infrastructureId = "c0110000-0000-4000-8000-000000000011";

async function authorCookie(baseURL: string) {
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: The live Web process and Logto validate this session against their real clock; it carries no calendar-dependent domain assertion.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: "collections-author",
        },
      }),
      idToken: "collections.id.token",
      refreshToken: "collections-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return {
    httpOnly: true,
    name: "logto_inside-web-navigation",
    sameSite: "Lax" as const,
    url: baseURL,
    value: session,
  };
}

function phone(info: TestInfo): boolean {
  return info.project.name === "mobile-chromium";
}

/** Таблица на компьютере, список строк на телефоне: в дереве доступности ровно одна из них. */
function rows(page: Page, info: TestInfo, name: string) {
  return phone(info)
    ? page.getByRole("list", { name }).getByRole("listitem")
    : page.getByRole("table", { name }).locator("tbody tr");
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

test.beforeEach(async ({ context, request, baseURL }) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__collections/reset`)).ok()).toBe(
    true,
  );
  await context.addCookies([await authorCookie(baseURL)]);
});

test("products list opens a product whose tabs live in the address and keep the draft (#1720)", async ({
  page,
}, info) => {
  await page.goto("/authoring/products");
  await expect(
    page.getByRole("heading", { level: 1, name: "Продукты" }),
  ).toBeVisible();
  const products = rows(page, info, "Все продукты");
  await expect(products).toHaveCount(3);
  await expectAccessibleWithoutOverflow(page);

  // Поиск сужает полный список и живёт в адресе.
  await page
    .getByRole("searchbox", { name: "Поиск по продуктам" })
    .fill("базой");
  await expect(page).toHaveURL(/\/authoring\/products\?search=%D0%B1/u);
  await expect(products).toHaveCount(1);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page).toHaveURL(/\/authoring\/products$/u);
  await expect(products).toHaveCount(3);

  // Строка открывает продукт: на компьютере щелчок по любой ячейке, на телефоне по строке.
  const row = products.filter({ hasText: "Архитектура приложения" });
  if (phone(info)) await row.getByText("Опубликовано: 5").click();
  else await row.locator("td").nth(2).click();
  await expect(page).toHaveURL(`/authoring/products/${architectureId}`);
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  await expect(tab("Программа")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("list", { name: "Материалы продукта" }),
  ).toContainText("Первый шаг программы");

  await tab("Описание и обложка").click();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?tab=description`,
  );
  const summary = page.getByRole("textbox", { name: "Краткое описание" });
  await summary.fill("Черновик описания продукта");
  await tab("Настройки").click();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?tab=settings`,
  );
  await expect(summary).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?tab=description`,
  );
  await expect(tab("Описание и обложка")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(summary).toHaveValue("Черновик описания продукта");
  await expectAccessibleWithoutOverflow(page);

  await page.goBack();
  await expect(page).toHaveURL(`/authoring/products/${architectureId}`);
  await expect(tab("Программа")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(tab("Описание и обложка")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(summary).toHaveValue("Черновик описания продукта");
});

test("an unknown product tab falls back to the programme (#1720)", async ({
  page,
}) => {
  await page.goto(`/authoring/products/${databaseId}?tab=sales`);
  await expect(
    page.getByRole("tab", { name: "Программа", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("list", { name: "Материалы продукта" }),
  ).toBeVisible();
});

test("home pin is the direct action of a product row (#1720)", async ({
  page,
}, info) => {
  await page.goto("/authoring/products");
  const list = phone(info)
    ? page.getByRole("list", { name: "Все продукты" })
    : page.getByRole("table", { name: "Все продукты" });
  await expect(
    list.getByRole("button", { name: "Снять закреп «Архитектура приложения»" }),
  ).toHaveAttribute("aria-pressed", "true");
  const write = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/authoring/home-pin" &&
      response.request().method() === "PUT",
  );
  await list
    .getByRole("button", {
      name: "Закрепить «Работа с базой данных» на главной",
    })
    .click();
  expect((await write).status()).toBe(200);
  await expect(
    list.getByRole("button", { name: "Снять закреп «Работа с базой данных»" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    list.getByRole("button", {
      name: "Закрепить «Архитектура приложения» на главной",
    }),
  ).toHaveAttribute("aria-pressed", "false");
  // Архивный продукт закрепить нельзя.
  await expect(
    list.getByRole("button", {
      name: "Закрепить «Прежнее руководство по развёртыванию» на главной",
    }),
  ).toBeDisabled();
});

test("topics filter and search live in the address and a topic opens as its own view (#1720)", async ({
  page,
}, info) => {
  await page.goto("/authoring/topics?state=archived");
  const topics = rows(page, info, "Все темы");
  await expect(topics).toHaveCount(1);
  await expect(topics).toContainText("Старые заметки");
  const chips = page.getByRole("list", { name: "Применённые фильтры" });
  await expect(chips).toHaveText("Архив");
  await expectAccessibleWithoutOverflow(page);

  await page.getByRole("button", { name: "Убрать фильтр «Архив»" }).click();
  await expect(page).toHaveURL(/\/authoring\/topics$/u);
  await expect(topics).toHaveCount(3);
  await page.getByRole("searchbox", { name: "Поиск по темам" }).fill("Инфра");
  await expect(page).toHaveURL(
    `/authoring/topics?search=${encodeURIComponent("Инфра")}`,
  );
  await expect(topics).toHaveCount(1);

  await topics.getByRole("link", { name: "Инфраструктура" }).click();
  await expect(page).toHaveURL(
    `/authoring/topics?search=${encodeURIComponent("Инфра")}&topic=${infrastructureId}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Инфраструктура" }),
  ).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Название" })).toHaveValue(
    "Инфраструктура",
  );
  await expectAccessibleWithoutOverflow(page);

  await page.goBack();
  await expect(page).toHaveURL(
    `/authoring/topics?search=${encodeURIComponent("Инфра")}`,
  );
  await expect(
    page.getByRole("searchbox", { name: "Поиск по темам" }),
  ).toHaveValue("Инфра");
  await expect(topics).toHaveCount(1);

  // Адрес темы открывается и сам по себе.
  await page.goto(`/authoring/topics?topic=${infrastructureId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Инфраструктура" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Все темы" }).click();
  await expect(page).toHaveURL(/\/authoring\/topics$/u);
  await expect(topics).toHaveCount(3);
});
