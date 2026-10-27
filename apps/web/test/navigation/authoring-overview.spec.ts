import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
/** A product of `content-collections-backend.mjs`; its overview comes from `authoring-overview-backend.mjs`. */
const architectureId = "c0110000-0000-4000-8000-000000000001";

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token = "overview-owner",
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
      idToken: "overview.id.token",
      refreshToken: "overview-refresh-token",
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

/** Нет горизонтальной прокрутки, Axe чист для всей страницы вместе с каркасом. */
async function expectAccessibleWithoutOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

function main(page: Page) {
  return page.getByRole("main");
}

function metricCard(page: Page, label: RegExp) {
  return main(page)
    .getByRole("region", { name: "Показатели" })
    .getByRole("button", { name: label });
}

test.beforeEach(async ({ request }) => {
  for (const reset of ["__people/reset", "__sales-payments/reset"])
    expect((await request.post(`${backend}/${reset}`)).ok()).toBe(true);
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
});

test("the admin entry is the Overview: period and chart metric live in the address (#1719)", async ({
  context,
  page,
  baseURL,
}, info) => {
  await signIn(context, baseURL);
  const response = await page.goto("/authoring");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/authoring$/u);
  await expect(
    main(page).getByRole("heading", { level: 1, name: "Обзор" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: phone(info) ? "Основные разделы" : "Разделы админки",
  });
  await expect(navigation.getByRole("link", { name: "Обзор" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Тридцать дней по умолчанию: 10 продаж против 6 в прошлом периоде.
  const sales = metricCard(page, /^Продажи/u);
  await expect(sales).toContainText("10");
  await expect(sales).toContainText("+4 продажи");
  const revenue = metricCard(page, /^Выручка за вычетом возвратов/u);
  await expect(revenue).toHaveAttribute("aria-pressed", "true");
  await expect(revenue).toContainText(/124\s900\s₽/u);
  await expectAccessibleWithoutOverflow(page);

  const period = main(page).getByRole("group", { name: "Период" });
  const read7 = page.waitForResponse(
    (answer) =>
      answer.url().endsWith("/api/authoring/overview?period=7") &&
      answer.status() === 200,
  );
  await period.getByRole("button", { name: "7 дней" }).click();
  await read7;
  await expect(page).toHaveURL(/\/authoring\?period=7$/u);
  await expect(period.getByRole("button", { name: "7 дней" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sales).toContainText("+1 продажа");
  await expect(sales).toContainText("за 7 дней");

  // Карточка выбирает показатель графика, и выбор тоже живёт в адресе.
  await sales.click();
  await expect(page).toHaveURL(/\/authoring\?period=7&metric=sales$/u);
  await expect(sales).toHaveAttribute("aria-pressed", "true");
  await expect(revenue).toHaveAttribute("aria-pressed", "false");
  await expect(
    main(page).getByRole("region", { name: "График: Продажи" }),
  ).toContainText("За 7 дней: 3 продажи.");

  await page.goBack();
  await expect(page).toHaveURL(/\/authoring\?period=7$/u);
  await expect(revenue).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/authoring$/u);
  await expect(sales).toContainText("за 30 дней");
  await expect(sales).toContainText("+4 продажи");
});

test("attention rows open already filtered lists and an unchecked source is never «all clear» (#1719)", async ({
  context,
  page,
  baseURL,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring");
  const attention = main(page).getByRole("region", {
    name: "Требует внимания",
  });
  await expect(
    attention.getByText("Не удалось проверить доставку сообщений Telegram"),
  ).toBeVisible();
  await expect(attention.getByText("Всё в порядке")).toHaveCount(0);
  // Проверка без находок строки не получает.
  await expect(attention.getByText("Сдачи без комментария")).toHaveCount(0);

  await attention
    .getByRole("link", { name: "Оплачено, но выдача не завершена: 1 оплата" })
    .click();
  await expect(page).toHaveURL(
    "/authoring/sales/payments?state=confirmed&fulfillment=incomplete",
  );
  const chips = main(page).getByRole("list", { name: "Применённые фильтры" });
  await expect(chips).toContainText("Выдача не завершена");
  await expect(chips).toContainText("Оплачен");

  await page.goBack();
  await expect(page).toHaveURL(/\/authoring$/u);
  await attention
    .getByRole("link", { name: "Сбой доступа к группе Telegram: 1 человек" })
    .click();
  await expect(page).toHaveURL("/authoring/people?telegram=community_failed");
  await expect(
    main(page).getByRole("list", { name: "Применённые фильтры" }),
  ).toContainText("Сбой доступа к группе Telegram");
  // Одна раскладка видна: таблица на компьютере, список на телефоне.
  await expect(
    main(page).getByRole("link", { name: "Анна Петрова" }),
  ).toBeVisible();
  await expect(
    main(page).getByText("1 человек", { exact: true }),
  ).toBeVisible();
  await main(page).getByRole("button", { name: "Сбросить" }).click();
  await expect(page).toHaveURL(/\/authoring\/people$/u);
});

test("with nothing to check the attention block collapses to «Всё в порядке» (#1719)", async ({
  context,
  page,
  baseURL,
}) => {
  await signIn(context, baseURL, "overview-clear");
  await page.goto("/authoring");
  const attention = main(page).getByRole("region", {
    name: "Требует внимания",
  });
  await expect(attention.getByRole("status")).toHaveText("Всё в порядке");
  await expect(attention.getByRole("link")).toHaveCount(0);
});

test("a materials-only author sees refusals that name the right, not zeros (#1719)", async ({
  context,
  page,
  baseURL,
}) => {
  await signIn(context, baseURL, "overview-materials");
  await page.goto("/authoring");
  await expect(
    main(page).getByRole("region", { name: "Показатели" }),
  ).toHaveCount(0);
  await expect(
    main(page).getByRole("region", { name: "Продажи и доступы" }),
  ).toContainText("право управлять доступом и оплатами");
  const attention = main(page).getByRole("region", {
    name: "Требует внимания",
  });
  await expect(
    attention.getByRole("link", { name: "Сдачи без комментария: 2 сдачи" }),
  ).toHaveAttribute("href", "/authoring/submissions");
  await expect(attention).toContainText(
    "Оплаты, выдачу и Telegram проверяет аккаунт с правом управлять доступом и оплатами.",
  );
  // Закрытые правом продажи, воронка и обучение сведены в один отказ; период им не нужен.
  await expect(
    main(page).getByRole("region", { name: "Воронка продаж" }),
  ).toHaveCount(0);
  await expect(
    main(page).getByRole("region", { name: "Продажи и доступы" }),
  ).toContainText("воронку и обучение по продуктам");
  await expect(main(page).getByRole("group", { name: "Период" })).toHaveCount(
    0,
  );
  // Без права на людей имя скрыто и карточка человека не предлагается.
  const events = main(page).getByRole("list", { name: "Последние события" });
  await expect(events).toContainText("Имя скрыто");
  await expect(events.getByRole("link", { name: "Имя скрыто" })).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);
});

test("the product page opens on its Overview tab with a period in the address (#1719)", async ({
  context,
  page,
  baseURL,
}) => {
  await signIn(context, baseURL);
  await page.goto(`/authoring/products/${architectureId}`);
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  await expect(tab("Обзор")).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Обзор" });
  await expect(panel).toContainText("Обладатели");
  await expect(panel).toContainText("148");
  await expect(panel).toContainText("Набор не открыт");
  await expect(panel).toContainText("+4 продажи");
  await panel.getByRole("button", { name: "7 дней" }).click();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?period=7`,
  );
  await expect(panel).toContainText("+1 продажа");
  await expectAccessibleWithoutOverflow(page);

  await tab("Программа").click();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?period=7&tab=program`,
  );
  await page.goBack();
  await expect(tab("Обзор")).toHaveAttribute("aria-selected", "true");
});

test("a materials-only author gets a refusal on the product Overview with a way to the programme (#1719)", async ({
  context,
  page,
  baseURL,
}) => {
  await signIn(context, baseURL, "overview-materials");
  await page.goto(`/authoring/products/${architectureId}`);
  const panel = page.getByRole("tabpanel", { name: "Обзор" });
  await expect(
    panel.getByRole("heading", { name: "Обзор продукта закрыт" }),
  ).toBeVisible();
  await panel.getByRole("link", { name: "Открыть программу" }).click();
  await expect(page).toHaveURL(
    `/authoring/products/${architectureId}?tab=program`,
  );
  await expect(
    page.getByRole("tab", { name: "Программа", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
